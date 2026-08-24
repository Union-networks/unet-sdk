import { createHash, randomBytes } from 'node:crypto';

export type DirectIssuerRequestState = 'pending' | 'anchoring' | 'ready' | 'delivered' | 'denied' | 'failed';
export type CredentialReplacementMode = 'deny' | 'replace_after_delivery' | 'parallel';

export interface DirectIssuerRequestInput {
  serviceAccountRef: string;
  checkId: string;
  holderBinding: string;
  deliveryPublicKey: string;
  holderRevocationSigner: string;
  claims?: Record<string, unknown>;
  consent?: { text: string; acceptedAtIso: string };
  idempotencyKey: string;
}

export interface DirectIssuerRequestRecord extends DirectIssuerRequestInput {
  requestId: string;
  deliveryCapabilityHash: string;
  state: DirectIssuerRequestState;
  createdAtIso: string;
  updatedAtIso: string;
  attestationHash?: string;
  encryptedCredentialEnvelope?: Record<string, unknown>;
  ledgerTransactionHash?: string;
  replacedAttestationHash?: string;
  failureCategory?: string;
}

export interface DirectIssuerRequestStore {
  create(record: DirectIssuerRequestRecord): Promise<void>;
  get(requestId: string): Promise<DirectIssuerRequestRecord | undefined>;
  findByIdempotency(serviceAccountRef: string, idempotencyKey: string): Promise<DirectIssuerRequestRecord | undefined>;
  findActive(serviceAccountRef: string, checkId: string): Promise<DirectIssuerRequestRecord[]>;
  update(record: DirectIssuerRequestRecord): Promise<void>;
}

export interface DirectIssuerServiceOptions {
  store: DirectIssuerRequestStore;
  replacementModeFor: (checkId: string) => Promise<CredentialReplacementMode>;
  buildCredential: (request: DirectIssuerRequestRecord) => Promise<{
    attestationHash: string;
    encryptedCredentialEnvelope: Record<string, unknown>;
  }>;
  anchorCredential: (input: {
    request: DirectIssuerRequestRecord;
    attestationHash: string;
    holderRevocationSigner: string;
  }) => Promise<{ transactionHash: string; status: 'active' }>;
  revokeReplacedCredential: (input: { requestId: string; attestationHash: string }) => Promise<void>;
  now?: () => Date;
}

const hashCapability = (value: string) => createHash('sha256').update(value).digest('hex');
const randomId = (prefix: string) => `${prefix}_${randomBytes(18).toString('base64url')}`;
const isHolderRevocationAddress = (value: string) => /^0x[a-fA-F0-9]{40}$/.test(value);

