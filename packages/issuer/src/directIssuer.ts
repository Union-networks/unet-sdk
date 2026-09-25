import { createHash, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

/** @public */
export type DirectIssuerRequestState = 'pending' | 'anchoring' | 'ready' | 'delivered' | 'denied' | 'failed' | 'revoked';
/** @public */
export type CredentialReplacementMode = 'deny' | 'replace_after_delivery' | 'parallel';

/** @public */
export interface DirectIssuerRequestInput {
  serviceAccountRef: string;
  checkId: string;
  holderBinding: string;
  deliveryPublicKey: string;
  /** SHA-256 of the wallet-held delivery bearer. The bearer is never returned by admission. */
  deliveryCapabilityHash: string;
  holderRevocationSigner: string;
  claims?: Record<string, unknown>;
  consent?: { text: string; acceptedAtIso: string };
  idempotencyKey: string;
}

/** @public */
export interface DirectIssuerRequestRecord extends DirectIssuerRequestInput {
  requestId: string;
  state: DirectIssuerRequestState;
  createdAtIso: string;
  updatedAtIso: string;
  attestationHash?: string;
  encryptedCredentialEnvelope?: Record<string, unknown>;
  ledgerTransactionHash?: string;
  replacedAttestationHash?: string;
  renewalOfRequestId?: string;
  failureCategory?: string;
}

/** @public */
export interface DirectIssuerRequestStore {
  withAccountTransaction<T>(serviceAccountRef: string, checkId: string, work: (store: DirectIssuerRequestStore) => Promise<T>): Promise<T>;
  create(record: DirectIssuerRequestRecord): Promise<void>;
  get(requestId: string): Promise<DirectIssuerRequestRecord | undefined>;
  findByIdempotency(serviceAccountRef: string, idempotencyKey: string): Promise<DirectIssuerRequestRecord | undefined>;
  findActive(serviceAccountRef: string, checkId: string): Promise<DirectIssuerRequestRecord[]>;
  findPending(serviceAccountRef: string, checkId: string): Promise<DirectIssuerRequestRecord[]>;
  findByAttestationHash(attestationHash: string): Promise<DirectIssuerRequestRecord | undefined>;
  list(input?: { state?: DirectIssuerRequestState; serviceAccountRef?: string; limit?: number }): Promise<DirectIssuerRequestRecord[]>;
  update(record: DirectIssuerRequestRecord): Promise<void>;
}

/** @public */
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
  revokeCredential?: (input: { requestId: string; attestationHash: string; reason: string }) => Promise<void>;
  now?: () => Date;
}

/** @public */
export interface DirectIssuerRenewalInput {
  requestId: string;
  deliveryCapability: string;
  holderBinding: string;
  deliveryPublicKey: string;
  deliveryCapabilityHash: string;
  holderRevocationSigner: string;
  idempotencyKey: string;
}

const hashCapability = (value: string) => createHash('sha256').update(value).digest('hex');
const randomId = (prefix: string) => `${prefix}_${randomBytes(18).toString('base64url')}`;
const isHolderRevocationAddress = (value: string) => /^0x[a-fA-F0-9]{40}$/.test(value);

