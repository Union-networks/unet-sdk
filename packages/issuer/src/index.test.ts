import { describe, expect, it } from 'vitest';
import { createIssuerMiniappManifest, generateIssuerKeyPair, signIssuerAction, verifyIssuerEnvelopeSignature } from './index.js';

describe('@union-networks/issuer', () => {
  it('signs and verifies issuer envelopes', () => {
    const keys = generateIssuerKeyPair();
    const envelope = signIssuerAction({ issuerId: 'issuer:test', keyId: 'issuer:test#main', privateKeyPem: keys.privateKeyPem, action: 'attestation.approve', payload: { requestId: 'request-1', claims: { ok: true } } });
    expect(envelope.signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifyIssuerEnvelopeSignature(envelope, keys.publicKeyPem)).toBe(true);
    expect(verifyIssuerEnvelopeSignature({ ...envelope, payload: { requestId: 'other' } }, keys.publicKeyPem)).toBe(false);
  });

  it('creates issuer miniapp manifests with scoped identity permissions', () => {
    expect(createIssuerMiniappManifest({ serviceId: 'authority-portal', name: 'Authority Portal', provider: 'Demo Authority', launchUrl: 'https://authority.example/miniapp' })).toMatchObject({
      serviceId: 'authority-portal',
      permissions: ['identity.scoped', 'attestations.request', 'attestations.refresh'],
    });
  });
});
