import { describe, expect, it } from 'vitest';
import { createDirectIssuerService, InMemoryDirectIssuerRequestStore } from './directIssuer.js';

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
      holderRevocationSigner: `0x${'33'.repeat(20)}`,
      idempotencyKey: 'first',
    });
    const ready = await service.approve(first.requestId);
    await service.acknowledgeDelivery(first.requestId, first.deliveryCapability, ready.attestationHash!);

    const replacement = await service.createRequest({
      serviceAccountRef: 'scoped-provider-account',
      checkId: 'membership.test',
      holderBinding: 'holder-binding-2',
      deliveryPublicKey: 'delivery-key-2',
      holderRevocationSigner: `0x${'44'.repeat(20)}`,
      idempotencyKey: 'second',
    });
    expect(replacement.replacementRequired).toBe(true);
    const replacementReady = await service.approve(replacement.requestId);
    expect(events).toEqual(['anchored', 'anchored']);
    await service.acknowledgeDelivery(replacement.requestId, replacement.deliveryCapability, replacementReady.attestationHash!);
    expect(events).toEqual(['anchored', 'anchored', 'replaced-revoked']);
  });
});
