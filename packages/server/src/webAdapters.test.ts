import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDirectLoginService, InMemoryDirectLoginAccountStore, InMemoryDirectLoginChallengeStore } from './directLogin.js';
import { createDirectLoginWebHandlers, createProviderSelfTestHandler, createUnetProtocolOptionsHandler } from './webAdapters.js';

describe('direct login web adapters', () => {
  it('creates, approves, polls, and exchanges a provider-owned session', async () => {
    const challengeStore = new InMemoryDirectLoginChallengeStore();
    const accountStore = new InMemoryDirectLoginAccountStore();
    const service = createDirectLoginService({ serviceId: 'shop', origin: 'https://shop.example', challengeStore, accountStore });
    const handlers = createDirectLoginWebHandlers({ serviceId: 'shop', origin: 'https://shop.example', service, accountStore });
    const created = await handlers.challenge(new Request('https://shop.example/api/unet/login/challenge', { method: 'POST' }));
    const { challenge } = await created.json() as any;
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const signedAtIso = new Date().toISOString();
    const message = ['unet-direct-login-v2', 'shop', 'https://shop.example', challenge.requestRef, challenge.challenge, challenge.expiresAtIso, 'scoped_a', publicKeyPem, signedAtIso].join('\n');
    const approval = { protocolVersion: 2, requestRef: challenge.requestRef, serviceId: 'shop', origin: 'https://shop.example', scopedUserId: 'scoped_a', accountPublicKeyPem: publicKeyPem, signedAtIso, signature: sign(null, Buffer.from(message), privateKey).toString('base64url') };
    expect((await handlers.approve(new Request('https://shop.example/api/unet/login/approve', { method: 'POST', body: JSON.stringify(approval) }))).status).toBe(200);
    const polled = await (await handlers.challengeStatus(new Request(`https://shop.example/api/unet/login/status?requestRef=${challenge.requestRef}`))).json() as any;
    expect(polled.state).toBe('approved');
    expect((await handlers.exchange(new Request('https://shop.example/api/unet/login/exchange', { method: 'POST', body: JSON.stringify({ sessionId: polled.session.sessionId }) }))).status).toBe(200);
  });

  it('advertises protocol contracts and runs only authenticated non-persisting self-tests', async () => {
    const options = await createUnetProtocolOptionsHandler({ methods: ['POST'], capabilities: ['direct_login'] })();
    expect(options.status).toBe(204);
    expect(options.headers.get('x-unet-protocol-version')).toBe('2');
    let databaseChecks = 0;
    const handler = createProviderSelfTestHandler({
      serviceId: 'shop',
      authorize: async (request) => request.headers.get('authorization') === 'signed-control-request',
      checks: { database: async () => { databaseChecks += 1; } },
    });
    const body = JSON.stringify({ version: 1, action: 'provider.self-test', serviceId: 'shop', checks: ['database'] });
    expect((await handler(new Request('https://shop.example/api/unet/self-test', { method: 'POST', body }))).status).toBe(403);
    expect((await handler(new Request('https://shop.example/api/unet/self-test', { method: 'POST', headers: { authorization: 'signed-control-request' }, body }))).status).toBe(200);
    expect(databaseChecks).toBe(1);
  });
});
