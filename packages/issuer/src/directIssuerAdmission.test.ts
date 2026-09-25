import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createDirectIssuerService, InMemoryDirectIssuerRequestStore } from './directIssuer.js';
import type {
  CredentialReplacementMode, DirectIssuerRequestInput, DirectIssuerRequestRecord,
  DirectIssuerRequestState, DirectIssuerRenewalInput,
} from './directIssuer.js';

const parentCapability = 'wallet-parent-capability-kept-local';
const childCapability = 'wallet-child-capability-kept-local';
const hashCapability = (value: string) => createHash('sha256').update(value).digest('hex');
const timestamp = '2026-09-25T10:00:00.000Z';
const intent = (overrides: Partial<DirectIssuerRequestInput> = {}): DirectIssuerRequestInput => ({
  serviceAccountRef: 'account-a', checkId: 'membership', holderBinding: 'holder-a',
  deliveryPublicKey: 'wallet-key-a', deliveryCapabilityHash: hashCapability(parentCapability),
  holderRevocationSigner: `0x${'ab'.repeat(20)}`, idempotencyKey: 'initial',
  claims: { membership: { level: 1 }, roles: ['member'] },
  consent: { text: 'Issue membership', acceptedAtIso: timestamp }, ...overrides,
});
const record = (overrides: Partial<DirectIssuerRequestRecord> = {}): DirectIssuerRequestRecord => ({
  ...intent(), requestId: 'parent-request', state: 'pending', createdAtIso: timestamp,
  updatedAtIso: timestamp, ...overrides,
});
const renewalIntent = (requestId: string, overrides: Partial<DirectIssuerRenewalInput> = {}): DirectIssuerRenewalInput => ({
  requestId, deliveryCapability: parentCapability, holderBinding: 'holder-child', deliveryPublicKey: 'wallet-key-child',
  deliveryCapabilityHash: hashCapability(childCapability), holderRevocationSigner: `0x${'cd'.repeat(20)}`,
  idempotencyKey: 'renewal', ...overrides,
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(mode: CredentialReplacementMode = 'parallel') {
  const store = new InMemoryDirectIssuerRequestStore();
  const replacementModeFor = vi.fn(async () => mode);
  const buildCredential = vi.fn(async (request: DirectIssuerRequestRecord) => ({
    attestationHash: hashCapability(request.requestId), encryptedCredentialEnvelope: { ciphertext: request.requestId },
  }));
  const revokeReplacedCredential = vi.fn(async ({ attestationHash }: { requestId: string; attestationHash: string }) => {
    const previous = await store.findByAttestationHash(attestationHash);
    if (previous) await store.update({ ...previous, state: 'revoked' });
  });
  const service = createDirectIssuerService({ store, replacementModeFor, buildCredential,
    anchorCredential: async () => ({ transactionHash: 'transaction', status: 'active' }),
    revokeReplacedCredential, now: () => new Date(timestamp),
  });
  return { store, service, replacementModeFor, buildCredential, revokeReplacedCredential };
}
async function deliveredParent() {
  const context = fixture('replace_after_delivery');
  const admitted = await context.service.createRequest(intent());
  const parent = await context.service.approve(admitted.requestId);
  await context.service.acknowledgeDelivery(parent.requestId, parentCapability, parent.attestationHash!);
  return { ...context, parent };
}

describe('direct issuer admission intents', () => {
  it('recovers a lost response with the same reference and wallet capability, without returning a bearer', async () => {
    const { service, store, buildCredential } = fixture();
    await service.createRequest(intent());
    const [persisted] = await store.list();
    const replay = await service.createRequest(intent());
    expect(replay).toEqual({ requestId: persisted.requestId, state: 'pending', replacementRequired: false });
    expect(Object.keys(replay).sort()).toEqual(['replacementRequired', 'requestId', 'state']);
    expect(persisted.deliveryCapabilityHash).toBe(hashCapability(parentCapability));
    expect(JSON.stringify([replay, persisted])).not.toContain(parentCapability);
    expect(await store.list()).toHaveLength(1);
    expect(buildCredential).not.toHaveBeenCalled();
    await service.approve(replay.requestId);
    await expect(service.getDelivery(replay.requestId, parentCapability)).resolves.toMatchObject({ state: 'ready' });
    await expect(service.getDelivery(replay.requestId, 'wrong')).rejects.toThrow('delivery_capability_invalid');
    await expect(service.createRequest(intent())).resolves.toMatchObject({ requestId: replay.requestId, state: 'ready' });
  });

  it('keeps the first consent timestamp while comparing JSON claims structurally and normalizing the signer', async () => {
    const { service, store } = fixture();
    const first = await service.createRequest(intent());
    const replay = await service.createRequest(intent({
      claims: { roles: ['member'], membership: { level: 1 } },
      holderRevocationSigner: `0x${'AB'.repeat(20)}`,
      consent: { text: 'Issue membership', acceptedAtIso: '2026-09-25T11:00:00.000Z' },
    }));
    expect(replay).toEqual(first);
    expect((await store.get(first.requestId))?.consent?.acceptedAtIso).toBe(timestamp);
  });

  it.each([
    { holderBinding: 'other-holder' }, { deliveryPublicKey: 'other-key' },
    { deliveryCapabilityHash: hashCapability(childCapability) }, { holderRevocationSigner: `0x${'ef'.repeat(20)}` },
    { checkId: 'other-check' }, { claims: { membership: { level: 2 }, roles: ['member'] } },
    { claims: undefined }, { consent: { text: 'Different consent', acceptedAtIso: timestamp } }, { consent: undefined },
  ])('rejects a changed intent using the same idempotency key: %j', async change => {
    const { service, store } = fixture();
    await service.createRequest(intent());
    const before = await store.list();
    await expect(service.createRequest(intent(change))).rejects.toThrow('issuer_request_idempotency_conflict');
    expect(await store.list()).toEqual(before);
  });

  it('serializes concurrent identical requests to one stored reference', async () => {
    const { service, store } = fixture();
    const results = await Promise.all(Array.from({ length: 12 }, () => service.createRequest(intent())));
    expect(new Set(results.map(value => value.requestId)).size).toBe(1);
    expect(await store.list()).toHaveLength(1);
  });

  it('admits only one of concurrent mismatched intents sharing a key', async () => {
    const { service, store } = fixture();
    const results = await Promise.allSettled([
      service.createRequest(intent()), service.createRequest(intent({ holderBinding: 'racing-holder' })),
    ]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(value => value.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: new Error('issuer_request_idempotency_conflict') }),
    ]);
    expect(await store.list()).toHaveLength(1);
  });

  it('snapshots nested input before the first await and isolates stored reads from mutation', async () => {
    const { service, store, replacementModeFor } = fixture();
    const gate = deferred();
    replacementModeFor.mockImplementationOnce(async () => { await gate.promise; return 'parallel'; });
    const raw = intent();
    const original = structuredClone(raw);
    const pending = service.createRequest(raw);
    raw.serviceAccountRef = 'mutated-account';
    raw.deliveryCapabilityHash = hashCapability(childCapability);
    (raw.claims!.membership as { level: number }).level = 99;
    (raw.claims!.roles as string[]).push('admin');
    raw.consent!.text = 'Mutated';
    gate.resolve();
    const admitted = await pending;
    const stored = (await store.get(admitted.requestId))!;
    expect(stored).toMatchObject(original);
    (stored.claims!.roles as string[]).push('admin');
    expect(await store.get(admitted.requestId)).toMatchObject(original);
    await expect(service.createRequest(original)).resolves.toEqual(admitted);
  });

  it.each([
    { deliveryCapabilityHash: undefined }, { deliveryCapabilityHash: 'ab' }, { deliveryCapabilityHash: 'AB'.repeat(32) },
    { deliveryCapabilityHash: parentCapability }, { holderBinding: '' }, { checkId: ' '.repeat(2) },
    { serviceAccountRef: 'x'.repeat(513) }, { idempotencyKey: 3 }, { claims: [] },
    { claims: { value: Number.NaN } }, { claims: { value: undefined } }, { claims: { value: new Date(timestamp) } },
    { consent: { text: 'yes', acceptedAtIso: 'invalid' } }, { claims: { value: 'x'.repeat(65_536) } },
    { deliveryCapability: parentCapability },
  ])('rejects malformed input before policy/store work: %j', async change => {
    const { service, store, replacementModeFor } = fixture();
    await expect(service.createRequest({ ...intent(), ...change } as unknown as DirectIssuerRequestInput))
      .rejects.toThrow('issuer_request_invalid');
    expect(replacementModeFor).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([]);
  });
});

