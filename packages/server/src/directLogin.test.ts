import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryDirectLoginAccountStore, InMemoryDirectLoginChallengeStore,
  createDirectLoginService, type DirectLoginApproval, type DirectLoginChallenge,
} from './directLogin.js';

export function signedApproval(challenge: DirectLoginChallenge, account = 'scoped_a', now = new Date()) {
  const keys = generateKeyPairSync('ed25519');
  const accountPublicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const unsigned = { protocolVersion: 2 as const, requestRef: challenge.requestRef, serviceId: challenge.serviceId,
    origin: challenge.origin, scopedUserId: account, accountPublicKeyPem, signedAtIso: now.toISOString() };
  const message = ['unet-direct-login-v2', challenge.serviceId, challenge.origin, challenge.requestRef,
    challenge.challenge, challenge.expiresAtIso, account, accountPublicKeyPem, unsigned.signedAtIso].join('\n');
  return { keys, approval: { ...unsigned, signature: sign(null, Buffer.from(message), keys.privateKey).toString('base64url') } satisfies DirectLoginApproval };
}

function setup() {
  let time = new Date();
  const accountStore = new InMemoryDirectLoginAccountStore();
  const challengeStore = new InMemoryDirectLoginChallengeStore(accountStore);
  const cleanup = vi.fn().mockResolvedValue(undefined);
  const service = createDirectLoginService({ serviceId: 'shop', origin: 'https://shop.example', challengeStore, accountStore, now: () => time, onAccountRetired: cleanup });
  const secret = randomBytes(32).toString('base64url');
  const create = () => service.createChallenge({ challengeUrl: '/challenge', approvalUrl: '/approve', redemptionSecret: secret });
  return { service, create, secret, accountStore, challengeStore, cleanup, advance: (ms: number) => { time = new Date(time.getTime() + ms); } };
}

describe('browser-bound direct login', () => {
  it('never discloses session/account/redemption data through public retrieval or status', async () => {
    const { service, create, secret } = setup();
    const challenge = await create();
    await service.approve(signedApproval(challenge).approval);
    expect(await service.getChallenge(challenge.requestRef)).toEqual(challenge);
    expect(JSON.stringify(challenge)).not.toContain(secret);
    expect(await service.poll(challenge.requestRef, secret)).toEqual({ state: 'approved' });
    await expect(service.poll(challenge.requestRef, randomBytes(32).toString('base64url'))).rejects.toThrow('browser_unauthorized');
    await expect(service.exchangeSession(challenge.requestRef, randomBytes(32).toString('base64url'))).rejects.toThrow('browser_unauthorized');
    expect(await service.exchangeSession(challenge.requestRef, secret)).toMatchObject({ scopedUserId: 'scoped_a' });
    await expect(service.exchangeSession(challenge.requestRef, secret)).rejects.toThrow('not_approved');
  });

  it('allows exactly one concurrent approval and one exchange', async () => {
    const { service, create, secret, accountStore } = setup();
    const challenge = await create();
    const approvals = await Promise.allSettled(['scoped_a', 'scoped_b'].map((id) => service.approve(signedApproval(challenge, id).approval)));
    expect(approvals.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect([await accountStore.getPublicKey('scoped_a'), await accountStore.getPublicKey('scoped_b')].filter(Boolean)).toHaveLength(1);
    const exchanges = await Promise.allSettled(Array.from({ length: 6 }, () => service.exchangeSession(challenge.requestRef, secret)));
    expect(exchanges.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('expires approved challenges and rejects old unbound records', async () => {
    const { service, create, secret, advance, challengeStore } = setup();
    const challenge = await create();
    await service.approve(signedApproval(challenge).approval);
    advance(121_000);
    expect(await service.poll(challenge.requestRef, secret)).toEqual({ state: 'expired' });
    await expect(service.exchangeSession(challenge.requestRef, secret)).rejects.toThrow();
    const old = { ...challenge, requestRef: 'legacy', challengeHash: '', state: 'pending' as const };
    await challengeStore.create(old as never);
    await expect(service.poll('legacy', secret)).rejects.toThrow('protocol_upgrade_required');
  });

  it('bounds wrong-cookie exchange attempts', async () => {
    const { service, create, secret } = setup();
    const challenge = await create();
    await service.approve(signedApproval(challenge).approval);
    for (let i = 0; i < 8; i++) await expect(service.exchangeSession(challenge.requestRef, 'x'.repeat(43))).rejects.toThrow();
    await expect(service.exchangeSession(challenge.requestRef, secret)).rejects.toThrow('browser_unauthorized');
  });

  it.each([6 * 60_000, 7 * 24 * 60 * 60_000])('accepts delayed signed retirement after %i ms and retries cleanup durably', async (delay) => {
    const { service, create, accountStore, cleanup, advance } = setup();
    const challenge = await create();
    const { approval, keys } = signedApproval(challenge);
    await service.approve(approval);
    const unsigned = { protocolVersion: 2 as const, serviceId: 'shop', origin: 'https://shop.example', scopedUserId: approval.scopedUserId, operationId: 'retirement_operation_1', signedAtIso: new Date().toISOString() };
    const message = ['unet-service-account-retirement-v2', unsigned.serviceId, unsigned.origin, unsigned.scopedUserId, unsigned.operationId, unsigned.signedAtIso].join('\n');
    const retirement = { ...unsigned, signature: sign(null, Buffer.from(message), keys.privateKey).toString('base64url') };
    advance(delay);
    await service.retire(retirement);
    expect(await accountStore.getPublicKey(approval.scopedUserId)).toBeUndefined();
    expect(cleanup).not.toHaveBeenCalled();
    cleanup.mockRejectedValueOnce(new Error('offline'));
    expect(await service.retryRetirementCleanup()).toEqual({ completed: 0, pending: 1 });
    await service.retire(retirement);
    expect(await service.retryRetirementCleanup()).toEqual({ completed: 0, pending: 0 });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5_001);
    try {
      expect(await service.retryRetirementCleanup()).toEqual({ completed: 1, pending: 0 });
    } finally { clock.mockRestore(); }
    await service.retire(retirement);
    expect(await service.retryRetirementCleanup()).toEqual({ completed: 0, pending: 0 });
    await expect(accountStore.bindPublicKey(approval.scopedUserId, approval.accountPublicKeyPem)).rejects.toThrow('retired');
  });
});