const boundedText = (value: unknown, max = 512): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function snapshotRequest(input: DirectIssuerRequestInput): DirectIssuerRequestInput {
  if (!input || ![input.serviceAccountRef, input.checkId, input.holderBinding, input.deliveryPublicKey, input.idempotencyKey].every(value => boundedText(value))
    || typeof input.deliveryCapabilityHash !== 'string' || !/^[0-9a-f]{64}$/.test(input.deliveryCapabilityHash)) throw new Error('issuer_request_invalid');
  if (typeof input.holderRevocationSigner !== 'string' || !isHolderRevocationAddress(input.holderRevocationSigner)
    || /^0x0{40}$/i.test(input.holderRevocationSigner)) throw new Error('holder_revocation_signer_invalid');
  const allowed = ['serviceAccountRef', 'checkId', 'holderBinding', 'deliveryPublicKey', 'deliveryCapabilityHash', 'holderRevocationSigner', 'claims', 'consent', 'idempotencyKey'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error('issuer_request_invalid');
  const validateJson = (value: unknown, depth = 0): void => {
    if (depth > 16) throw new Error('issuer_request_invalid');
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) validateJson(value[index], depth + 1);
      return;
    }
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      for (const child of Object.values(value)) validateJson(child, depth + 1);
      return;
    }
    throw new Error('issuer_request_invalid');
  };
  if (input.claims !== undefined) {
    if (!input.claims || Array.isArray(input.claims) || Object.getPrototypeOf(input.claims) !== Object.prototype) throw new Error('issuer_request_invalid');
    validateJson(input.claims);
  }
  if (input.consent !== undefined && (!input.consent || !boundedText(input.consent.text, 16_384)
    || !boundedText(input.consent.acceptedAtIso, 64) || !Number.isFinite(Date.parse(input.consent.acceptedAtIso))
    || Object.keys(input.consent).some(key => !['text', 'acceptedAtIso'].includes(key)))) throw new Error('issuer_request_invalid');
  if (JSON.stringify(input).length > 65_536) throw new Error('issuer_request_invalid');
  return structuredClone({ ...input, holderRevocationSigner: input.holderRevocationSigner.toLowerCase() });
}

function sameIntent(previous: DirectIssuerRequestRecord, input: DirectIssuerRequestInput, renewalOfRequestId?: string): boolean {
  const intent = (value: DirectIssuerRequestInput) => ({
    serviceAccountRef: value.serviceAccountRef, checkId: value.checkId, idempotencyKey: value.idempotencyKey,
    holderBinding: value.holderBinding, deliveryPublicKey: value.deliveryPublicKey,
    deliveryCapabilityHash: value.deliveryCapabilityHash, holderRevocationSigner: value.holderRevocationSigner.toLowerCase(),
    claims: value.claims, consentText: value.consent?.text,
  });
  // A transport retry may repeat consent later; the first persisted acceptance time remains authoritative.
  return previous.renewalOfRequestId === renewalOfRequestId && isDeepStrictEqual(intent(previous), intent(input));
}

const admissionResult = (record: DirectIssuerRequestRecord) => ({
  requestId: record.requestId, state: record.state, replacementRequired: Boolean(record.replacedAttestationHash),
});

