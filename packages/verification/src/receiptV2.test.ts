import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyVerificationV2Receipt } from './receiptV2.js';
import type { VerificationV2ReceiptExpected } from './receiptV2.js';
import type { VerificationV2Jwks, VerificationV2ReceiptPayload } from '@u-net/client';

const pair = generateKeyPairSync('ed25519');
const publicKey = pair.publicKey.export({ format: 'jwk' });
const jwks: VerificationV2Jwks = { keys: [{ kty: 'OKP', crv: 'Ed25519', x: publicKey.x!, kid: 'result-1', alg: 'EdDSA', use: 'sig', status: 'active' }] };
const expected: VerificationV2ReceiptExpected = { verifierOrigin: 'https://verifier.test', audience: 'https://verifier.test', sessionId: 'sssssssssssssssssssssssssssssssssssssssssss', requestRef: 'rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr', nonce: '11111111111111111111111111111111111111111111111111111111111111', requestedChecksDigest: 'a'.repeat(64), requestTypes: ['age_over_18'], expiresAt: '2026-10-13T12:10:00.000Z' };
const payload: VerificationV2ReceiptPayload = { protocolVersion: 2, iss: expected.verifierOrigin, aud: expected.audience, sessionId: expected.sessionId, requestRefHash: createHash('sha256').update(expected.requestRef, 'utf8').digest('hex'), nonce: expected.nonce, requestedChecksDigest: expected.requestedChecksDigest, checkedAt: '2026-10-13T12:01:00.000Z', checkResults: [{ requestType: 'age_over_18', status: 'passed', reasonCode: 'verification_succeeded' }] };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const receipt = (value: unknown = payload, header: unknown = { alg: 'EdDSA', typ: 'unet-verification-result+JWT', kid: 'result-1' }) => {
  const input = `${encode(header)}.${encode(value)}`;
  return `${input}.${sign(null, Buffer.from(input), pair.privateKey).toString('base64url')}`;
};
const now = Date.parse('2026-10-13T12:05:00.000Z');
afterEach(() => vi.unstubAllGlobals());

