import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDirectLoginService, InMemoryDirectLoginAccountStore, InMemoryDirectLoginChallengeStore } from './directLogin.js';
import { createDirectLoginWebHandlers } from './webAdapters.js';

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
});