/** @public */
export function createDirectIssuerService(options: DirectIssuerServiceOptions) {
  const now = options.now ?? (() => new Date());

  return {
    async createRequest(raw: DirectIssuerRequestInput): Promise<{ requestId: string; state: DirectIssuerRequestState; replacementRequired: boolean }> {
      const input = snapshotRequest(raw);
      const replacementMode = await options.replacementModeFor(input.checkId);
      if (!['deny', 'replace_after_delivery', 'parallel'].includes(replacementMode)) throw new Error('issuer_replacement_policy_invalid');
      return options.store.withAccountTransaction(input.serviceAccountRef, input.checkId, async store => {
        const previous = await store.findByIdempotency(input.serviceAccountRef, input.idempotencyKey);
        if (previous) {
          if (!sameIntent(previous, input)) throw new Error('issuer_request_idempotency_conflict');
          return admissionResult(previous);
        }
        const active = await store.findActive(input.serviceAccountRef, input.checkId);
        const pending = await store.findPending(input.serviceAccountRef, input.checkId);
        if (replacementMode === 'deny' && (active.length || pending.length)) throw new Error('active_credential_exists');
        if (replacementMode === 'replace_after_delivery' && (pending.length || active.some(record => record.state === 'ready'))) throw new Error('issuer_request_in_progress');
        if (replacementMode === 'replace_after_delivery' && (active.length > 1 || active.some(record => !record.attestationHash))) throw new Error('issuer_replacement_state_invalid');
        const timestamp = now().toISOString();
        const record: DirectIssuerRequestRecord = {
          ...input, requestId: randomId('attest'), state: 'pending', createdAtIso: timestamp, updatedAtIso: timestamp,
          ...(active[0]?.attestationHash && replacementMode === 'replace_after_delivery' ? { replacedAttestationHash: active[0].attestationHash } : {}),
        };
        await store.create(record);
        return admissionResult(record);
      });
    },

    async createRenewalRequest(raw: DirectIssuerRenewalInput): Promise<{ requestId: string; state: DirectIssuerRequestState; replacementRequired: true }> {
      if (!raw || !boundedText(raw.requestId) || !boundedText(raw.deliveryCapability, 2048)
        || Object.keys(raw).some(key => !['requestId', 'deliveryCapability', 'holderBinding', 'deliveryPublicKey', 'deliveryCapabilityHash', 'holderRevocationSigner', 'idempotencyKey'].includes(key))) throw new Error('issuer_renewal_invalid');
      const input = structuredClone(raw);
      const scope = await options.store.get(input.requestId);
      if (!scope || scope.deliveryCapabilityHash !== hashCapability(input.deliveryCapability)) throw new Error('renewal_capability_invalid');
      return options.store.withAccountTransaction(scope.serviceAccountRef, scope.checkId, async store => {
        const previous = await store.get(input.requestId);
        if (!previous || previous.deliveryCapabilityHash !== hashCapability(input.deliveryCapability)) throw new Error('renewal_capability_invalid');
        const next = snapshotRequest({ serviceAccountRef: previous.serviceAccountRef, checkId: previous.checkId,
          holderBinding: input.holderBinding, deliveryPublicKey: input.deliveryPublicKey, deliveryCapabilityHash: input.deliveryCapabilityHash,
          holderRevocationSigner: input.holderRevocationSigner, idempotencyKey: input.idempotencyKey,
          ...(previous.claims ? { claims: previous.claims } : {}), ...(previous.consent ? { consent: previous.consent } : {}),
        });
        const replay = await store.findByIdempotency(previous.serviceAccountRef, input.idempotencyKey);
        if (replay) {
          if (!sameIntent(replay, next, previous.requestId)) throw new Error('issuer_request_idempotency_conflict');
          return { ...admissionResult(replay), replacementRequired: true };
        }
        if (previous.state !== 'delivered' || !previous.attestationHash) throw new Error('credential_not_renewable');
        if (next.deliveryCapabilityHash === previous.deliveryCapabilityHash) throw new Error('issuer_renewal_invalid');
        const pending = await store.findPending(previous.serviceAccountRef, previous.checkId);
        const active = await store.findActive(previous.serviceAccountRef, previous.checkId);
        if (pending.length || active.some(record => record.requestId !== previous.requestId)) throw new Error('issuer_request_in_progress');
        const timestamp = now().toISOString();
        const record: DirectIssuerRequestRecord = { ...next, requestId: randomId('attest'), state: 'pending',
          createdAtIso: timestamp, updatedAtIso: timestamp, replacedAttestationHash: previous.attestationHash, renewalOfRequestId: previous.requestId };
        await store.create(record);
        return { ...admissionResult(record), replacementRequired: true };
      });
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

    async deny(requestId: string, category = 'issuer_denied'): Promise<DirectIssuerRequestRecord> {
      const request = await options.store.get(requestId);
      if (!request || request.state !== 'pending') throw new Error('issuer_request_not_pending');
      const denied: DirectIssuerRequestRecord = {
        ...request,
        state: 'denied',
        failureCategory: category.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 80),
        updatedAtIso: now().toISOString(),
      };
      await options.store.update(denied);
      return denied;
    },

    async list(input?: { state?: DirectIssuerRequestState; serviceAccountRef?: string; limit?: number }) {
      return options.store.list(input);
    },

    async revoke(attestationHash: string, reason = 'issuer_revoked'): Promise<DirectIssuerRequestRecord> {
      const request = await options.store.findByAttestationHash(attestationHash.replace(/^0x/, '').toLowerCase());
      if (request?.state === 'revoked' && request.attestationHash) return request;
      if (!request?.attestationHash || !['ready', 'delivered'].includes(request.state)) throw new Error('active_credential_not_found');
      if (!options.revokeCredential) throw new Error('issuer_revocation_not_configured');
      await options.revokeCredential({ requestId: request.requestId, attestationHash: request.attestationHash, reason });
      const revoked = { ...request, state: 'revoked' as const, updatedAtIso: now().toISOString() };
      await options.store.update(revoked);
      return revoked;
    },

    async authorizeRevocation(input: {
      requestId: string;
      deliveryCapability: string;
      attestationHash: string;
    }): Promise<Pick<DirectIssuerRequestRecord, 'requestId' | 'serviceAccountRef' | 'checkId' | 'attestationHash' | 'state'>> {
      const request = await options.store.get(input.requestId);
      if (!request || request.deliveryCapabilityHash !== hashCapability(input.deliveryCapability)) {
        throw new Error('revocation_capability_invalid');
      }
      const attestationHash = input.attestationHash.replace(/^0x/, '').toLowerCase();
      if (!request.attestationHash || request.attestationHash !== attestationHash) {
        throw new Error('revocation_commitment_mismatch');
      }
      if (!['ready', 'delivered', 'revoked'].includes(request.state)) {
        throw new Error('credential_not_revocable');
      }
      return {
        requestId: request.requestId,
        serviceAccountRef: request.serviceAccountRef,
        checkId: request.checkId,
        attestationHash: request.attestationHash,
        state: request.state,
      };
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
      if (!['ready', 'delivered'].includes(request.state) || typeof attestationHash !== 'string'
        || !/^(?:0x)?[a-fA-F0-9]{64}$/.test(attestationHash)
        || request.attestationHash !== attestationHash.replace(/^0x/, '').toLowerCase()) throw new Error('delivery_acknowledgement_invalid');
      if (request.state === 'delivered') return;
      await options.store.update({ ...request, state: 'delivered', updatedAtIso: now().toISOString() });
      if (request.replacedAttestationHash) {
        await options.revokeReplacedCredential({ requestId, attestationHash: request.replacedAttestationHash });
      }
    },
  };
}

