import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
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
assert.equal(typeof react.useUnetLogin, 'function');
assert.equal(typeof setup.validateProviderSetupManifest, 'function');
assert.equal(typeof verification.createVerificationSession, 'function');

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
console.log('All eight packed package imports and browser-bound login exchange/replay checks passed.');