describe('signed V2 historical receipts', () => {
  it.each([
    { status: 'passed', reasonCode: 'attestation_revoked' },
    { status: 'failed', reasonCode: 'verification_succeeded' },
    { status: 'declined', reasonCode: 'invalid_proof' },
    { status: 'failed', reasonCode: 'holder_denied' },
    { status: 'failed', reasonCode: 'dependency_unavailable' },
    { status: 'unavailable', reasonCode: 'dependency_unavailable' },
  ])('rejects signed noncanonical status/reason pairs', async result => {
    await expect(verifyVerificationV2Receipt(receipt({ ...payload, checkResults: [{ requestType: 'age_over_18', ...result }] }), expected, jwks, { now })).rejects.toThrow('receipt_invalid');
  });
  it('rejects noncanonical signed timestamps, nonces, and oversized receipts', async () => {
    await expect(verifyVerificationV2Receipt(receipt({ ...payload, checkedAt: '2026-10-13T12:01:00Z' }), expected, jwks, { now })).rejects.toThrow('receipt_invalid');
    const altered = { ...expected, nonce: 'not-a-field-nonce' };
    await expect(verifyVerificationV2Receipt(receipt({ ...payload, nonce: altered.nonce }), altered, jwks, { now })).rejects.toThrow('receipt_invalid');
    await expect(verifyVerificationV2Receipt('a'.repeat(32_769), expected, jwks, { now })).rejects.toThrow('receipt_invalid');
  });
  it('rejects more than eight signed outcomes', async () => {
    const requestTypes = Array.from({ length: 9 }, (_, index) => `check_${index}`);
    const checkResults = requestTypes.map(requestType => ({ requestType, status: 'passed', reasonCode: 'verification_succeeded' }));
    await expect(verifyVerificationV2Receipt(receipt({ ...payload, checkResults }), { ...expected, requestTypes }, jwks, { now })).rejects.toThrow('receipt_invalid');
  });
  it('verifies independently Node-signed receipts using Noble without WebCrypto', async () => {
    vi.stubGlobal('crypto', undefined);
    await expect(verifyVerificationV2Receipt(receipt(), expected, jwks, { now })).resolves.toEqual(payload);
  });
  it('accepts retained keys and old checked-at times, never as current authorization', async () => {
    await expect(verifyVerificationV2Receipt(receipt(), expected, { keys: [{ ...jwks.keys[0], status: 'retained' }] }, { now: now + 365 * 86_400_000 })).resolves.toEqual(payload);
  });
  it('rejects payload tampering', async () => {
    const original = receipt().split('.');
    await expect(verifyVerificationV2Receipt(`${original[0]}.${encode({ ...payload, nonce: 'tampered' })}.${original[2]}`, expected, jwks, { now })).rejects.toThrow('receipt_invalid');
  });
  it.each(['sessionId', 'nonce', 'requestRef', 'requestedChecksDigest', 'audience', 'verifierOrigin'])('rejects mismatched expected %s', async field => {
    await expect(verifyVerificationV2Receipt(receipt(), { ...expected, [field]: 'wrong' }, jwks, { now })).rejects.toThrow('receipt_invalid');
  });
  it.each(['holderUserId', 'scopedUserId', 'commitment', 'proof', 'unrequestedClaim'])('rejects extra signed payload claim %s', async field => {
    await expect(verifyVerificationV2Receipt(receipt({ ...payload, [field]: 'extra' }), expected, jwks, { now })).rejects.toThrow('receipt_invalid');
  });
  it.each(['revoked', 'unknown', 'duplicate'])('rejects %s key IDs', async mode => {
    const keys = mode === 'duplicate' ? [jwks.keys[0], jwks.keys[0]] : mode === 'unknown' ? [] : [{ ...jwks.keys[0], status: 'revoked' as const }];
    await expect(verifyVerificationV2Receipt(receipt(), expected, { keys }, { now })).rejects.toThrow('receipt_invalid');
  });
  it.each([{ alg: 'HS256', typ: 'unet-verification-result+JWT', kid: 'result-1' }, { alg: 'EdDSA', typ: 'JWT', kid: 'result-1' }, { alg: 'EdDSA', typ: 'unet-verification-result+JWT', kid: 'result-1', jku: 'https://attacker.test' }])('rejects algorithm/type/key-source confusion', async header => {
    await expect(verifyVerificationV2Receipt(receipt(payload, header), expected, jwks, { now })).rejects.toThrow('receipt_invalid');
  });
  it('rejects private, mismatched, or wrong-curve key material', async () => {
    for (const key of [{ ...jwks.keys[0], crv: 'X25519' }, { ...jwks.keys[0], d: 'private' }, { ...jwks.keys[0], x: 'A'.repeat(43) }]) {
      await expect(verifyVerificationV2Receipt(receipt(), expected, { keys: [key] } as VerificationV2Jwks, { now })).rejects.toThrow('receipt_invalid');
    }
  });
  it('rejects future results and acceptance after the trusted challenge expiry', async () => {
    await expect(verifyVerificationV2Receipt(receipt({ ...payload, checkedAt: new Date(now + 30_001).toISOString() }), expected, jwks, { now })).rejects.toThrow('receipt_invalid');
    await expect(verifyVerificationV2Receipt(receipt({ ...payload, checkedAt: '2026-10-13T12:10:01.000Z' }), expected, jwks, { now: now + 1_000_000 })).rejects.toThrow('receipt_invalid');
  });
  it('rejects extra, missing and duplicated requested outcomes', async () => {
    for (const checkResults of [[], [...payload.checkResults, ...payload.checkResults], [{ ...payload.checkResults[0], requestType: 'unrequested' }], [{ ...payload.checkResults[0], rawError: 'secret' }]]) {
      await expect(verifyVerificationV2Receipt(receipt({ ...payload, checkResults }), expected, jwks, { now })).rejects.toThrow('receipt_invalid');
    }
  });
});
