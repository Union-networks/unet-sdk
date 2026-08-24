import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  InMemoryDirectLoginChallengeStore,
  createDirectLoginService,
  type DirectLoginAccountStore,
  type DirectLoginApproval,
} from './directLogin.js';

const accountStore = (): DirectLoginAccountStore => {
  const keys = new Map<string, string>();
  return {
    getPublicKey: async (id) => keys.get(id),
    bindPublicKey: async (id, key) => {
      const existing = keys.get(id);
      if (existing && existing !== key) throw new Error('account_key_mismatch');
      keys.set(id, key);
      return existing ? 'existing' : 'created';
    },
    retire: async (id) => { keys.delete(id); },
  };
};

describe('direct provider login v2', () => {
  it('binds the account key and exchanges an approved session once', async () => {
    const now = new Date('2026-08-24T10:00:00.000Z');
    const service = createDirectLoginService({
      serviceId: 'shop',
      origin: 'https://shop.example',
      challengeStore: new InMemoryDirectLoginChallengeStore(),
      accountStore: accountStore(),
      now: () => now,
    });
    const challenge = await service.createChallenge({ challengeUrl: '/api/unet/login/challenge', approvalUrl: '/api/unet/login/approve' });
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const accountPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const unsigned: Omit<DirectLoginApproval, 'signature'> = {
      protocolVersion: 2,
      requestRef: challenge.requestRef,
      serviceId: challenge.serviceId,
      origin: challenge.origin,
      scopedUserId: 'unet_scoped_random',
      accountPublicKeyPem,
      signedAtIso: now.toISOString(),
    };
    const message = [
      'unet-direct-login-v2', challenge.serviceId, challenge.origin, challenge.requestRef,
      challenge.challenge, challenge.expiresAtIso, unsigned.scopedUserId, accountPublicKeyPem, unsigned.signedAtIso,
    ].join('\n');
    await service.approve({ ...unsigned, signature: sign(null, Buffer.from(message), privateKey).toString('base64url') });
    const approved = await service.poll(challenge.requestRef);
    expect(approved).toMatchObject({ state: 'approved', session: { scopedUserId: 'unet_scoped_random' } });
    await expect(service.exchangeSession(approved.session!.sessionId)).resolves.toMatchObject({ scopedUserId: 'unet_scoped_random' });
    await expect(service.exchangeSession(approved.session!.sessionId)).rejects.toThrow('direct_login_session_invalid');
  });
});