describe('account and check admission policy', () => {
  const states: DirectIssuerRequestState[] = ['pending', 'anchoring', 'ready', 'delivered'];
  const modes: CredentialReplacementMode[] = ['deny', 'replace_after_delivery', 'parallel'];
  it.each(modes.flatMap(mode => states.map(state => ({ mode, state }))))('$mode with an existing $state request', async ({ mode, state }) => {
    const { service, store } = fixture(mode);
    const parent = record({ state, attestationHash: 'a'.repeat(64) });
    await store.create(parent);
    const next = intent({ idempotencyKey: 'second', deliveryCapabilityHash: hashCapability(childCapability) });
    if (mode === 'deny' || (mode === 'replace_after_delivery' && state !== 'delivered')) {
      await expect(service.createRequest(next)).rejects.toThrow(mode === 'deny' ? 'active_credential_exists' : 'issuer_request_in_progress');
      expect(await store.list()).toEqual([parent]);
    } else {
      const created = await service.createRequest(next);
      expect(created.replacementRequired).toBe(mode === 'replace_after_delivery');
      expect((await store.get(created.requestId))?.replacedAttestationHash)
        .toBe(mode === 'replace_after_delivery' ? parent.attestationHash : undefined);
      expect(await store.list()).toHaveLength(2);
    }
    await expect(service.createRequest(intent())).resolves.toMatchObject({ requestId: parent.requestId, state });
  });

  it.each(['deny', 'replace_after_delivery'] as const)('enforces %s across concurrent distinct keys', async mode => {
    const { service, store } = fixture(mode);
    const results = await Promise.allSettled([
      service.createRequest(intent()), service.createRequest(intent({ idempotencyKey: 'second' })),
    ]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(value => value.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: new Error(mode === 'deny' ? 'active_credential_exists' : 'issuer_request_in_progress') }),
    ]);
    expect(await store.list()).toHaveLength(1);
  });

  it('allows concurrent distinct intents under parallel policy', async () => {
    const { service, store } = fixture('parallel');
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      service.createRequest(intent({ idempotencyKey: `parallel-${index}` }))));
    expect(new Set(results.map(value => value.requestId)).size).toBe(6);
    expect(await store.list()).toHaveLength(6);
  });

  it('isolates policy by account and check, while idempotency remains account-scoped', async () => {
    const { service, store } = fixture('deny');
    await service.createRequest(intent());
    await service.createRequest(intent({ serviceAccountRef: 'account-b' }));
    await service.createRequest(intent({ checkId: 'other-check', idempotencyKey: 'other-key' }));
    await expect(service.createRequest(intent({ checkId: 'third-check' }))).rejects.toThrow('issuer_request_idempotency_conflict');
    expect(await store.list()).toHaveLength(3);
  });

  it.each(['denied', 'failed', 'revoked'] as const)('does not let a terminal %s request reserve the policy slot', async state => {
    const { service, store } = fixture('deny');
    await store.create(record({ state }));
    await expect(service.createRequest(intent({ idempotencyKey: 'next' }))).resolves.toMatchObject({ state: 'pending' });
  });

  it.each(['missing commitment', 'multiple delivered'] as const)('rejects invalid replacement state: %s', async kind => {
    const { service, store } = fixture('replace_after_delivery');
    await store.create(record({ state: 'delivered', ...(kind === 'multiple delivered' ? { attestationHash: 'a'.repeat(64) } : {}) }));
    if (kind === 'multiple delivered') await store.create(record({ requestId: 'other', idempotencyKey: 'other', state: 'delivered', attestationHash: 'b'.repeat(64) }));
    await expect(service.createRequest(intent({ idempotencyKey: 'next' }))).rejects.toThrow('issuer_replacement_state_invalid');
    expect((await store.list()).every(value => value.state === 'delivered')).toBe(true);
  });
});

