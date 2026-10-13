import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import * as contracts from '@u-net/contracts';
import * as client from '@u-net/client';
import * as issuer from '@u-net/issuer';
import * as react from '@u-net/react';
import * as setup from '@u-net/setup';
import * as verification from '@u-net/verification';
import { createDirectProviderLogin, exchangeDirectProviderLogin, getDirectProviderLogin } from '@u-net/web-login';
import { InMemoryDirectLoginAccountStore, InMemoryDirectLoginChallengeStore, createDirectLoginService, createDirectLoginWebHandlers } from '@u-net/server';

assert.equal(typeof contracts, 'object');
assert.equal(typeof client.createUnetClient, 'function');
assert.equal(typeof issuer.generateIssuerKeyPair, 'function');
for (const name of ['ensureIssuanceRecoverySchema', 'PostgresIssuanceRecoveryStore', 'TransactionalIssuanceRecoveryStore', 'reconcileRecoveryAnchor', 'TransactionalIssuerOperationLane', 'ensureIssuerOperationLaneSchema', 'prepareIssuerLaneTargetRequest', 'validateIssuerLaneTargetEvidence', 'prepareIssuerLaneExpiryRequest', 'validateIssuerLaneExpiryEvidence', 'checkIssuerLaneTarget', 'checkIssuerLaneExpiry']) {
  assert.equal(typeof issuer[name], 'function', `missing_candidate_export:${name}`);
}
assert.equal(typeof issuer.PROVIDER_ISSUER_LANE_TABLES, 'object');
assert.equal(typeof react.useUnetLogin, 'function');
assert.equal(typeof setup.validateProviderSetupManifest, 'function');
assert.equal(typeof verification.createVerificationSession, 'function');
for (const name of ['createVerificationV2Session', 'getVerificationV2Challenge', 'submitVerificationV2Response', 'getVerificationV2Status', 'getVerificationV2Jwks', 'pollVerificationV2Result', 'canonicalVerificationV2Json', 'verificationV2RequestedChecksDigest', 'verifyVerificationV2Receipt']) {
  assert.equal(typeof client[name], 'function', `missing_client_export:${name}`);
  assert.equal(typeof verification[name], 'function', `missing_verification_export:${name}`);
}

