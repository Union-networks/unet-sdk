import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDirectIssuerService, InMemoryDirectIssuerRequestStore } from './directIssuer.js';

const firstCapability = 'wallet-generated-first-capability';
const childCapability = 'wallet-generated-child-capability';
const hashCapability = (value: string) => createHash('sha256').update(value).digest('hex');

describe('direct issuer service', () => {
  it('stores encrypted delivery before anchoring and revokes a replacement only after acknowledgement', async () => {
    const store = new InMemoryDirectIssuerRequestStore();
    const events: string[] = [];
    const service = createDirectIssuerService({
      store,
      replacementModeFor: async () => 'replace_after_delivery',
      buildCredential: async () => ({
        attestationHash: '11'.repeat(32),
        encryptedCredentialEnvelope: { version: 2, ciphertext: 'opaque' },
      }),
      anchorCredential: async ({ request }) => {
        const persisted = await store.get(request.requestId);
        expect(persisted?.state).toBe('anchoring');
        expect(persisted?.encryptedCredentialEnvelope).toEqual({ version: 2, ciphertext: 'opaque' });
        events.push('anchored');
        return { transactionHash: `0x${'22'.repeat(32)}`, status: 'active' };
      },
      revokeReplacedCredential: async () => { events.push('replaced-revoked'); },
    });
    const first = await service.createRequest({
      serviceAccountRef: 'scoped-provider-account',
      checkId: 'membership.test',
      holderBinding: 'holder-binding',
      deliveryPublicKey: 'delivery-key',
      deliveryCapabilityHash: hashCapability(firstCapability),
      holderRevocationSigner: `0x${'33'.repeat(20)}`,
      idempotencyKey: 'first',
    });
    const ready = await service.approve(first.requestId);
    await service.acknowledgeDelivery(first.requestId, firstCapability, ready.attestationHash!);

    const replacement = await service.createRequest({
      serviceAccountRef: 'scoped-provider-account',
      checkId: 'membership.test',
      holderBinding: 'holder-binding-2',
      deliveryPublicKey: 'delivery-key-2',
      deliveryCapabilityHash: hashCapability(childCapability),
      holderRevocationSigner: `0x${'44'.repeat(20)}`,
      idempotencyKey: 'second',
    });
    expect(replacement.replacementRequired).toBe(true);
    const replacementReady = await service.approve(replacement.requestId);
    expect(events).toEqual(['anchored', 'anchored']);
    await service.acknowledgeDelivery(replacement.requestId, childCapability, replacementReady.attestationHash!);
    expect(events).toEqual(['anchored', 'anchored', 'replaced-revoked']);
    const delivered = await store.get(replacement.requestId);
    await service.acknowledgeDelivery(replacement.requestId, childCapability, '0x' + replacementReady.attestationHash!.toUpperCase());
    for (const invalid of ['ff'.repeat(32), '', '0x', 'not-a-hash']) {
      await expect(service.acknowledgeDelivery(replacement.requestId, childCapability, invalid))
        .rejects.toThrow('delivery_acknowledgement_invalid');
    }
    await expect(service.acknowledgeDelivery(replacement.requestId, 'wrong-capability', replacementReady.attestationHash!))
      .rejects.toThrow('delivery_capability_invalid');
    expect(await store.get(replacement.requestId)).toEqual(delivered);
    expect(events).toEqual(['anchored', 'anchored', 'replaced-revoked']);
  });

  it('lists, denies, and revokes provider-owned requests without central storage', async () => {
    const store = new InMemoryDirectIssuerRequestStore();
    const revoked: string[] = [];
    let credentialIndex = 0;
    const service = createDirectIssuerService({
      store,
      replacementModeFor: async () => 'parallel',
      buildCredential: async () => ({
        attestationHash: (++credentialIndex).toString(16).padStart(64, '0'),
        encryptedCredentialEnvelope: { ciphertext: 'opaque' },
      }),
      anchorCredential: async () => ({ transactionHash: `0x${'22'.repeat(32)}`, status: 'active' }),
      revokeReplacedCredential: async () => undefined,
      revokeCredential: async ({ attestationHash }) => { revoked.push(attestationHash); },
    });
    const deniedRequest = await service.createRequest({
      serviceAccountRef: 'account-a', checkId: 'check-a', holderBinding: 'binding', deliveryPublicKey: 'delivery',
      deliveryCapabilityHash: hashCapability(firstCapability),
      holderRevocationSigner: `0x${'11'.repeat(20)}`, idempotencyKey: 'deny-a',
    });
    expect((await service.deny(deniedRequest.requestId)).state).toBe('denied');
    expect(await service.list({ state: 'denied' })).toHaveLength(1);

    const issuedRequest = await service.createRequest({
      serviceAccountRef: 'account-a', checkId: 'check-a', holderBinding: 'binding', deliveryPublicKey: 'delivery',
      deliveryCapabilityHash: hashCapability(childCapability),
      holderRevocationSigner: `0x${'33'.repeat(20)}`, idempotencyKey: 'issue-a',
    });
    const ready = await service.approve(issuedRequest.requestId);
    await expect(service.authorizeRevocation({
      requestId: issuedRequest.requestId,
      deliveryCapability: 'wrong-capability',
      attestationHash: ready.attestationHash!,
    })).rejects.toThrow('revocation_capability_invalid');
    await expect(service.authorizeRevocation({
      requestId: issuedRequest.requestId,
      deliveryCapability: childCapability,
      attestationHash: `${'ff'.repeat(32)}`,
    })).rejects.toThrow('revocation_commitment_mismatch');
    await expect(service.authorizeRevocation({
      requestId: issuedRequest.requestId,
      deliveryCapability: childCapability,
      attestationHash: ready.attestationHash!,
    })).resolves.toMatchObject({
      serviceAccountRef: 'account-a',
      attestationHash: ready.attestationHash,
      state: 'ready',
    });
    expect((await service.revoke(ready.attestationHash!, 'operator_revoked')).state).toBe('revoked');
    expect((await service.revoke(ready.attestationHash!, 'operator_revoked')).state).toBe('revoked');
    expect(revoked).toEqual([ready.attestationHash]);
  });

  it('renews with an opaque delivery capability and preserves the provider account context', async () => {
    const store = new InMemoryDirectIssuerRequestStore();
    const revoked: string[] = [];
    let credentialIndex = 0;
    const service = createDirectIssuerService({
      store,
      replacementModeFor: async () => 'replace_after_delivery',
      buildCredential: async (request) => ({
        attestationHash: (++credentialIndex).toString(16).padStart(64, '0'),
        encryptedCredentialEnvelope: { ciphertext: request.requestId },
      }),
      anchorCredential: async () => ({ transactionHash: `0x${'55'.repeat(32)}`, status: 'active' }),
      revokeReplacedCredential: async ({ attestationHash }) => { revoked.push(attestationHash); },
    });
    const first = await service.createRequest({
      serviceAccountRef: 'scoped-account-a',
      checkId: 'membership.messaging-access',
      holderBinding: 'holder-a',
      deliveryPublicKey: 'delivery-a',
      deliveryCapabilityHash: hashCapability(firstCapability),
      holderRevocationSigner: `0x${'11'.repeat(20)}`,
      claims: { membership_id: 'messaging-access', service_account_generation: 'generation-a' },
      idempotencyKey: 'initial',
    });
    const ready = await service.approve(first.requestId);
    await service.acknowledgeDelivery(first.requestId, firstCapability, ready.attestationHash!);

    await expect(service.createRenewalRequest({
      requestId: first.requestId,
      deliveryCapability: 'wrong-capability',
      deliveryCapabilityHash: hashCapability(childCapability),
      holderBinding: 'holder-b',
      deliveryPublicKey: 'delivery-b',
      holderRevocationSigner: `0x${'22'.repeat(20)}`,
      idempotencyKey: 'renewal-1',
    })).rejects.toThrow('renewal_capability_invalid');

    const renewal = await service.createRenewalRequest({
      requestId: first.requestId,
      deliveryCapability: firstCapability,
      deliveryCapabilityHash: hashCapability(childCapability),
      holderBinding: 'holder-b',
      deliveryPublicKey: 'delivery-b',
      holderRevocationSigner: `0x${'22'.repeat(20)}`,
      idempotencyKey: 'renewal-1',
    });
    const renewalRecord = await store.get(renewal.requestId);
    expect(renewalRecord?.serviceAccountRef).toBe('scoped-account-a');
    expect(renewalRecord?.claims?.service_account_generation).toBe('generation-a');
    expect(renewalRecord?.replacedAttestationHash).toBe(ready.attestationHash);
    expect(renewalRecord?.renewalOfRequestId).toBe(first.requestId);
    expect(renewal).not.toHaveProperty('deliveryCapability');
    const renewedReady = await service.approve(renewal.requestId);
    await service.acknowledgeDelivery(renewal.requestId, childCapability, renewedReady.attestationHash!);
    expect(revoked).toEqual([ready.attestationHash]);
  });
});
