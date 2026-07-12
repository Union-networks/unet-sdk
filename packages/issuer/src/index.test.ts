import { describe, expect, it } from 'vitest';
import { createCredentialEnvelopeV2, createIssuerMiniappManifest, deriveHolderBindingV2, derivePredicateV2, generateCredentialSigningKeyPair, generateIssuerKeyPair, signIssuerAction, verifyIssuerEnvelopeSignature } from './index.js';

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

  it('creates deterministic, signed credential envelope v2 vectors', async () => {
    const keys = generateCredentialSigningKeyPair();
    const holderBinding = await deriveHolderBindingV2('123456789');
    const input = {
      requestType: 'adult-test', schemaId: 'unet.test.adult.v1', issuerId: 'issuer:test', issuerKeyId: 'issuer:test#api',
      issuerCredentialKeyId: 'issuer:test#credential', credentialPrivateKeyPem: keys.privateKeyPem, holderBinding,
      validFromEpoch: 1_800_000_000, validUntilEpoch: 1_900_000_000, statusEpoch: 1,
      claims: [{ path: 'age_years', type: 'u64' as const, value: 21 }], claimSalts: ['11'], commitmentSalt: '22',
    };
    const first = await createCredentialEnvelopeV2(input);
    const second = await createCredentialEnvelopeV2(input);
    expect(first).toEqual(second);
    expect(first.signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.claims[0]?.siblings).toHaveLength(8);
    expect(await derivePredicateV2({ proofProfileId: 'claim_range_v1', schemaId: input.schemaId, claimPath: 'age_years', lowerBound: 18, upperBound: 150 })).toMatch(/^[0-9]+$/);
  });
});
