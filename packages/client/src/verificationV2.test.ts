import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalVerificationV2Json, createVerificationV2Session, getVerificationV2Challenge, getVerificationV2Status, pollVerificationV2Result, submitVerificationV2Response, verificationV2RequestedChecksDigest } from './index.js';
import type { VerificationV2Challenge, VerificationV2Submission } from './index.js';

const check = {
  requestType: 'age_over_18', schemaId: 'age', issuerId: 'issuer:synthetic', proofProfileId: 'claim_equals_v1', circuitId: 'c1', vkId: 'vk1',
  predicateParams: { value: true }, publicInputOrder: ['commitment', 'nonce'], issuerKeyHashes: ['key-hash'],
  expiryCheck: { requestType: 'expiry', schemaId: 'age', proofProfileId: 'claim_equals_v1' as const, circuitId: 'c2', vkId: 'vk2', publicInputOrder: ['commitment', 'nonce'], claimPath: 'valid_until' as const, matchesCredentialValidUntil: true as const },
};
const challenge = async (): Promise<VerificationV2Challenge> => ({
  protocolVersion: 2, sessionId: 'sssssssssssssssssssssssssssssssssssssssssss', requestRef: 'rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr', audience: 'https://verifier.test', nonce: '11111111111111111111111111111111111111111111111111111111111111', verificationEpoch: Math.floor(Date.parse('2026-10-13T12:00:00.000Z') / 1000),
  createdAt: '2026-10-13T12:00:00.000Z', expiresAt: '2026-10-13T12:10:00.000Z', requestedChecksDigest: await verificationV2RequestedChecksDigest([check]), requestedChecks: [check], title: 'Age check',
});
const status = { protocolVersion: 2, sessionId: 'sssssssssssssssssssssssssssssssssssssssssss', status: 'created', expiresAt: '2026-10-13T12:10:00.000Z' };
const sessionId = 's'.repeat(43), requestRef = 'r'.repeat(43), resultReadCapability = 'p'.repeat(43);
const validSubmission = (): VerificationV2Submission => ({ protocolVersion: 2, sessionId, submissionId: 'u'.repeat(43), requestedChecksDigest: 'a'.repeat(64), checkResponses: [{ requestType: 'age_over_18', decision: 'deny' }] });
const response = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code });
const options = (body: unknown) => ({ verifierBaseUrl: 'https://verifier.test', fetchImpl: vi.fn(async () => response(body)) });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('V2 manual verification transport', () => {
  it('preserves fully validated retryable 503 submission and polling statuses', async () => {
    const unavailable = { ...status, status: 'unavailable', retryable: true };
    const config = { verifierBaseUrl: 'https://verifier.test', fetchImpl: vi.fn(async () => response(unavailable, 503)) };
    await expect(submitVerificationV2Response(requestRef, validSubmission(), config)).resolves.toEqual(unavailable);
    await expect(getVerificationV2Status({ sessionId, resultReadCapability }, config)).resolves.toEqual(unavailable);
    expect(config.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([
    { protocolVersion: 3 }, { expiresAt: undefined }, { retryable: false }, { sessionId: 'x'.repeat(43) },
    { receipt: 'must-not-appear' }, { checkedAt: '2026-10-13T12:01:00.000Z' }, { rawError: 'secret-error' },
    { resultReadCapability: 'secret-capability' }, { checkResults: [] },
  ])('rejects malformed or unbound typed 503 statuses without retaining private fields', async patch => {
    const body = { ...status, status: 'unavailable', retryable: true, ...patch };
    const config = { verifierBaseUrl: 'https://verifier.test', fetchImpl: vi.fn(async () => response(body, 503)) };
    await expect(submitVerificationV2Response(requestRef, validSubmission(), config)).rejects.toThrow(/contract_invalid|session_mismatch/);
  });
  it('never treats a typed 503 as a verified result', async () => {
    const body = { ...status, status: 'verified', checkedAt: '2026-10-13T12:01:00.000Z', receipt: 'signed-receipt', checkResults: [{ requestType: 'age_over_18', status: 'passed', reasonCode: 'verification_succeeded' }] };
    await expect(submitVerificationV2Response(requestRef, validSubmission(), { verifierBaseUrl: 'https://verifier.test', fetchImpl: async () => response(body, 503) })).rejects.toThrow('contract_invalid');
  });
  it.each(['verification_not_found', 'verification_expired', 'verification_conflict', 'verification_busy', 'verification_lease_lost', 'verification_invalid_request', 'verification_attempt_limit', 'verification_authorization_required', 'verification_temporarily_unavailable'])('preserves allowlisted trust error %s without raw payload', async error => {
    const work = getVerificationV2Status({ sessionId, resultReadCapability }, { verifierBaseUrl: 'https://verifier.test', fetchImpl: async () => response({ error, rawError: 'private-canary' }, 409) });
    await expect(work).rejects.toMatchObject({ errorCode: error, message: 'verification_v2_request_failed', payload: undefined });
  });
  it('drops unknown and legacy error codes instead of echoing them', async () => {
    for (const error of ['private_canary_value', 'session_expired']) {
      await expect(getVerificationV2Status({ sessionId, resultReadCapability }, { verifierBaseUrl: 'https://verifier.test', fetchImpl: async () => response({ error, message: 'private-canary' }, 400) })).rejects.toMatchObject({ errorCode: undefined, payload: undefined });
    }
  });
  it.each([{ requestTypes: [] }, { requestTypes: Array.from({ length: 9 }, (_, i) => `check_${i}`) }, { requestTypes: ['with space'] }, { requestTypes: ['a'.repeat(161)] }, { requestTypes: ['age'], title: '' }, { requestTypes: ['age'], title: 'a'.repeat(161) }])('rejects create requests outside trust bounds', async input => {
    const config = options({});
    await expect(createVerificationV2Session(input, config)).rejects.toThrow('contract_invalid');
    expect(config.fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['a'.repeat(19), 'a'.repeat(161), 'a'.repeat(20) + '.', 'https://other.test/ref'])('rejects reference outside the trust route pattern', async reference => {
    await expect(getVerificationV2Challenge(reference, options({}))).rejects.toThrow('reference_invalid');
  });
  it.each(['p'.repeat(42), 'p'.repeat(44), '+'.repeat(43)])('rejects invalid private capability length or alphabet', async capability => {
    await expect(getVerificationV2Status({ sessionId, resultReadCapability: capability }, options(status))).rejects.toThrow('poll_authority_invalid');
  });
  it('checks request order rather than merely set membership', async () => {
    const publicChallenge = await challenge();
    const second = { ...check, requestType: 'other_check' };
    const requestedChecks = [second, check];
    const body = { ...publicChallenge, requestedChecks, requestedChecksDigest: await verificationV2RequestedChecksDigest(requestedChecks), resultReadCapability, qrPayload: `unet://verify?session_ref=${requestRef}&version=2` };
    await expect(createVerificationV2Session({ requestTypes: [check.requestType, second.requestType] }, options(body))).rejects.toThrow('request_mismatch');
  });
  it('rejects malformed proof and commitment shapes before transport', async () => {
    const proof = { profileId: 'claim_equals_v1', vkId: 'vk1', publicInputs: ['1'], proofEncoding: 'bb_binary_proof_with_public_inputs_prefix' as const, proof: 'BwgJ' };
    const credential = { attestationCommitment: 'a'.repeat(64), validUntilEpoch: 1_800_000_000, checkProof: proof, expiryProof: proof };
    const cases = [
      { ...credential, attestationCommitment: 'not-a-commitment' },
      ...[{ ...proof, proof: 'not-base64!' }, { ...proof, proof: 'A'.repeat(262_145) }, { ...proof, publicInputs: Array(257).fill('1') }, { ...proof, publicInputs: ['1'.repeat(161)] }, { ...proof, vkId: 'key with spaces' }].map(checkProof => ({ ...credential, checkProof })),
    ];
    const config = options(status);
    for (const value of cases) await expect(submitVerificationV2Response(requestRef, { ...validSubmission(), checkResponses: [{ requestType: 'age_over_18', decision: 'approve', credential: value }] }, config)).rejects.toThrow('contract_invalid');
    expect(config.fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects noncanonical result statuses and timestamps', async () => {
    const terminal = { ...status, status: 'verified', checkedAt: '2026-10-13T12:01:00.000Z', receipt: 'signed-receipt', checkResults: [{ requestType: 'age_over_18', status: 'passed', reasonCode: 'verification_succeeded' }] };
    for (const body of [{ ...terminal, receipt: undefined }, { ...terminal, checkResults: [{ requestType: 'age_over_18', status: 'passed', reasonCode: 'attestation_revoked' }] }, { ...terminal, status: 'denied' }, { ...terminal, checkedAt: '2026-10-13T12:01:00Z' }]) {
      await expect(getVerificationV2Status({ sessionId, resultReadCapability }, options(body))).rejects.toThrow('contract_invalid');
    }
  });
  it('rejects submissions exceeding the aggregate four-MiB route budget', async () => {
    const proof = { profileId: 'claim_equals_v1', vkId: 'vk1', publicInputs: ['1'], proofEncoding: 'bb_binary_proof_with_public_inputs_prefix' as const, proof: 'A'.repeat(262_144) };
    const credential = { attestationCommitment: 'a'.repeat(64), validUntilEpoch: 1_800_000_000, checkProof: proof, expiryProof: proof };
    const checkResponses = Array.from({ length: 8 }, (_, i) => ({ requestType: `check_${i}`, decision: 'approve' as const, credential }));
    const config = options(status);
    await expect(submitVerificationV2Response(requestRef, { ...validSubmission(), checkResponses }, config)).rejects.toThrow('contract_invalid');
    expect(config.fetchImpl).not.toHaveBeenCalled();
  });
  it('creates a session and keeps capability out of public references and QR', async () => {
    const publicChallenge = await challenge();
    const config = options({ ...publicChallenge, resultReadCapability: 'ppppppppppppppppppppppppppppppppppppppppppp', qrPayload: 'unet://verify?session_ref=rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr&version=2' });
    const session = await createVerificationV2Session({ requestTypes: ['age_over_18'] }, config);
    expect(session.resultReadCapability).toBe('ppppppppppppppppppppppppppppppppppppppppppp');
    const [url, init] = config.fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://verifier.test/v2/verification-sessions');
    expect(JSON.parse(init.body as string)).toEqual({ requestTypes: ['age_over_18'] });
    expect(init.redirect).toBe('error'); expect(init.cache).toBe('no-store');
  });
  it('reads public challenges without authorization and verifies immutable check digest', async () => {
    const config = options(await challenge());
    await getVerificationV2Challenge('rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr', config);
    const [url, init] = config.fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://verifier.test/v2/verification-requests/rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr');
    expect(new Headers(init.headers).has('authorization')).toBe(false);
    await expect(getVerificationV2Challenge('rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr', options({ ...await challenge(), requestedChecksDigest: '0'.repeat(64) }))).rejects.toThrow('checks_digest_mismatch');
  });
  it('uses bearer headers only for private polling', async () => {
    const config = options(status);
    await getVerificationV2Status({ sessionId: 'sssssssssssssssssssssssssssssssssssssssssss', resultReadCapability: 'ppppppppppppppppppppppppppppppppppppppppppp' }, config);
    const [url, init] = config.fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://verifier.test/v2/verification-sessions/sssssssssssssssssssssssssssssssssssssssssss');
    expect(url).not.toContain('ppppppppppppppppppppppppppppppppppppppppppp'); expect(url).not.toContain('?');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer ppppppppppppppppppppppppppppppppppppppppppp');
  });
  it.each(['resultReadCapability', 'holderUserId', 'jws'])('rejects %s in a public challenge', async field => {
    await expect(getVerificationV2Challenge('rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr', options({ ...await challenge(), [field]: 'must-not-leak' }))).rejects.toThrow('contract_invalid');
  });
  it('rejects a private capability embedded in QR payload', async () => {
    await expect(createVerificationV2Session({ requestTypes: ['age_over_18'] }, options({ ...await challenge(), resultReadCapability: 'ppppppppppppppppppppppppppppppppppppppppppp', qrPayload: 'unet://verify?cap=ppppppppppppppppppppppppppppppppppppppppppp' }))).rejects.toThrow('contract_invalid');
  });
  it.each(['https://verifier.test?cap=private', 'http://verifier.test', 'https://verifier.test/api', 'https://user:password@verifier.test'])('rejects unsafe verifier base %s', async verifierBaseUrl => {
    const config = options(status);
    await expect(getVerificationV2Status({ sessionId: 'sssssssssssssssssssssssssssssssssssssssssss', resultReadCapability: 'ppppppppppppppppppppppppppppppppppppppppppp' }, { ...config, verifierBaseUrl })).rejects.toThrow('origin_invalid');
    expect(config.fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects URL-shaped references and header injection', async () => {
    await expect(getVerificationV2Status({ sessionId: 'sssssssssssssssssssssssssssssssssssssssssss?cap=private', resultReadCapability: 'ppppppppppppppppppppppppppppppppppppppppppp' }, options(status))).rejects.toThrow('reference_invalid');
    await expect(getVerificationV2Status({ sessionId: '..', resultReadCapability: 'ppppppppppppppppppppppppppppppppppppppppppp' }, options(status))).rejects.toThrow('reference_invalid');
    await expect(getVerificationV2Status({ sessionId: 'sssssssssssssssssssssssssssssssssssssssssss', resultReadCapability: 'private\r\nheader' }, options(status))).rejects.toThrow('poll_authority_invalid');
  });
  it('submits V2 proof/expiry pairs without identity wrappers and does not retry submission', async () => {
    const proof = { profileId: 'claim_equals_v1', vkId: 'vk1', publicInputs: ['1'], proofEncoding: 'bb_binary_proof_with_public_inputs_prefix' as const, proof: 'BwgJ' };
    const submission: VerificationV2Submission = { protocolVersion: 2, sessionId: 'sssssssssssssssssssssssssssssssssssssssssss', submissionId: 'uuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu', requestedChecksDigest: 'a'.repeat(64), checkResponses: [{ requestType: 'age_over_18', decision: 'approve', credential: { attestationCommitment: 'c'.repeat(64), validUntilEpoch: 1_800_000_000, checkProof: proof, expiryProof: proof } }] };
    const config = options(status);
    await submitVerificationV2Response('rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr', submission, config);
    const [, init] = config.fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(submission);
    await expect(submitVerificationV2Response('rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr', { ...submission, userId: 'forbidden' } as VerificationV2Submission, config)).rejects.toThrow('contract_invalid');
    await expect(submitVerificationV2Response('rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr', { ...submission, protocolVersion: 3 } as unknown as VerificationV2Submission, config)).rejects.toThrow('contract_invalid');
    expect(config.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('sanitizes response errors without retaining their payload', async () => {
    const fetchImpl = vi.fn(async () => response({ error: 'verification_temporarily_unavailable', message: 'secret-proof', capability: 'ppppppppppppppppppppppppppppppppppppppppppp' }, 503));
    try { await getVerificationV2Status({ sessionId: 'sssssssssssssssssssssssssssssssssssssssssss', resultReadCapability: 'ppppppppppppppppppppppppppppppppppppppppppp' }, { verifierBaseUrl: 'https://verifier.test', fetchImpl }); throw new Error('expected failure'); }
    catch (error) { expect(error).toMatchObject({ message: 'verification_v2_request_failed', errorCode: 'verification_temporarily_unavailable', payload: undefined }); expect(JSON.stringify(error)).not.toContain('ppppppppppppppppppppppppppppppppppppppppppp'); }
  });
  it('covers body reads with the 10-second deadline', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => ({ ok: true, text: () => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('body interrupted')))) }) as Response);
    const work = getVerificationV2Status({ sessionId: 'sssssssssssssssssssssssssssssssssssssssssss', resultReadCapability: 'ppppppppppppppppppppppppppppppppppppppppppp' }, { verifierBaseUrl: 'https://verifier.test', fetchImpl });
    const rejected = expect(work).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10_000); await rejected;
  });
  it('polls serially, bounds waiting, and respects caller cancellation', async () => {
    vi.useFakeTimers();
    const config = options(status);
    const work = pollVerificationV2Result({ sessionId: 'sssssssssssssssssssssssssssssssssssssssssss', resultReadCapability: 'ppppppppppppppppppppppppppppppppppppppppppp' }, { ...config, timeoutMs: 2_500 });
    const rejected = expect(work).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(2_500); await rejected;
    expect(config.fetchImpl).toHaveBeenCalledTimes(2);
    const controller = new AbortController(); controller.abort();
    await expect(pollVerificationV2Result({ sessionId: 'sssssssssssssssssssssssssssssssssssssssssss', resultReadCapability: 'ppppppppppppppppppppppppppppppppppppppppppp' }, { ...config, signal: controller.signal })).rejects.toThrow('timed out');
    expect(config.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('bounds even a custom fetch that ignores AbortSignal', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    const work = getVerificationV2Status({ sessionId: 'sssssssssssssssssssssssssssssssssssssssssss', resultReadCapability: 'ppppppppppppppppppppppppppppppppppppppppppp' }, { verifierBaseUrl: 'https://verifier.test', fetchImpl });
    const rejected = expect(work).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10_000); await rejected;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('preserves recursive JSON and ordered-array digest semantics without WebCrypto', async () => {
    vi.stubGlobal('crypto', undefined);
    expect(canonicalVerificationV2Json({ z: undefined, b: [{ z: 1, a: 2 }], a: true })).toBe('{"a":true,"b":[{"a":2,"z":1}]}');
    const reordered = { ...check, predicateParams: { nested: { z: 1, a: 2 }, value: true } };
    const sorted = { ...check, predicateParams: { value: true, nested: { a: 2, z: 1 } } };
    expect(await verificationV2RequestedChecksDigest([check])).toMatch(/^[a-f0-9]{64}$/);
    expect(canonicalVerificationV2Json({ b: 1, a: { d: 4, c: 3 } })).toBe(canonicalVerificationV2Json({ a: { c: 3, d: 4 }, b: 1 }));
    expect(canonicalVerificationV2Json([1, 2])).not.toBe(canonicalVerificationV2Json([2, 1]));
    expect(await verificationV2RequestedChecksDigest([reordered])).toBe(await verificationV2RequestedChecksDigest([sorted]));
  });
});
