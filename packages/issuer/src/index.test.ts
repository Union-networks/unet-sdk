import { describe, expect, it } from 'vitest';
import { createAttestationRequest, createCredentialEnvelopeV2, createDomainAdminCallbackHandler, createDomainAdminControlAuthorization, createDomainAdminControlAuthorizationV2, createHolderRelinquishmentCallbackHandler, createIssuerMiniappManifest, deriveCredentialPublicKeyHash, deriveHolderBindingV2, derivePredicateV2, fetchUnetControlPublicKeys, generateCredentialSigningKeyPair, generateDomainAdminSignerEnv, generateIssuerKeyPair, resolveCredentialValidity, signIssuerAction, verifyDomainAdminControlAuthorization, verifyDomainAdminControlAuthorizationV2, verifyIssuerEnvelopeSignature } from './index.js';

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

  it('sends provider authorization outside the request body', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ success: true, request: { requestId: 'request-1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      await createAttestationRequest({
        serviceId: 'issuer.example',
        scopedUserId: 'scoped-1',
        requestType: 'membership-check',
        holderBinding: '123',
        deliveryPublicKey: 'a'.repeat(43),
        signer: { issuerId: 'issuer:issuer.example', keyId: 'issuer:issuer.example#api', privateKeyPem: generateIssuerKeyPair().privateKeyPem },
        providerToken: 'provider-secret',
      }, { issuerBaseUrl: 'https://issuer.example' });
      expect(calls[0]?.init?.headers).toMatchObject({ authorization: 'Bearer provider-secret' });
      expect(calls[0]?.init?.headers).toMatchObject({ 'x-unet-issuer-auth': expect.any(String) });
      expect(String(calls[0]?.init?.body)).not.toContain('provider-secret');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('enforces the exact fixed credential lifetime', () => {
    expect(resolveCredentialValidity({
      policy: { validityMode: 'fixed', defaultValidityDays: 365, renewalMode: 'silent_reissue', renewalWindowDays: 30 },
      nowEpoch: 1_000,
    })).toEqual({ validFromEpoch: 1_000, validUntilEpoch: 31_537_000 });
    expect(() => resolveCredentialValidity({
      policy: { validityMode: 'fixed', defaultValidityDays: 365, renewalMode: 'silent_reissue', renewalWindowDays: 30 },
      nowEpoch: 1_000,
      requestedValidityDays: 30,
    })).toThrow('credential_fixed_validity_mismatch');
  });

  it('requires capped issuers to provide an expiry within policy', () => {
    const policy = { validityMode: 'issuer_capped' as const, maximumValidityDays: 90, renewalMode: 'holder_reissue' as const };
    expect(() => resolveCredentialValidity({ policy, nowEpoch: 1_000 })).toThrow('credential_validity_required');
    expect(() => resolveCredentialValidity({ policy, nowEpoch: 1_000, requestedValidityDays: 91 })).toThrow('credential_validity_exceeds_policy');
    expect(resolveCredentialValidity({ policy, nowEpoch: 1_000, requestedValidityDays: 30 })).toEqual({ validFromEpoch: 1_000, validUntilEpoch: 2_593_000 });
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

  it('derives a stable circuit credential key hash', async () => {
    const keys = generateCredentialSigningKeyPair();
    expect(await deriveCredentialPublicKeyHash(keys.publicKeyPem)).toBe(await deriveCredentialPublicKeyHash(keys.publicKeyPem));
  });

  it('exports a complete domain administration signer environment once', async () => {
    const generated = await generateDomainAdminSignerEnv({ serviceId: 'issuer.example' });
    expect(generated.env).toContain('UNET_DOMAIN_ADMIN_PRIVATE_KEY_PEM=');
    expect(generated.env).toContain('UNET_DOMAIN_ADMIN_CREDENTIAL_PRIVATE_KEY_PEM=');
    expect(generated.env).toContain('UNET_DOMAIN_ADMIN_LEDGER_PRIVATE_KEY=0x');
    expect(generated.ledgerAddress).toMatch(/^0x[a-f0-9]{40}$/);
    expect(generated.credentialPublicKeyHash).toMatch(/^[0-9]+$/);
  });

  it('authenticates domain administration control callbacks over canonical request data', () => {
    const secret = 'domain-admin-control-secret-for-tests';
    const body = { version: 2, action: 'domain-admin.issue', serviceId: 'issuer.example', nested: { b: 2, a: 1 } };
    const authorization = createDomainAdminControlAuthorization(body, secret);
    expect(verifyDomainAdminControlAuthorization(body, authorization, secret)).toBe(true);
    expect(verifyDomainAdminControlAuthorization({ ...body, serviceId: 'other.example' }, authorization, secret)).toBe(false);
  });

  it('authenticates asymmetric domain administration callbacks', () => {
    const keys = generateIssuerKeyPair();
    const body = { version: 2, action: 'domain-admin.issue', serviceId: 'issuer.example' };
    const authorization = createDomainAdminControlAuthorizationV2({ body, privateKeyPem: keys.privateKeyPem, keyId: 'control-1', method: 'POST', path: '/api/unet/domain-admin/issue', audience: 'issuer.example', issuedAt: 1000, nonce: 'abcdefghijklmnop' });
    expect(verifyDomainAdminControlAuthorizationV2({ body, authorization, publicKeys: { 'control-1': keys.publicKeyPem }, method: 'POST', path: '/api/unet/domain-admin/issue', audience: 'issuer.example', nowEpoch: 1000 }).valid).toBe(true);
    expect(verifyDomainAdminControlAuthorizationV2({ body, authorization, publicKeys: { 'control-1': keys.publicKeyPem }, method: 'POST', path: '/wrong', audience: 'issuer.example', nowEpoch: 1000 }).valid).toBe(false);
  });

  it('discovers only Ed25519 control keys', async () => {
    const keys = await fetchUnetControlPublicKeys({
      controlPlaneUrl: 'https://issuer.example',
      fetch: async () => new Response(JSON.stringify({ keys: [
        { keyId: 'control-1', algorithm: 'Ed25519', publicKeyPem: 'pem' },
        { keyId: 'wrong', algorithm: 'RSA', publicKeyPem: 'no' },
      ] }), { status: 200 }),
    });
    expect(keys).toEqual({ 'control-1': 'pem' });
  });

  it('validates and consumes domain administration callbacks once', async () => {
    const signerKeys = generateIssuerKeyPair();
    const consumed = new Set<string>();
    const handler = createDomainAdminCallbackHandler({
      serviceId: 'issuer.example',
      origin: 'https://issuer.example',
      signer: { issuerId: 'domain:issuer.example', keyId: 'domain:issuer.example#callback', privateKeyPem: signerKeys.privateKeyPem },
      consumeChallenge: async (challenge) => consumed.has(challenge) ? false : (consumed.add(challenge), true),
      issueCredential: async () => ({ attestationCommitment: 'a'.repeat(64), encryptedCredentialEnvelope: { version: 2 }, credentialPublicMetadata: { issuerKeyHash: '123' } }),
    });
    const request = {
      version: 1 as const, action: 'domain-admin.issue' as const, invitationId: 'invite-1', serviceId: 'issuer.example', origin: 'https://issuer.example', role: 'owner' as const,
      requestType: 'private-domain-admin-issuer-example-owner', schemaId: 'unet.provider.domain-admin.v1', claims: { domain_role: 'issuer.example:owner', service_id: 'issuer.example', role: 'owner' },
      holderBinding: '123', deliveryPublicKey: 'a'.repeat(43), challenge: 'challenge-1', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    await expect(handler(request, { 'x-unet-domain-admin-challenge': request.challenge })).resolves.toMatchObject({ keyId: 'domain:issuer.example#callback' });
    await expect(handler(request, { 'x-unet-domain-admin-challenge': request.challenge })).rejects.toThrow('domain_admin_challenge_replayed');
  });

  it('authorizes holder relinquishment callbacks once and returns a normal issuer revocation envelope', async () => {
    const signerKeys = generateIssuerKeyPair();
    const challenges = new Set<string>();
    const handler = createHolderRelinquishmentCallbackHandler({
      serviceId: 'issuer.example',
      signer: { issuerId: 'issuer:example', keyId: 'issuer:example#api', privateKeyPem: signerKeys.privateKeyPem },
      consumeChallenge: async (challenge) => challenges.has(challenge) ? false : (challenges.add(challenge), true),
      authorizeRelinquishment: async () => true
    });
    const request = {
      version: 1 as const,
      action: 'attestation.relinquish' as const,
      actionId: 'remove-1',
      serviceId: 'issuer.example',
      issuerId: 'issuer:example',
      requestType: 'membership-check',
      attestationHash: 'd'.repeat(64),
      challenge: 'challenge-1',
      issuedAtIso: new Date().toISOString()
    };
    await expect(handler(request)).resolves.toMatchObject({ action: 'attestation.revoke', payload: { actionId: 'remove-1', challenge: 'challenge-1' } });
    await expect(handler(request)).rejects.toThrow('holder_relinquishment_challenge_replayed');
  });
});