export function createDirectIssuerService(options: DirectIssuerServiceOptions) {
  const now = options.now ?? (() => new Date());

  return {
    async createRequest(input: DirectIssuerRequestInput): Promise<{ requestId: string; deliveryCapability: string; state: DirectIssuerRequestState; replacementRequired: boolean }> {
      if (!input.serviceAccountRef || !input.checkId || !input.holderBinding || !input.deliveryPublicKey) throw new Error('issuer_request_invalid');
      if (!isHolderRevocationAddress(input.holderRevocationSigner)) throw new Error('holder_revocation_signer_invalid');
      const previous = await options.store.findByIdempotency(input.serviceAccountRef, input.idempotencyKey);
      if (previous) throw new Error('issuer_request_idempotency_replayed');
      const active = await options.store.findActive(input.serviceAccountRef, input.checkId);
      const replacementMode = await options.replacementModeFor(input.checkId);
      if (active.length > 0 && replacementMode === 'deny') throw new Error('active_credential_exists');
      const deliveryCapability = randomId('delivery');
      const timestamp = now().toISOString();
      const record: DirectIssuerRequestRecord = {
        ...input,
        requestId: randomId('attest'),
        deliveryCapabilityHash: hashCapability(deliveryCapability),
        state: 'pending',
        createdAtIso: timestamp,
        updatedAtIso: timestamp,
        ...(active[0]?.attestationHash && replacementMode === 'replace_after_delivery'
          ? { replacedAttestationHash: active[0].attestationHash }
          : {}),
      };
      await options.store.create(record);
      return { requestId: record.requestId, deliveryCapability, state: record.state, replacementRequired: Boolean(record.replacedAttestationHash) };
    },

    async approve(requestId: string): Promise<DirectIssuerRequestRecord> {
      const request = await options.store.get(requestId);
      if (!request || request.state !== 'pending') throw new Error('issuer_request_not_pending');
      const built = await options.buildCredential(request);
      if (!/^(0x)?[a-fA-F0-9]{64}$/.test(built.attestationHash)) throw new Error('attestation_hash_invalid');
      // Ciphertext is durable before any anchor transaction is submitted.
      const anchoring: DirectIssuerRequestRecord = {
        ...request,
        state: 'anchoring',
        attestationHash: built.attestationHash.replace(/^0x/, '').toLowerCase(),
        encryptedCredentialEnvelope: built.encryptedCredentialEnvelope,
        updatedAtIso: now().toISOString(),
      };
      await options.store.update(anchoring);
      try {
        const attestationHash = anchoring.attestationHash;
        if (!attestationHash) throw new Error('attestation_hash_missing_after_build');
        const chain = await options.anchorCredential({
          request: anchoring,
          attestationHash,
          holderRevocationSigner: anchoring.holderRevocationSigner,
        });
        const ready: DirectIssuerRequestRecord = {
          ...anchoring,
          state: 'ready',
          ledgerTransactionHash: chain.transactionHash,
          updatedAtIso: now().toISOString(),
        };
        await options.store.update(ready);
        return ready;
      } catch (error) {
        await options.store.update({
          ...anchoring,
          state: 'failed',
          failureCategory: error instanceof Error && error.message.includes('timeout') ? 'ledger_timeout' : 'ledger_rejected',
          updatedAtIso: now().toISOString(),
        });
        throw error;
      }
    },

    async getDelivery(requestId: string, deliveryCapability: string): Promise<{
      state: DirectIssuerRequestState;
      attestationHash?: string;
      encryptedCredentialEnvelope?: Record<string, unknown>;
      failureCategory?: string;
    }> {
      const request = await options.store.get(requestId);
      if (!request || request.deliveryCapabilityHash !== hashCapability(deliveryCapability)) throw new Error('delivery_capability_invalid');
      return {
        state: request.state,
        ...(request.state === 'ready' || request.state === 'delivered' ? {
          attestationHash: request.attestationHash,
          encryptedCredentialEnvelope: request.encryptedCredentialEnvelope,
        } : {}),
        ...(request.failureCategory ? { failureCategory: request.failureCategory } : {}),
      };
    },

    async acknowledgeDelivery(requestId: string, deliveryCapability: string, attestationHash: string): Promise<void> {
      const request = await options.store.get(requestId);
      if (!request || request.deliveryCapabilityHash !== hashCapability(deliveryCapability)) throw new Error('delivery_capability_invalid');
      if (request.state === 'delivered') return;
      if (request.state !== 'ready' || request.attestationHash !== attestationHash.replace(/^0x/, '').toLowerCase()) throw new Error('delivery_acknowledgement_invalid');
      await options.store.update({ ...request, state: 'delivered', updatedAtIso: now().toISOString() });
      if (request.replacedAttestationHash) {
        await options.revokeReplacedCredential({ requestId, attestationHash: request.replacedAttestationHash });
      }
    },
  };
}

export class InMemoryDirectIssuerRequestStore implements DirectIssuerRequestStore {
  private readonly records = new Map<string, DirectIssuerRequestRecord>();

  public async create(record: DirectIssuerRequestRecord): Promise<void> {
    if (this.records.has(record.requestId)) throw new Error('issuer_request_duplicate');
    this.records.set(record.requestId, structuredClone(record));
  }

  public async get(requestId: string): Promise<DirectIssuerRequestRecord | undefined> {
    const value = this.records.get(requestId);
    return value ? structuredClone(value) : undefined;
  }

  public async findByIdempotency(serviceAccountRef: string, idempotencyKey: string): Promise<DirectIssuerRequestRecord | undefined> {
    const value = [...this.records.values()].find((record) => record.serviceAccountRef === serviceAccountRef && record.idempotencyKey === idempotencyKey);
    return value ? structuredClone(value) : undefined;
  }

  public async findActive(serviceAccountRef: string, checkId: string): Promise<DirectIssuerRequestRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.serviceAccountRef === serviceAccountRef && record.checkId === checkId && ['ready', 'delivered'].includes(record.state))
      .map((record) => structuredClone(record));
  }

  public async update(record: DirectIssuerRequestRecord): Promise<void> {
    if (!this.records.has(record.requestId)) throw new Error('issuer_request_not_found');
    this.records.set(record.requestId, structuredClone(record));
  }
}
