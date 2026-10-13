import type { VerificationV2Check } from './verificationV2Types.js';
import { sha256 } from '@noble/hashes/sha2.js';

/** Stable request-binding JSON; recursively sorts object keys, preserving array order.
 * Mirrors canonical trust-plane semantics, including omitted undefined object keys.
 * @public
 */
export function canonicalVerificationV2Json(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input)
      .filter(([, item]) => item !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, sort(item)]));
    throw new Error('verification_v2_json_invalid');
  };
  return JSON.stringify(sort(value));
}

/** SHA-256 of recursively canonicalized approved checks, preserving check order. @public */
export async function verificationV2RequestedChecksDigest(checks: VerificationV2Check[]): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalVerificationV2Json(checks));
  return Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
