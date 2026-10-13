import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { VerificationV2Jwks, VerificationV2ReceiptPayload } from './verificationV2Types.js';
import { isVerificationV2Reference, isVerificationV2RequestType, isVerificationV2Timestamp, validateV2CheckResults } from './verificationV2Validation.js';

/** Independently trusted challenge binding, never copied from an untrusted receipt. @public */
export interface VerificationV2ReceiptExpected {
  verifierOrigin: string;
  audience: string;
  sessionId: string;
  requestRef: string;
  nonce: string;
  requestedChecksDigest: string;
  requestTypes: string[];
  expiresAt?: string;
}

/** Optional verification clock in milliseconds; receipts remain point-in-time results. @public */
export interface VerificationV2ReceiptOptions { now?: number; }

function invalid(): never { throw new Error('verification_v2_receipt_invalid'); }
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid();
const exactKeys = (v: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) invalid();
};
const decode = (part: string): Uint8Array<ArrayBuffer> => {
  if (!part || !/^[A-Za-z0-9_-]+$/.test(part) || part.length % 4 === 1) invalid();
  let raw: string;
  try { raw = atob(part.replace(/-/g, '+').replace(/_/g, '/')); } catch { return invalid(); }
  if (btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== part) invalid();
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};
const json = (part: string): Record<string, unknown> => {
  try { return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(part)))); } catch { return invalid(); }
};
const digest = (value: string): string => Array.from(sha256(new TextEncoder().encode(value)), byte => byte.toString(16).padStart(2, '0')).join('');

/** Verify a compact EdDSA historical result against a trusted challenge and origin-pinned
 * JWKS. Retained keys verify history; revoked/unknown keys, extra claims, wrong bindings
 * and key confusion are rejected. This is not current lifecycle authorization.
 * @public
 */
export async function verifyVerificationV2Receipt(receipt: string, expected: VerificationV2ReceiptExpected, jwks: VerificationV2Jwks, options: VerificationV2ReceiptOptions = {}): Promise<VerificationV2ReceiptPayload> {
  if (typeof receipt !== 'string' || receipt.length > 32_768) invalid();
  let origin: URL;
  try { origin = new URL(expected.verifierOrigin); } catch { return invalid(); }
  if (expected.verifierOrigin.length > 2048 || origin.protocol !== 'https:' || origin.origin !== expected.verifierOrigin || origin.username || origin.password || expected.audience !== origin.origin) invalid();
  if (!isVerificationV2Reference(expected.sessionId) || !isVerificationV2Reference(expected.requestRef) || !/^[a-f0-9]{62}$/.test(expected.nonce)) invalid();
  if (!/^[a-f0-9]{64}$/.test(expected.requestedChecksDigest) || !Array.isArray(expected.requestTypes) || !expected.requestTypes.length || expected.requestTypes.length > 8
    || expected.requestTypes.some(t => !isVerificationV2RequestType(t)) || new Set(expected.requestTypes).size !== expected.requestTypes.length) invalid();
  if (expected.expiresAt !== undefined && !isVerificationV2Timestamp(expected.expiresAt)) invalid();
  const parts = receipt.split('.');
  if (parts.length !== 3) invalid();
  const header = json(parts[0]);
  exactKeys(header, ['alg', 'typ', 'kid']);
  if (header.alg !== 'EdDSA' || header.typ !== 'unet-verification-result+JWT' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 160) invalid();
  const keys = object(jwks);
  exactKeys(keys, ['keys']);
  if (!Array.isArray(keys.keys)) invalid();
  const ids = new Set<string>();
  for (const value of keys.keys) {
    const key = object(value);
    exactKeys(key, ['kty', 'crv', 'x', 'kid', 'alg', 'use', 'status']);
    if (key.kty !== 'OKP' || key.crv !== 'Ed25519' || key.alg !== 'EdDSA' || key.use !== 'sig'
      || !['active', 'retained', 'revoked'].includes(key.status as string) || typeof key.kid !== 'string' || !key.kid || key.kid.length > 160 || ids.has(key.kid)
      || typeof key.x !== 'string' || decode(key.x).length !== 32) invalid();
    ids.add(key.kid);
  }
  const key = jwks.keys.find(k => k.kid === header.kid);
  if (!key || key.status === 'revoked') invalid();
  const signature = decode(parts[2]);
  if (signature.length !== 64) invalid();
  try {
    if (!ed25519.verify(signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`), decode(key.x), { zip215: false })) invalid();
  } catch { return invalid(); }
  const payload = json(parts[1]);
  exactKeys(payload, ['protocolVersion', 'iss', 'aud', 'sessionId', 'requestRefHash', 'nonce', 'requestedChecksDigest', 'checkedAt', 'checkResults']);
  if (payload.protocolVersion !== 2 || payload.iss !== expected.verifierOrigin || payload.aud !== expected.audience
    || payload.sessionId !== expected.sessionId || payload.nonce !== expected.nonce || payload.requestedChecksDigest !== expected.requestedChecksDigest
    || payload.requestRefHash !== digest(expected.requestRef) || !isVerificationV2Timestamp(payload.checkedAt)) invalid();
  const checkedAt = Date.parse(payload.checkedAt as string);
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now) || checkedAt > now + 30_000 || (expected.expiresAt !== undefined && checkedAt > Date.parse(expected.expiresAt))) invalid();
  if (!Array.isArray(payload.checkResults) || payload.checkResults.length !== expected.requestTypes.length) invalid();
  try { validateV2CheckResults(payload.checkResults, true); } catch { return invalid(); }
  const remaining = new Set(expected.requestTypes);
  for (const value of payload.checkResults) {
    const result = object(value); exactKeys(result, ['requestType', 'status', 'reasonCode']);
    if (typeof result.requestType !== 'string' || !remaining.delete(result.requestType)) invalid();
  }
  return payload as unknown as VerificationV2ReceiptPayload;
}
