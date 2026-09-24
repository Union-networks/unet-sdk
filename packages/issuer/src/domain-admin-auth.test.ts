import { describe, expect, it, vi } from 'vitest';
import { sign } from 'node:crypto';
import {
  createDomainAdminCallbackHandler, createDomainAdminCallbackHandlerV2,
  createDomainAdminControlAuthorization, createDomainAdminControlAuthorizationV2,
  generateIssuerKeyPair, verifyDomainAdminControlAuthorizationV2,
} from './index.js';

const keys = generateIssuerKeyPair();
const serviceId = 'fixture';
const path = '/api/unet/domain-admin/issue';
const body = () => ({
  version: 2 as const, action: 'domain-admin.issue' as const, serviceId, origin: 'https://provider.test',
  invitationId: 'invitation', role: 'owner' as const, requestType: 'fixture-domain-admin',
  schemaId: 'unet.provider.domain-admin.v1', claims: { domain_role: 'fixture:owner', service_id: serviceId, role: 'owner' },
  holderBinding: '123', deliveryPublicKey: 'synthetic', clientRequestId: 'client',
  holderRevocationSigner: `0x${'a'.repeat(40)}`, challenge: 'challenge',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});
const authorization = (request: unknown, nonce = 'synthetic_nonce_12345') => createDomainAdminControlAuthorizationV2({
  body: request, privateKeyPem: keys.privateKeyPem, keyId: 'control', method: 'POST', path, audience: serviceId, nonce,
});

for (const factory of [createDomainAdminCallbackHandler, createDomainAdminCallbackHandlerV2]) {
  describe(factory.name, () => {
    function setup() {
      const nonces = new Set<string>();
      const consumeControlNonce = vi.fn(async (nonce: string) => {
        if (nonces.has(nonce)) return false;
        nonces.add(nonce);
        return true;
      });
      const consumeChallenge = vi.fn(async () => true);
      const issueCredential = vi.fn(async () => ({ attestationCommitment: 'a'.repeat(64), encryptedCredentialEnvelope: {}, credentialPublicMetadata: {} }));
      const signerAccess = vi.fn(() => ({ issuerId: 'fixture-issuer', keyId: 'fixture-key', privateKeyPem: keys.privateKeyPem }));
      const input = { serviceId, origin: 'https://provider.test', get signer() { return signerAccess(); },
        controlPublicKeys: { control: keys.publicKeyPem }, consumeControlNonce, consumeChallenge, issueCredential };
      return { handler: factory(input), input, consumeControlNonce, consumeChallenge, issueCredential, signerAccess };
    }
    it('rejects protocol v1 before signer access, nonce/challenge storage or credential work', async () => {
      const s = setup();
      const request = { ...body(), version: 1 };
      await expect(s.handler(request, {})).rejects.toThrow('protocol_upgrade_required');
      for (const effect of [s.signerAccess, s.consumeControlNonce, s.consumeChallenge, s.issueCredential]) expect(effect).not.toHaveBeenCalled();
    });
    it.each(['not-a-date', '', '2000-01-01T00:00:00Z'])('rejects invalid/expired invitation %s', async (expiresAt) => {
      const s = setup();
      const request = { ...body(), expiresAt };
      await expect(s.handler(request, { 'x-unet-domain-admin-challenge': request.challenge })).rejects.toThrow('domain_admin_invitation_expired');
      expect(s.consumeControlNonce).not.toHaveBeenCalled();
      expect(s.issueCredential).not.toHaveBeenCalled();
    });
    it.each([{ holderRevocationSigner: undefined }, { holderRevocationSigner: 'invalid' }, { clientRequestId: '' }])('requires holder revocation context %j', async (patch) => {
      const s = setup();
      const request = { ...body(), ...patch };
      await expect(s.handler(request, { 'x-unet-domain-admin-challenge': request.challenge })).rejects.toThrow('domain_admin_holder_revocation_invalid');
      expect(s.signerAccess).not.toHaveBeenCalled();
      expect(s.consumeControlNonce).not.toHaveBeenCalled();
    });
    it('rejects absent, invalid, duplicated, trailing and HMAC authorizations without side effects', async () => {
      const request = body();
      const valid = authorization(request);
      for (const header of [undefined, 'v2.invalid.invalid', [valid], [valid, valid], valid + ', ' + valid, valid + '.trailing',
        createDomainAdminControlAuthorization(request, 'synthetic-HMAC-secret-at-least-32-characters')]) {
        const s = setup();
        await expect(s.handler(request, { 'x-unet-domain-admin-challenge': request.challenge, 'x-unet-control-authorization': header }))
          .rejects.toThrow('domain_admin_control_authorization_invalid');
        for (const effect of [s.signerAccess, s.consumeControlNonce, s.consumeChallenge, s.issueCredential]) expect(effect).not.toHaveBeenCalled();
      }
    });
    it('rejects array/combined challenge headers', async () => {
      const s = setup();
      const request = body();
      for (const header of [[request.challenge], [request.challenge, request.challenge], request.challenge + ', ' + request.challenge]) {
        await expect(s.handler(request, { 'x-unet-domain-admin-challenge': header, 'x-unet-control-authorization': authorization(request) }))
          .rejects.toThrow('domain_admin_challenge_invalid');
      }
      expect(s.consumeControlNonce).not.toHaveBeenCalled();
    });
    it('accepts signed V2 with v1 schema, then rejects a genuinely signed reused nonce', async () => {
      const s = setup();
      const request = body();
      await expect(s.handler(request, { 'x-unet-domain-admin-challenge': request.challenge, 'x-unet-control-authorization': authorization(request) }))
        .resolves.toMatchObject({ keyId: 'fixture-key' });
      expect(s.issueCredential).toHaveBeenCalledWith(expect.objectContaining({ version: 2, schemaId: 'unet.provider.domain-admin.v1' }));
      const second = { ...request, challenge: 'second-challenge' };
      await expect(s.handler(second, { 'x-unet-domain-admin-challenge': second.challenge, 'x-unet-control-authorization': authorization(second) }))
        .rejects.toThrow('domain_admin_control_authorization_replayed');
      expect(s.consumeControlNonce).toHaveBeenCalledTimes(2);
      expect(s.consumeChallenge).toHaveBeenCalledTimes(1);
      expect(s.issueCredential).toHaveBeenCalledTimes(1);
      expect(s.signerAccess).toHaveBeenCalledTimes(1);
    });
    it('fails closed if the nonce consumer is missing at runtime', async () => {
      const s = setup();
      const request = body();
      const handler = factory({ ...s.input, consumeControlNonce: undefined } as unknown as Parameters<typeof factory>[0]);
      await expect(handler(request, { 'x-unet-domain-admin-challenge': request.challenge, 'x-unet-control-authorization': authorization(request) }))
        .rejects.toThrow('domain_admin_control_authorization_invalid');
      expect(s.issueCredential).not.toHaveBeenCalled();
    });
  });
}