// Exercise only the installed artifacts; this script must run outside the SDK checkout.
const verifierOrigin = 'https://packed-verifier.test';
const requestRef = 'r'.repeat(43), sessionId = 's'.repeat(43), resultReadCapability = 'p'.repeat(43);
const nonce = '1'.repeat(62), createdAt = new Date().toISOString();
const expiresAt = new Date(Date.parse(createdAt) + 600_000).toISOString();
const requestedChecks = [{ requestType: 'age_over_18', schemaId: 'synthetic-age', issuerId: 'issuer:synthetic', proofProfileId: 'claim_equals_v1', circuitId: 'synthetic-circuit', vkId: 'synthetic-vk', predicateParams: { claimPath: 'age_over_18', expectedValue: '1', claimType: 'boolean' }, publicInputOrder: ['nonce'], issuerKeyHashes: ['1'], expiryCheck: { requestType: 'age_over_18:validity', schemaId: 'synthetic-age', proofProfileId: 'claim_equals_v1', circuitId: 'synthetic-expiry', vkId: 'synthetic-expiry-vk', publicInputOrder: ['nonce'], claimPath: 'valid_until', matchesCredentialValidUntil: true } }];
const requestedChecksDigest = createHash('sha256').update(client.canonicalVerificationV2Json(requestedChecks), 'utf8').digest('hex');
assert.equal(await client.verificationV2RequestedChecksDigest(requestedChecks), requestedChecksDigest);
const publicChallenge = { protocolVersion: 2, sessionId, requestRef, audience: verifierOrigin, nonce, verificationEpoch: Math.floor(Date.parse(createdAt) / 1000), createdAt, expiresAt, requestedChecksDigest, requestedChecks, title: 'Synthetic age check' };
const resultKeys = generateKeyPairSync('ed25519');
const key = { ...resultKeys.publicKey.export({ format: 'jwk' }), kid: 'synthetic-result', alg: 'EdDSA', use: 'sig', status: 'active' };
const receiptPayload = { protocolVersion: 2, iss: verifierOrigin, aud: verifierOrigin, sessionId, requestRefHash: createHash('sha256').update(requestRef, 'utf8').digest('hex'), nonce, requestedChecksDigest, checkedAt: new Date().toISOString(), checkResults: [{ requestType: 'age_over_18', status: 'passed', reasonCode: 'verification_succeeded' }] };
const receiptInput = [ { alg: 'EdDSA', typ: 'unet-verification-result+JWT', kid: key.kid }, receiptPayload ].map(value => Buffer.from(client.canonicalVerificationV2Json(value)).toString('base64url')).join('.');
const receipt = `${receiptInput}.${sign(null, Buffer.from(receiptInput), resultKeys.privateKey).toString('base64url')}`;
const terminal = { protocolVersion: 2, sessionId, status: 'verified', expiresAt, checkedAt: receiptPayload.checkedAt, checkResults: receiptPayload.checkResults, receipt };
const unavailable = { protocolVersion: 2, sessionId, status: 'unavailable', expiresAt, retryable: true };
const nativeProof = { profileId: 'claim_equals_v1', vkId: 'synthetic-vk', publicInputs: ['1'], proofEncoding: 'bb_binary_proof_with_public_inputs_prefix', proof: 'BwgJ' };
const submission = { protocolVersion: 2, sessionId, submissionId: 'u'.repeat(43), requestedChecksDigest, checkResponses: [{ requestType: 'age_over_18', decision: 'approve', credential: { attestationCommitment: '1'.repeat(64), validUntilEpoch: Math.floor(Date.now() / 1000) + 86_400, checkProof: nativeProof, expiryProof: nativeProof } }] };
let submissions = 0, privateReads = 0;
const manualOptions = {
  verifierBaseUrl: verifierOrigin,
  fetchImpl: async (url, init) => {
    const target = new URL(url);
    assert.equal(target.origin, verifierOrigin); assert.equal(target.search, '');
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    assert.equal(target.href.includes(resultReadCapability), false);
    const header = new Headers(init.headers);
    const json = (value, status = 200) => Response.json(value, { status });
    if (target.pathname === '/v2/verification-sessions') {
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), { requestTypes: ['age_over_18'] });
      return json({ ...publicChallenge, resultReadCapability, qrPayload: `unet://verify?session_ref=${requestRef}&version=2` }, 201);
    }
    if (target.pathname === `/v2/verification-requests/${requestRef}`) {
      assert.equal(header.has('authorization'), false);
      return json(publicChallenge);
    }
    if (target.pathname.endsWith('/responses')) {
      assert.equal(target.pathname, `/v2/verification-requests/${requestRef}/responses`);
      assert.deepEqual(JSON.parse(init.body), submission);
      return ++submissions === 1 ? json(unavailable, 503) : json(terminal);
    }
    if (target.pathname === `/v2/verification-sessions/${sessionId}`) {
      if (header.get('authorization') !== `Bearer ${resultReadCapability}`) return json({ error: 'verification_not_found' }, 404);
      return json(++privateReads === 1 ? { protocolVersion: 2, sessionId, status: 'verifying', expiresAt } : terminal);
    }
    assert.equal(target.pathname, '/.well-known/unet-verifier-jwks.json');
    return json({ keys: [key] });
  },
};
const manualSession = await verification.createVerificationV2Session({ requestTypes: ['age_over_18'] }, manualOptions);
assert.equal(manualSession.qrPayload.includes(resultReadCapability), false);
assert.deepEqual(await verification.getVerificationV2Challenge(requestRef, manualOptions), publicChallenge);
assert.deepEqual(await verification.submitVerificationV2Response(requestRef, submission, manualOptions), unavailable);
assert.equal(submissions, 1, 'submission_must_not_retry_automatically');
assert.deepEqual(await verification.submitVerificationV2Response(requestRef, submission, manualOptions), terminal);
await assert.rejects(verification.getVerificationV2Status({ sessionId, resultReadCapability: requestRef }, manualOptions), { errorCode: 'verification_not_found' });
assert.deepEqual(await verification.pollVerificationV2Result({ sessionId, resultReadCapability }, { ...manualOptions, intervalMs: 1, timeoutMs: 1000 }), terminal);
assert.equal(privateReads, 2);
const verifierKeys = await verification.getVerificationV2Jwks(manualOptions);
const expectedReceipt = { verifierOrigin, audience: verifierOrigin, sessionId, requestRef, nonce, requestedChecksDigest, requestTypes: ['age_over_18'], expiresAt };
assert.deepEqual(await verification.verifyVerificationV2Receipt(receipt, expectedReceipt, verifierKeys), receiptPayload);
await assert.rejects(verification.verifyVerificationV2Receipt(receipt, { ...expectedReceipt, nonce: '2'.repeat(62) }, verifierKeys));
await assert.rejects(verification.verifyVerificationV2Receipt(receipt, expectedReceipt, { keys: [{ ...key, status: 'revoked' }] }));
const alteredReceipt = receipt.split('.');
alteredReceipt[1] = Buffer.from(client.canonicalVerificationV2Json({ ...receiptPayload, nonce: '2'.repeat(62) })).toString('base64url');
await assert.rejects(verification.verifyVerificationV2Receipt(alteredReceipt.join('.'), expectedReceipt, verifierKeys));

