import { createPrivateKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { BarretenbergSync } from '@aztec/bb.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { UnetApiError } from '@union-networks/client';
import type { UnetClientOptions, UnetMiniAppManifest, VerificationRequestType } from '@union-networks/client';

const DEFAULT_ISSUER = 'https://issuer.egress.live';

export type IssuerAction = 'attestation.approve' | 'attestation.deny' | 'attestation.revoke' | 'issuer.key.register';

export interface IssuerSigner {
  issuerId: string;
  keyId: string;
  privateKeyPem: string;
  publicKeyPem?: string;
  credentialKeyId?: string;
  credentialPrivateKeyPem?: string;
  credentialPublicKeyPem?: string;
  credentialSignatureScheme?: 'ecdsa_secp256k1_compact_low_s';
}

export interface CredentialClaimV2 {
  path: string;
  type: 'field' | 'u64' | 'string' | 'boolean';
  value: string | number | boolean;
}

export interface CredentialClaimProofV2 extends CredentialClaimV2 {
  pathField: string;
  typeField: string;
  valueField: string;
  salt: string;
  siblings: string[];
  pathBits: boolean[];
}

export interface CredentialEnvelopeV2 {
  version: 2;
  requestType: string;
  schemaId: string;
  schemaIdField: string;
  issuerId: string;
  issuerKeyId: string;
  issuerKeyIdField: string;
  issuerCredentialKeyId: string;
  issuerPublicKeyX: string;
  issuerPublicKeyY: string;
  issuerKeyHash: string;
  holderBinding: string;
  validFromEpoch: number;
  validUntilEpoch: number;
  statusEpoch: number;
  claimsRoot: string;
  commitmentSalt: string;
  attestationCommitment: string;
  messageHash: string;
  signature: string;
  claims: CredentialClaimProofV2[];
}

export interface EncryptedCredentialEnvelopeV2 {
  version: 2;
  algorithm: 'x25519-xchacha20poly1305';
  senderPublicKey: string;
  nonce: string;
  ciphertext: string;
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
export interface AttestationRequest { requestId: string; serviceId: string; scopedUserId: string; requestType: VerificationRequestType | string; status: 'pending' | 'verified' | 'denied' | 'revoked' | string; claims?: Record<string, unknown>; holderBinding?: string; deliveryPublicKey?: string; schemaId?: string; statusEpoch?: number; createdAt?: string; updatedAt?: string; decidedAt?: string; reason?: string; }
export interface IssuedAttestation { attestationHash: string; requestId?: string; serviceId?: string; scopedUserId?: string; requestType?: VerificationRequestType | string; status: 'active' | 'revoked' | string; issuedAt?: string; revokedAt?: string; reason?: string; }
export interface CreateAttestationRequestInput { serviceId: string; scopedUserId: string; requestType: VerificationRequestType | string; claims?: Record<string, unknown>; holderBinding: string; deliveryPublicKey: string; }
export interface ListAttestationRequestsInput { serviceId: string; status?: string; scopedUserId?: string; providerToken?: string; }
export interface ApproveAttestationRequestInput { serviceId: string; requestId: string; signer: IssuerSigner; claims?: Record<string, unknown>; credential: { requestType: string; schemaId: string; holderBinding: string; deliveryPublicKey: string; validFromEpoch?: number; validUntilEpoch: number; statusEpoch?: number; }; providerToken?: string; }
export interface DenyAttestationRequestInput { serviceId: string; requestId: string; reason?: string; signer: IssuerSigner; providerToken?: string; }
export interface RevokeAttestationInput { serviceId: string; attestationHash: string; reason?: string; signer: IssuerSigner; providerToken?: string; }
export interface IssuerMiniappManifestInput { serviceId: string; name: string; provider: string; launchUrl: string; description?: string; icon?: string; permissions?: string[]; notificationCategories?: string[]; }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const b64url = (bytes: Uint8Array | Buffer): string => Buffer.from(bytes).toString('base64url');
const randomNonce = (): string => b64url(randomBytes(18));
const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const CLAIM_TREE_DEPTH = 8;
const utf8 = new TextEncoder();
const field = (value: bigint): bigint => ((value % FIELD_MODULUS) + FIELD_MODULUS) % FIELD_MODULUS;
const fieldString = (value: bigint): string => field(value).toString(10);
const bytesToBigInt = (value: Uint8Array): bigint => BigInt(`0x${Buffer.from(value).toString('hex') || '0'}`);
const bigIntToBuffer = (value: bigint): Buffer => Buffer.from(field(value).toString(16).padStart(64, '0'), 'hex');
// A 31-byte digest prefix is always below the BN254 modulus and has the same
// canonical encoding in the SDK, mobile witness builder, and Noir fixtures.
const hashToField = (value: string): bigint => bytesToBigInt(sha256(utf8.encode(value)).slice(0, 31));
const base64urlBytes = (value: string): Uint8Array => Buffer.from(value, 'base64url');

let bbPromise: Promise<BarretenbergSync> | undefined;
const bb = (): Promise<BarretenbergSync> => bbPromise ??= BarretenbergSync.initSingleton();
const pedersen = async (values: bigint[]): Promise<bigint> => {
  const api = await bb();
  const result = api.pedersenHash({ inputs: values.map(bigIntToBuffer), hashIndex: 0 });
  return field(bytesToBigInt(result.hash));
};

const claimTypeField = (type: CredentialClaimV2['type']): bigint => ({ field: 1n, u64: 2n, string: 3n, boolean: 4n })[type];
const claimValueField = (claim: CredentialClaimV2): bigint => {
  if (claim.type === 'boolean') return claim.value === true ? 1n : 0n;
  if (claim.type === 'u64' || claim.type === 'field') return field(BigInt(String(claim.value)));
  return hashToField(String(claim.value));
};
const randomField = (): bigint => field(bytesToBigInt(randomBytes(32)));

export async function deriveHolderBindingV2(holderSecret: string): Promise<string> {
  return fieldString(await pedersen([field(BigInt(holderSecret))]));
}

export async function derivePredicateV2(input: {
  proofProfileId: string;
  schemaId: string;
  claimPath?: string;
  claimType?: CredentialClaimV2['type'];
  expectedValue?: string | number | boolean;
  lowerBound?: number;
  upperBound?: number;
  setRoot?: string;
}): Promise<string> {
  const tags: Record<string, bigint> = {
    credential_valid_v1: 1001n,
    claim_equals_v1: 1002n,
    claim_range_v1: 1003n,
    claim_present_v1: 1004n,
    claim_set_membership_v1: 1005n,
    credential_not_expired_v1: 1006n,
    credential_issuer_member_v1: 1007n,
  };
  const tag = tags[input.proofProfileId];
  if (!tag) throw new Error(`unsupported_proof_profile:${input.proofProfileId}`);
  const schema = hashToField(input.schemaId);
  const claimPath = input.claimPath ? hashToField(input.claimPath) : 0n;
  let a = 0n;
  let b = 0n;
  if (input.proofProfileId === 'claim_range_v1') {
    a = BigInt(input.lowerBound ?? 0);
    b = BigInt(input.upperBound ?? 0);
  } else if (input.proofProfileId === 'claim_equals_v1') {
    const type = input.claimType ?? 'string';
    a = claimTypeField(type);
    b = claimValueField({ path: input.claimPath ?? '', type, value: input.expectedValue ?? '' });
  } else if (input.proofProfileId === 'claim_present_v1') {
    a = claimTypeField(input.claimType ?? 'string');
  } else if (input.proofProfileId === 'claim_set_membership_v1') {
    a = claimTypeField(input.claimType ?? 'string');
    b = field(BigInt(input.setRoot ?? '0'));
  } else if (input.proofProfileId === 'credential_issuer_member_v1') {
    a = field(BigInt(input.setRoot ?? '0'));
  }
  return fieldString(await pedersen([tag, schema, claimPath, a, b]));
}

export async function deriveNullifierV2(input: { holderSecret: string; attestationCommitment: string; nonce: string; predicate: string }): Promise<string> {
  return fieldString(await pedersen([
    field(BigInt(input.holderSecret)),
    field(BigInt(`0x${input.attestationCommitment}`)),
    field(BigInt(input.nonce)),
    field(BigInt(input.predicate)),
  ]));
}

export function generateCredentialSigningKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

const merkleParent = (left: bigint, right: bigint): Promise<bigint> => pedersen([left, right]);

export async function buildFieldMerkleProofV2(input: { leaves: string[]; selectedIndex: number }): Promise<{
  root: string;
  siblings: string[];
  pathBits: boolean[];
}> {
  if (!input.leaves.length || input.leaves.length > 2 ** CLAIM_TREE_DEPTH) throw new Error('invalid_merkle_leaf_count');
  if (!Number.isInteger(input.selectedIndex) || input.selectedIndex < 0 || input.selectedIndex >= input.leaves.length) throw new Error('invalid_merkle_selected_index');
  const width = 2 ** CLAIM_TREE_DEPTH;
  const levels: bigint[][] = [Array.from({ length: width }, (_, index) => index < input.leaves.length ? field(BigInt(input.leaves[index]!)) : 0n)];
  for (let depth = 0; depth < CLAIM_TREE_DEPTH; depth += 1) {
    const previous = levels[depth]!;
    const next: bigint[] = [];
    for (let index = 0; index < previous.length; index += 2) next.push(await merkleParent(previous[index]!, previous[index + 1]!));
    levels.push(next);
  }
  let index = input.selectedIndex;
  const siblings: string[] = [];
  const pathBits: boolean[] = [];
  for (let depth = 0; depth < CLAIM_TREE_DEPTH; depth += 1) {
    siblings.push(fieldString(levels[depth]![index ^ 1]!));
    pathBits.push((index & 1) === 1);
    index >>= 1;
  }
  return { root: fieldString(levels[CLAIM_TREE_DEPTH]![0]!), siblings, pathBits };
}

export async function deriveClaimLeafV2(claim: CredentialClaimV2, salt: string): Promise<string> {
  return fieldString(await pedersen([
    hashToField(claim.path),
    claimTypeField(claim.type),
    claimValueField(claim),
    field(BigInt(salt)),
  ]));
}
const buildClaimsTree = async (claims: CredentialClaimV2[], configuredSalts?: string[]) => {
  if (!claims.length) throw new Error('credential_claims_required');
  if (claims.length > 2 ** CLAIM_TREE_DEPTH) throw new Error('credential_claim_limit_exceeded');
  const sorted = [...claims].sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(sorted.map((item) => item.path)).size !== sorted.length) throw new Error('credential_claim_paths_must_be_unique');
  if (configuredSalts && configuredSalts.length !== sorted.length) throw new Error('credential_claim_salt_count_mismatch');
  const salts = sorted.map((_, index) => configuredSalts ? field(BigInt(configuredSalts[index]!)) : randomField());
  const leaves = await Promise.all(sorted.map(async (claim, index) => pedersen([
    hashToField(claim.path), claimTypeField(claim.type), claimValueField(claim), salts[index]!,
  ])));
  const width = 2 ** CLAIM_TREE_DEPTH;
  const levels: bigint[][] = [Array.from({ length: width }, (_, index) => leaves[index] ?? 0n)];
  for (let depth = 0; depth < CLAIM_TREE_DEPTH; depth += 1) {
    const previous = levels[depth]!;
    const next: bigint[] = [];
    for (let index = 0; index < previous.length; index += 2) next.push(await merkleParent(previous[index]!, previous[index + 1]!));
    levels.push(next);
  }
  return {
    root: levels[CLAIM_TREE_DEPTH]![0]!,
    proofs: sorted.map((claim, claimIndex): CredentialClaimProofV2 => {
      let index = claimIndex;
      const siblings: string[] = [];
      const pathBits: boolean[] = [];
      for (let depth = 0; depth < CLAIM_TREE_DEPTH; depth += 1) {
        siblings.push(fieldString(levels[depth]![index ^ 1]!));
        pathBits.push((index & 1) === 1);
        index >>= 1;
      }
      return {
        ...claim,
        pathField: fieldString(hashToField(claim.path)),
        typeField: fieldString(claimTypeField(claim.type)),
        valueField: fieldString(claimValueField(claim)),
        salt: fieldString(salts[claimIndex]!),
        siblings,
        pathBits,
      };
    }),
  };
};

const credentialKeyMaterial = (privateKeyPem: string) => {
  const jwk = createPrivateKey(privateKeyPem).export({ format: 'jwk' });
  if (jwk.crv !== 'secp256k1' || !jwk.d || !jwk.x || !jwk.y) throw new Error('credential_key_must_be_secp256k1');
  return { privateKey: base64urlBytes(jwk.d), x: base64urlBytes(jwk.x), y: base64urlBytes(jwk.y) };
};

export async function createCredentialEnvelopeV2(input: {
  requestType: string;
  schemaId: string;
  issuerId: string;
  issuerKeyId: string;
  issuerCredentialKeyId: string;
  credentialPrivateKeyPem: string;
  holderBinding: string;
  validFromEpoch: number;
  validUntilEpoch: number;
  statusEpoch: number;
  claims: CredentialClaimV2[];
  commitmentSalt?: string;
  claimSalts?: string[];
}): Promise<CredentialEnvelopeV2> {
  const key = credentialKeyMaterial(input.credentialPrivateKeyPem);
  const issuerKeyHash = await pedersen([
    bytesToBigInt(key.x.slice(0, 31)), BigInt(key.x[31]!),
    bytesToBigInt(key.y.slice(0, 31)), BigInt(key.y[31]!),
  ]);
  const tree = await buildClaimsTree(input.claims, input.claimSalts);
  const schemaIdField = hashToField(input.schemaId);
  const issuerKeyIdField = hashToField(input.issuerCredentialKeyId);
  const commitmentSalt = input.commitmentSalt ? field(BigInt(input.commitmentSalt)) : randomField();
  const commitment = await pedersen([
    schemaIdField,
    issuerKeyIdField,
    issuerKeyHash,
    field(BigInt(input.holderBinding)),
    BigInt(input.validFromEpoch),
    BigInt(input.validUntilEpoch),
    BigInt(input.statusEpoch),
    tree.root,
    commitmentSalt,
  ]);
  const messageHash = Buffer.alloc(32);
  let remainder = commitment;
  for (let index = 0; index < 32; index += 1) {
    messageHash[index] = Number(remainder & 255n);
    remainder >>= 8n;
  }
  const signature = secp256k1.sign(messageHash, key.privateKey, { lowS: true, prehash: false }).toCompactRawBytes();
  return {
    version: 2,
    requestType: input.requestType,
    schemaId: input.schemaId,
    schemaIdField: fieldString(schemaIdField),
    issuerId: input.issuerId,
    issuerKeyId: input.issuerKeyId,
    issuerKeyIdField: fieldString(issuerKeyIdField),
    issuerCredentialKeyId: input.issuerCredentialKeyId,
    issuerPublicKeyX: b64url(key.x),
    issuerPublicKeyY: b64url(key.y),
    issuerKeyHash: fieldString(issuerKeyHash),
    holderBinding: fieldString(BigInt(input.holderBinding)),
    validFromEpoch: input.validFromEpoch,
    validUntilEpoch: input.validUntilEpoch,
    statusEpoch: input.statusEpoch,
    claimsRoot: fieldString(tree.root),
    commitmentSalt: fieldString(commitmentSalt),
    attestationCommitment: commitment.toString(16).padStart(64, '0'),
    messageHash: b64url(messageHash),
    signature: b64url(signature),
    claims: tree.proofs,
  };
}

export function encryptCredentialEnvelopeV2(envelope: CredentialEnvelopeV2, recipientPublicKey: string): EncryptedCredentialEnvelopeV2 {
  const ephemeral = x25519.keygen(randomBytes(32));
  const shared = x25519.getSharedSecret(ephemeral.secretKey, base64urlBytes(recipientPublicKey));
  const key = hkdf(sha256, shared, utf8.encode('unet-credential-delivery-v2'), utf8.encode('credential-envelope'), 32);
  const nonce = randomBytes(24);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(utf8.encode(JSON.stringify(envelope)));
  return { version: 2, algorithm: 'x25519-xchacha20poly1305', senderPublicKey: b64url(ephemeral.publicKey), nonce: b64url(nonce), ciphertext: b64url(ciphertext) };
}

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
  if (!input.signer.credentialKeyId || !input.signer.credentialPrivateKeyPem) throw new Error('issuer_credential_signing_key_required');
  const nowEpoch = Math.floor(Date.now() / 1000);
  return createCredentialEnvelopeV2({
    requestType: input.credential.requestType,
    schemaId: input.credential.schemaId,
    issuerId: input.signer.issuerId,
    issuerKeyId: input.signer.keyId,
    issuerCredentialKeyId: input.signer.credentialKeyId,
    credentialPrivateKeyPem: input.signer.credentialPrivateKeyPem,
    holderBinding: input.credential.holderBinding,
    validFromEpoch: input.credential.validFromEpoch ?? nowEpoch,
    validUntilEpoch: input.credential.validUntilEpoch,
    statusEpoch: input.credential.statusEpoch ?? 1,
    claims: Object.entries(input.claims ?? {}).map(([path, value]) => ({
      path,
      type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'u64' : 'string',
      value: value as string | number | boolean,
    })),
  }).then((credentialEnvelope) => {
    const encryptedCredentialEnvelope = encryptCredentialEnvelopeV2(credentialEnvelope, input.credential.deliveryPublicKey);
    const envelope = signIssuerAction({
      issuerId: input.signer.issuerId,
      keyId: input.signer.keyId,
      privateKeyPem: input.signer.privateKeyPem,
      action: 'attestation.approve',
      payload: {
        serviceId: input.serviceId,
        requestId: input.requestId,
        attestationHash: credentialEnvelope.attestationCommitment,
        credentialPublicMetadata: {
          version: 2,
          schemaId: credentialEnvelope.schemaId,
          schemaIdField: credentialEnvelope.schemaIdField,
          issuerCredentialKeyId: credentialEnvelope.issuerCredentialKeyId,
          issuerKeyHash: credentialEnvelope.issuerKeyHash,
          statusEpoch: credentialEnvelope.statusEpoch,
        },
        encryptedCredentialEnvelope,
      },
    });
    return request<{ success: true; request: AttestationRequest; attestation?: IssuedAttestation }>(`/v1/issuer/attestation-requests/${encodeURIComponent(input.requestId)}/decision`, { method: 'POST', providerToken: input.providerToken, body: { serviceId: input.serviceId, decision: 'verify', envelope } }, options);
  });
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