describe('renewal admission', () => {
  it('replays a lost child response even after delivery revokes its parent, without returning either secret', async () => {
    const { service, store, parent, revokeReplacedCredential } = await deliveredParent();
    const input = renewalIntent(parent.requestId);
    await service.createRenewalRequest(input);
    const [child] = await store.findPending(parent.serviceAccountRef, parent.checkId);
    const replay = await service.createRenewalRequest(input);
    expect(replay).toEqual({ requestId: child.requestId, state: 'pending', replacementRequired: true });
    expect(child).toMatchObject({ renewalOfRequestId: parent.requestId, replacedAttestationHash: parent.attestationHash,
      deliveryCapabilityHash: hashCapability(childCapability), claims: parent.claims, consent: parent.consent });
    const ready = await service.approve(child.requestId);
    await expect(service.getDelivery(child.requestId, parentCapability)).rejects.toThrow('delivery_capability_invalid');
    await expect(service.getDelivery(child.requestId, childCapability)).resolves.toMatchObject({ state: 'ready' });
    await service.acknowledgeDelivery(child.requestId, childCapability, ready.attestationHash!);
    expect((await store.get(parent.requestId))?.state).toBe('revoked');
    const afterRevocation = await service.createRenewalRequest(input);
    expect(afterRevocation).toEqual({ ...replay, state: 'delivered' });
    expect(revokeReplacedCredential).toHaveBeenCalledExactlyOnceWith({ requestId: child.requestId, attestationHash: parent.attestationHash });
    expect(await store.list()).toHaveLength(2);
    for (const value of [replay, afterRevocation, child]) {
      expect(value).not.toHaveProperty('deliveryCapability');
      expect(JSON.stringify(value)).not.toContain(parentCapability);
      expect(JSON.stringify(value)).not.toContain(childCapability);
    }
  });

  it('serializes concurrent identical renewals and rejects a different child intent', async () => {
    const { service, store, parent } = await deliveredParent();
    const results = await Promise.all(Array.from({ length: 8 }, () => service.createRenewalRequest(renewalIntent(parent.requestId))));
    expect(new Set(results.map(value => value.requestId)).size).toBe(1);
    await expect(service.createRenewalRequest(renewalIntent(parent.requestId, { deliveryCapabilityHash: hashCapability('different-child') })))
      .rejects.toThrow('issuer_request_idempotency_conflict');
    await expect(service.createRenewalRequest(renewalIntent(parent.requestId, { idempotencyKey: 'different-key' })))
      .rejects.toThrow('issuer_request_in_progress');
    expect(await store.list()).toHaveLength(2);
  });

  it('preserves the first child consent timestamp on renewal replay', async () => {
    const { service, store, parent } = await deliveredParent();
    const input = renewalIntent(parent.requestId);
    const child = await service.createRenewalRequest(input);
    const storedChild = await store.get(child.requestId);
    const storedParent = (await store.get(parent.requestId))!;
    await store.update({ ...storedParent, consent: { ...storedParent.consent!, acceptedAtIso: '2026-09-25T11:00:00.000Z' } });
    await expect(service.createRenewalRequest(input)).resolves.toEqual(child);
    expect(await store.get(child.requestId)).toEqual(storedChild);
    expect(storedChild?.consent?.acceptedAtIso).toBe(timestamp);
    await store.update({ ...storedParent, consent: { ...storedParent.consent!, text: 'Changed consent' } });
    await expect(service.createRenewalRequest(input)).rejects.toThrow('issuer_request_idempotency_conflict');
    expect(await store.get(child.requestId)).toEqual(storedChild);
  });

  it.each([false, true])('admits one concurrent different renewal intent (distinct keys: %s)', async distinctKeys => {
    const { service, store, parent } = await deliveredParent();
    const results = await Promise.allSettled([
      service.createRenewalRequest(renewalIntent(parent.requestId)),
      service.createRenewalRequest(renewalIntent(parent.requestId, {
        holderBinding: 'racing-child', idempotencyKey: distinctKeys ? 'other-renewal' : 'renewal',
        deliveryCapabilityHash: hashCapability('other-wallet-child'),
      })),
    ]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(value => value.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: new Error(distinctKeys ? 'issuer_request_in_progress' : 'issuer_request_idempotency_conflict') }),
    ]);
    expect(await store.list()).toHaveLength(2);
    expect(await store.findPending(parent.serviceAccountRef, parent.checkId)).toHaveLength(1);
  });

  it('rejects wrong parent capabilities, reused child hashes, and replay against another parent', async () => {
    const { service, store, parent } = await deliveredParent();
    await expect(service.createRenewalRequest(renewalIntent('missing'))).rejects.toThrow('renewal_capability_invalid');
    await expect(service.createRenewalRequest(renewalIntent(parent.requestId, { deliveryCapability: childCapability })))
      .rejects.toThrow('renewal_capability_invalid');
    await expect(service.createRenewalRequest(renewalIntent(parent.requestId, { deliveryCapabilityHash: hashCapability(parentCapability) })))
      .rejects.toThrow('issuer_renewal_invalid');
    expect(await store.list()).toHaveLength(1);
    const child = await service.createRenewalRequest(renewalIntent(parent.requestId));
    await store.create({ ...parent, state: 'delivered', requestId: 'other-parent', idempotencyKey: 'other-parent', attestationHash: 'f'.repeat(64) });
    await expect(service.createRenewalRequest(renewalIntent('other-parent'))).rejects.toThrow('issuer_request_idempotency_conflict');
    await expect(service.createRequest(intent({ holderBinding: 'holder-child', deliveryPublicKey: 'wallet-key-child',
      holderRevocationSigner: `0x${'cd'.repeat(20)}`, deliveryCapabilityHash: hashCapability(childCapability), idempotencyKey: 'renewal' })))
      .rejects.toThrow('issuer_request_idempotency_conflict');
    expect((await store.get(child.requestId))?.renewalOfRequestId).toBe(parent.requestId);
  });

  it.each(['pending', 'anchoring', 'ready', 'revoked', 'failed', 'denied'] as const)('cannot initiate a renewal from a %s parent', async state => {
    const { store, service } = fixture();
    await store.create(record({ state, attestationHash: 'a'.repeat(64) }));
    await expect(service.createRenewalRequest(renewalIntent('parent-request'))).rejects.toThrow('credential_not_renewable');
    expect(await store.list()).toHaveLength(1);
  });

  it('snapshots renewal input before fetching its parent', async () => {
    const { service, store, parent } = await deliveredParent();
    const originalGet = store.get.bind(store);
    const gate = deferred();
    vi.spyOn(store, 'get').mockImplementationOnce(async id => { await gate.promise; return originalGet(id); });
    const input = renewalIntent(parent.requestId);
    const pending = service.createRenewalRequest(input);
    input.requestId = 'wrong-parent';
    input.deliveryCapability = 'wrong-capability';
    input.deliveryCapabilityHash = hashCapability('wrong-child');
    input.holderBinding = 'mutated';
    gate.resolve();
    const child = await pending;
    expect(await store.get(child.requestId)).toMatchObject({ renewalOfRequestId: parent.requestId,
      holderBinding: 'holder-child', deliveryCapabilityHash: hashCapability(childCapability) });
  });
});