const origin = 'https://packed-sdk.test';
const serviceId = 'packed-sdk';
const accountStore = new InMemoryDirectLoginAccountStore();
const service = createDirectLoginService({ serviceId, origin, accountStore, challengeStore: new InMemoryDirectLoginChallengeStore(accountStore) });
let exchanges = 0;
const handlers = createDirectLoginWebHandlers({
  serviceId, origin, service, accountStore,
  exchange: async () => {
    exchanges += 1;
    return Response.json({ success: true });
  },
});
let cookie;
const options = {
  fetchImpl: async (url, init) => {
    assert.equal(init.credentials, 'same-origin');
    const headers = new Headers(init.headers);
    headers.set('origin', origin);
    if (cookie) headers.set('cookie', cookie);
    const request = new Request(url, { ...init, headers });
    const path = new URL(url).pathname;
    const handler = path.endsWith('/challenge') ? handlers.challenge : path.endsWith('/status') ? handlers.challengeStatus : path.endsWith('/exchange') ? handlers.exchange : undefined;
    assert.ok(handler, `unexpected_route:${path}`);
    const response = await handler(request);
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return response;
  },
};
const challenge = await createDirectProviderLogin(origin, options);
assert.ok(cookie?.startsWith('__Host-unet-login-'));
assert.deepEqual(await getDirectProviderLogin(origin, challenge.requestRef, options), { success: true, state: 'pending' });
const keys = generateKeyPairSync('ed25519');
const accountPublicKeyPem = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const scopedUserId = 'packed_sdk_account';
const signedAtIso = new Date().toISOString();
const message = ['unet-direct-login-v2', serviceId, origin, challenge.requestRef, challenge.challenge, challenge.expiresAtIso, scopedUserId, accountPublicKeyPem, signedAtIso].join('\n');
await service.approve({ protocolVersion: 2, serviceId, origin, requestRef: challenge.requestRef, scopedUserId, accountPublicKeyPem, signedAtIso, signature: sign(null, Buffer.from(message), keys.privateKey).toString('base64url') });
assert.deepEqual(await getDirectProviderLogin(origin, challenge.requestRef, options), { success: true, state: 'approved' });
const browserCookie = cookie;
cookie = undefined;
await assert.rejects(exchangeDirectProviderLogin(origin, challenge.requestRef, options));
assert.equal(exchanges, 0);
cookie = browserCookie;
assert.deepEqual(await exchangeDirectProviderLogin(origin, challenge.requestRef, options), { success: true });
cookie = browserCookie;
await assert.rejects(exchangeDirectProviderLogin(origin, challenge.requestRef, options));
assert.equal(exchanges, 1);
console.log('All eight packed imports, manual V2 verification/receipts/private polling, and browser-bound login exchange/replay checks passed. Synthetic proof transport only; no real proof or PostgreSQL acceptance implied.');