/** @public */
export type DirectIssuerService = ReturnType<typeof createDirectIssuerService>;

/** @public */
export class InMemoryDirectIssuerRequestStore implements DirectIssuerRequestStore {
  private readonly records = new Map<string, DirectIssuerRequestRecord>();
  private revision = 0;
  private transactionTail: Promise<void> = Promise.resolve();
  private transactionScope?: { serviceAccountRef: string; checkId: string };

  public async withAccountTransaction<T>(serviceAccountRef: string, checkId: string, work: (store: DirectIssuerRequestStore) => Promise<T>): Promise<T> {
    if (!boundedText(serviceAccountRef) || !boundedText(checkId)) throw new Error('issuer_request_invalid');
    if (this.transactionScope) throw new Error('issuer_transaction_nested');
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const revision = this.revision;
      const staged = new InMemoryDirectIssuerRequestStore();
      staged.transactionScope = { serviceAccountRef, checkId };
      for (const [id, record] of this.records) staged.records.set(id, structuredClone(record));
      const result = await work(staged);
      // Unfenced callers must not have their writes overwritten by this test-store transaction.
      if (this.revision !== revision) throw new Error('issuer_transaction_conflict');
      this.records.clear();
      for (const [id, record] of staged.records) this.records.set(id, structuredClone(record));
      this.revision++;
      return result;
    } finally {
      release();
    }
  }

  private assertScope(serviceAccountRef: string, checkId?: string): void {
    if (this.transactionScope && (serviceAccountRef !== this.transactionScope.serviceAccountRef
      || (checkId !== undefined && checkId !== this.transactionScope.checkId))) throw new Error('issuer_transaction_scope_invalid');
  }

  public async create(record: DirectIssuerRequestRecord): Promise<void> {
    this.assertScope(record.serviceAccountRef, record.checkId);
    if (this.records.has(record.requestId)) throw new Error('issuer_request_duplicate');
    if ([...this.records.values()].some(value => value.serviceAccountRef === record.serviceAccountRef && value.idempotencyKey === record.idempotencyKey)) throw new Error('issuer_request_idempotency_conflict');
    this.records.set(record.requestId, structuredClone(record));
    this.revision++;
  }

  public async get(requestId: string): Promise<DirectIssuerRequestRecord | undefined> {
    const value = this.records.get(requestId);
    if (value) this.assertScope(value.serviceAccountRef, value.checkId);
    return value ? structuredClone(value) : undefined;
  }

  public async findByIdempotency(serviceAccountRef: string, idempotencyKey: string): Promise<DirectIssuerRequestRecord | undefined> {
    this.assertScope(serviceAccountRef);
    const value = [...this.records.values()].find((record) => record.serviceAccountRef === serviceAccountRef && record.idempotencyKey === idempotencyKey);
    return value ? structuredClone(value) : undefined;
  }

  public async findActive(serviceAccountRef: string, checkId: string): Promise<DirectIssuerRequestRecord[]> {
    this.assertScope(serviceAccountRef, checkId);
    return [...this.records.values()]
      .filter((record) => record.serviceAccountRef === serviceAccountRef && record.checkId === checkId && ['ready', 'delivered'].includes(record.state))
      .map((record) => structuredClone(record));
  }

  public async findPending(serviceAccountRef: string, checkId: string): Promise<DirectIssuerRequestRecord[]> {
    this.assertScope(serviceAccountRef, checkId);
    return [...this.records.values()]
      .filter(record => record.serviceAccountRef === serviceAccountRef && record.checkId === checkId && ['pending', 'anchoring'].includes(record.state))
      .map(record => structuredClone(record));
  }

  public async findByAttestationHash(attestationHash: string): Promise<DirectIssuerRequestRecord | undefined> {
    const value = [...this.records.values()].find((record) => record.attestationHash === attestationHash);
    if (value) this.assertScope(value.serviceAccountRef, value.checkId);
    return value ? structuredClone(value) : undefined;
  }

  public async list(input: { state?: DirectIssuerRequestState; serviceAccountRef?: string; limit?: number } = {}): Promise<DirectIssuerRequestRecord[]> {
    if (this.transactionScope) this.assertScope(input.serviceAccountRef ?? '');
    return [...this.records.values()]
      .filter((record) => (!input.state || record.state === input.state) && (!input.serviceAccountRef || record.serviceAccountRef === input.serviceAccountRef))
      .filter(record => !this.transactionScope || record.checkId === this.transactionScope.checkId)
      .sort((left, right) => right.createdAtIso.localeCompare(left.createdAtIso))
      .slice(0, Math.min(500, Math.max(1, input.limit ?? 100)))
      .map((record) => structuredClone(record));
  }

  public async update(record: DirectIssuerRequestRecord): Promise<void> {
    this.assertScope(record.serviceAccountRef, record.checkId);
    const previous = this.records.get(record.requestId);
    if (!previous) throw new Error('issuer_request_not_found');
    if (previous.serviceAccountRef !== record.serviceAccountRef || previous.checkId !== record.checkId || previous.idempotencyKey !== record.idempotencyKey) throw new Error('issuer_transaction_scope_invalid');
    this.records.set(record.requestId, structuredClone(record));
    this.revision++;
  }
}
