import { generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { UnetApiError } from '@union-networks/client';
import type { UnetClientOptions, UnetMiniAppManifest, VerificationRequestType } from '@union-networks/client';

const DEFAULT_ISSUER = 'https://issuer.egress.live';

export type IssuerAction = 'attestation.approve' | 'attestation.deny' | 'attestation.revoke' | 'issuer.key.register';

export interface IssuerSigner {
  issuerId: string;
  keyId: string;
  privateKeyPem: string;
  publicKeyPem?: string;
}

export interface IssuerActionEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  v: 1;
  issuerId: string;
  keyId: string;
  action: IssuerAction;
  issuedAtIso: string;
  nonce: string;
  payload: TPayload;
  signature: string;
}

export interface RegisterIssuerKeyInput { serviceId: string; issuerId: string; keyId: string; publicKeyPem: string; providerToken?: string; }
export interface AttestationRequest { requestId: string; serviceId: string; scopedUserId: string; requestType: VerificationRequestType | string; status: 'pending' | 'verified' | 'denied' | 'revoked' | string; claims?: Record<string, unknown>; createdAt?: string; updatedAt?: string; decidedAt?: string; reason?: string; }
export interface IssuedAttestation { attestationHash: string; requestId?: string; serviceId?: string; scopedUserId?: string; requestType?: VerificationRequestType | string; status: 'active' | 'revoked' | string; issuedAt?: string; revokedAt?: string; reason?: string; }
export interface CreateAttestationRequestInput { serviceId: string; scopedUserId: string; requestType: VerificationRequestType | string; claims?: Record<string, unknown>; }
export interface ListAttestationRequestsInput { serviceId: string; status?: string; scopedUserId?: string; providerToken?: string; }
export interface ApproveAttestationRequestInput { serviceId: string; requestId: string; signer: IssuerSigner; claims?: Record<string, unknown>; providerToken?: string; }
export interface DenyAttestationRequestInput { serviceId: string; requestId: string; reason?: string; signer: IssuerSigner; providerToken?: string; }
export interface RevokeAttestationInput { serviceId: string; attestationHash: string; reason?: string; signer: IssuerSigner; providerToken?: string; }
export interface IssuerMiniappManifestInput { serviceId: string; name: string; provider: string; launchUrl: string; description?: string; icon?: string; permissions?: string[]; notificationCategories?: string[]; }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const b64url = (bytes: Uint8Array | Buffer): string => Buffer.from(bytes).toString('base64url');
const randomNonce = (): string => b64url(randomBytes(18));

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(',')}}`;
};

const signatureInput = (envelope: Omit<IssuerActionEnvelope, 'signature'>): Buffer => Buffer.from(canonicalize(envelope), 'utf8');
const issuerBase = (options?: UnetClientOptions): string => (options?.issuerBaseUrl ?? DEFAULT_ISSUER).replace(/\/+$/, '');
const fetchImpl = (options?: UnetClientOptions): typeof fetch => {
  const fetcher = options?.fetchImpl ?? globalThis.fetch;
  return ((input, init) => fetcher.call(globalThis, input, init)) as typeof fetch;
};

async function request<T>(path: string, options: { method?: string; body?: unknown; providerToken?: string } = {}, clientOptions?: UnetClientOptions): Promise<T> {
  const response = await fetchImpl(clientOptions)(`${issuerBase(clientOptions)}${path}`, {
    method: options.method ?? 'GET',
    headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.providerToken ? { authorization: `Bearer ${options.providerToken}` } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as unknown : undefined;
  if (!response.ok) {
    const obj = isObject(payload) ? payload : {};
    throw new UnetApiError(typeof obj.message === 'string' ? obj.message : `U-net issuer API error ${response.status}`, response.status, typeof obj.errorCode === 'string' ? obj.errorCode : undefined, payload);
  }
  return payload as T;
}

export function generateIssuerKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export function generateIssuerKeyPairEnv(input: { issuerId?: string; keyId?: string } = {}): string {
  const keys = generateIssuerKeyPair();
  return [
    `UNET_ISSUER_ID=${input.issuerId ?? 'issuer:replace-me'}`,
    `UNET_ISSUER_KEY_ID=${input.keyId ?? 'issuer:replace-me#main'}`,
    `UNET_ISSUER_PRIVATE_KEY_PEM=${JSON.stringify(keys.privateKeyPem)}`,
    `UNET_ISSUER_PUBLIC_KEY_PEM=${JSON.stringify(keys.publicKeyPem)}`,
  ].join('\n');
}

export function createIssuerSignerFromEnv(env: Record<string, string | undefined> = process.env): IssuerSigner {
  const issuerId = env.UNET_ISSUER_ID;
  const keyId = env.UNET_ISSUER_KEY_ID;
  const privateKeyPem = env.UNET_ISSUER_PRIVATE_KEY_PEM;
  if (!issuerId || !keyId || !privateKeyPem) throw new Error('UNET_ISSUER_ID, UNET_ISSUER_KEY_ID, and UNET_ISSUER_PRIVATE_KEY_PEM are required');
  return { issuerId, keyId, privateKeyPem, ...(env.UNET_ISSUER_PUBLIC_KEY_PEM ? { publicKeyPem: env.UNET_ISSUER_PUBLIC_KEY_PEM } : {}) };
}

export function signIssuerAction<TPayload extends Record<string, unknown>>(input: { issuerId: string; keyId: string; privateKeyPem: string; action: IssuerAction; payload: TPayload; issuedAtIso?: string; nonce?: string }): IssuerActionEnvelope<TPayload> {
  const unsigned = { v: 1 as const, issuerId: input.issuerId, keyId: input.keyId, action: input.action, issuedAtIso: input.issuedAtIso ?? new Date().toISOString(), nonce: input.nonce ?? randomNonce(), payload: input.payload };
  return { ...unsigned, signature: b64url(sign(null, signatureInput(unsigned), input.privateKeyPem)) };
}

export function verifyIssuerEnvelopeSignature(envelope: IssuerActionEnvelope, publicKeyPem: string): boolean {
  const { signature, ...unsigned } = envelope;
  try {
    return verify(null, signatureInput(unsigned), publicKeyPem, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}

export function createIssuerMiniappManifest(input: IssuerMiniappManifestInput): UnetMiniAppManifest {
  const permissions = Array.from(new Set(['identity.scoped', 'attestations.request', 'attestations.refresh', ...(input.permissions ?? [])]));
  return { serviceId: input.serviceId, name: input.name, provider: input.provider, description: input.description ?? `Request attestations from ${input.provider}.`, ...(input.icon ? { icon: input.icon } : {}), launchUrl: input.launchUrl, permissions, ...(input.notificationCategories ? { notificationCategories: input.notificationCategories } : {}) };
}

export const registerIssuerKey = (input: RegisterIssuerKeyInput, options?: UnetClientOptions) => request<{ success: true; issuerId: string; keyId: string }>('/v1/issuer/keys/register', { method: 'POST', providerToken: input.providerToken, body: { serviceId: input.serviceId, issuerId: input.issuerId, keyId: input.keyId, publicKeyPem: input.publicKeyPem } }, options);
export const createAttestationRequest = (input: CreateAttestationRequestInput, options?: UnetClientOptions) => request<{ success: true; request: AttestationRequest }>('/v1/issuer/attestation-requests', { method: 'POST', body: input }, options);
export const listAttestationRequests = (input: ListAttestationRequestsInput, options?: UnetClientOptions) => {
  const query = new URLSearchParams({ serviceId: input.serviceId });
  if (input.status) query.set('status', input.status);
  if (input.scopedUserId) query.set('scopedUserId', input.scopedUserId);
  return request<{ success: true; requests: AttestationRequest[] }>(`/v1/issuer/attestation-requests?${query.toString()}`, { providerToken: input.providerToken }, options);
};
export const approveAttestationRequest = (input: ApproveAttestationRequestInput, options?: UnetClientOptions) => {
  const envelope = signIssuerAction({ issuerId: input.signer.issuerId, keyId: input.signer.keyId, privateKeyPem: input.signer.privateKeyPem, action: 'attestation.approve', payload: { serviceId: input.serviceId, requestId: input.requestId, claims: input.claims ?? {} } });
  return request<{ success: true; request: AttestationRequest; attestation?: IssuedAttestation }>(`/v1/issuer/attestation-requests/${encodeURIComponent(input.requestId)}/decision`, { method: 'POST', providerToken: input.providerToken, body: { serviceId: input.serviceId, decision: 'verify', envelope } }, options);
};
export const denyAttestationRequest = (input: DenyAttestationRequestInput, options?: UnetClientOptions) => {
  const envelope = signIssuerAction({ issuerId: input.signer.issuerId, keyId: input.signer.keyId, privateKeyPem: input.signer.privateKeyPem, action: 'attestation.deny', payload: { serviceId: input.serviceId, requestId: input.requestId, reason: input.reason ?? 'Denied by issuer' } });
  return request<{ success: true; request: AttestationRequest }>(`/v1/issuer/attestation-requests/${encodeURIComponent(input.requestId)}/decision`, { method: 'POST', providerToken: input.providerToken, body: { serviceId: input.serviceId, decision: 'deny', reason: input.reason, envelope } }, options);
};
export const listIssuedAttestations = (input: { serviceId: string; scopedUserId?: string; providerToken?: string }, options?: UnetClientOptions) => {
  const query = new URLSearchParams({ serviceId: input.serviceId });
  if (input.scopedUserId) query.set('scopedUserId', input.scopedUserId);
  return request<{ success: true; attestations: IssuedAttestation[] }>(`/v1/issuer/attestations?${query.toString()}`, { providerToken: input.providerToken }, options);
};
export const revokeAttestation = (input: RevokeAttestationInput, options?: UnetClientOptions) => {
  const envelope = signIssuerAction({ issuerId: input.signer.issuerId, keyId: input.signer.keyId, privateKeyPem: input.signer.privateKeyPem, action: 'attestation.revoke', payload: { serviceId: input.serviceId, attestationHash: input.attestationHash, reason: input.reason ?? 'Revoked by issuer' } });
  return request<{ success: true; attestationHash: string; status: string }>(`/v1/issuer/attestations/${encodeURIComponent(input.attestationHash)}/revoke`, { method: 'POST', providerToken: input.providerToken, body: { serviceId: input.serviceId, reason: input.reason, envelope } }, options);
};