it('the general adapter does not fall back to HMAC even when its legacy option is supplied', async () => {
  const request = body();
  const secret = 'synthetic-HMAC-secret-at-least-32-characters';
  const effect = vi.fn();
  const handler = createDomainAdminCallbackHandler({ serviceId, origin: request.origin,
    signer: { issuerId: 'fixture', keyId: 'fixture', privateKeyPem: keys.privateKeyPem },
    controlAuthorizationSecret: secret, consumeChallenge: effect, issueCredential: effect,
  });
  await expect(handler(request, { 'x-unet-domain-admin-challenge': request.challenge,
    'x-unet-control-authorization': createDomainAdminControlAuthorization(request, secret) }))
    .rejects.toThrow('domain_admin_control_authorization_invalid');
  expect(effect).not.toHaveBeenCalled();
});

it.each([undefined, null, '123', NaN, Infinity])('rejects a signed non-finite/missing timestamp %s', (issuedAt) => {
  const request = body();
  const payload = JSON.parse(Buffer.from(authorization(request).split('.')[1]!, 'base64url').toString());
  payload.issuedAt = issuedAt;
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(null, Buffer.from(encoded), keys.privateKeyPem).toString('base64url');
  const signed = `v2.${encoded}.${signature}`;
  expect(verifyDomainAdminControlAuthorizationV2({ body: request, authorization: signed,
    publicKeys: { control: keys.publicKeyPem }, method: 'POST', path, audience: serviceId }).valid).toBe(false);
});