describe('in-memory admission transactions', () => {
  it('rolls back staged updates and creates on failure and releases the transaction queue', async () => {
    const store = new InMemoryDirectIssuerRequestStore();
    const original = record();
    await store.create(original);
    await expect(store.withAccountTransaction('account-a', 'membership', async transaction => {
      await transaction.update({ ...original, state: 'denied' });
      await transaction.create(record({ requestId: 'child', idempotencyKey: 'child' }));
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await store.list()).toEqual([original]);
    await store.withAccountTransaction('account-a', 'membership', async transaction => {
      await transaction.update({ ...original, state: 'denied' });
    });
    expect((await store.get(original.requestId))?.state).toBe('denied');
  });

  it('rejects duplicate request IDs and account-wide idempotency collisions without replacing records', async () => {
    const store = new InMemoryDirectIssuerRequestStore();
    await store.create(record());
    await expect(store.create(record({ idempotencyKey: 'different' }))).rejects.toThrow('issuer_request_duplicate');
    await expect(store.create(record({ requestId: 'other', checkId: 'other-check' }))).rejects.toThrow('issuer_request_idempotency_conflict');
    await expect(store.update(record({ requestId: 'missing' }))).rejects.toThrow('issuer_request_not_found');
    expect(await store.list()).toEqual([record()]);
    await store.create(record({ requestId: 'other-account', serviceAccountRef: 'account-b' }));
    expect(await store.list()).toHaveLength(2);
  });

  it('rejects cross-scope and nested writes, leaving the outer transaction usable', async () => {
    const store = new InMemoryDirectIssuerRequestStore();
    await store.create(record());
    await store.withAccountTransaction('account-a', 'membership', async transaction => {
      await expect(transaction.create(record({ requestId: 'cross-account', serviceAccountRef: 'account-b' })))
        .rejects.toThrow('issuer_transaction_scope_invalid');
      await expect(transaction.create(record({ requestId: 'cross-check', checkId: 'other' })))
        .rejects.toThrow('issuer_transaction_scope_invalid');
      await expect(transaction.update(record({ idempotencyKey: 'changed' }))).rejects.toThrow('issuer_transaction_scope_invalid');
      await expect(transaction.withAccountTransaction('account-a', 'membership', async () => undefined))
        .rejects.toThrow('issuer_transaction_nested');
      await transaction.update(record({ state: 'denied' }));
    });
    expect(await store.list()).toEqual([record({ state: 'denied' })]);
  });

  it.each(['create', 'update'] as const)('detects an unfenced %s race without losing the external write', async operation => {
    const store = new InMemoryDirectIssuerRequestStore();
    await store.create(record());
    const entered = deferred();
    const release = deferred();
    const pending = store.withAccountTransaction('account-a', 'membership', async transaction => {
      await transaction.update(record({ state: 'denied' }));
      await transaction.create(record({ requestId: 'staged', idempotencyKey: 'staged' }));
      entered.resolve();
      await release.promise;
    });
    const rejected = expect(pending).rejects.toThrow('issuer_transaction_conflict');
    await entered.promise;
    if (operation === 'create') await store.create(record({ requestId: 'external', idempotencyKey: 'external' }));
    else await store.update(record({ state: 'ready', attestationHash: 'a'.repeat(64) }));
    const before = await store.list();
    release.resolve();
    await rejected;
    expect(await store.list()).toEqual(before);
    expect(await store.get('staged')).toBeUndefined();
    await store.withAccountTransaction('account-a', 'membership', async transaction => {
      await transaction.create(record({ requestId: 'after-race', idempotencyKey: 'after-race' }));
    });
    expect(await store.get('after-race')).toBeDefined();
  });
});
