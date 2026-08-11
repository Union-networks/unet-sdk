import { createHmac } from 'node:crypto';
import { x25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';
import { createOfficialMessagingClient, createUnetMiniappManifest, createUnetProviderClaim, createUnetProviderClaimHandler, verifyLoginAssertion } from './index.js';

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const sign = (payload: unknown, secret = 's') => { const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64(payload); const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url'); return `${h}.${p}.${sig}`; };

describe('@union-networks/server', () => {
  it('verifies valid assertions and rejects tampering', () => {
    const assertion = sign({ serviceId: 'svc', scopedUserId: 'm_svc_1', sessionId: 'sess', expiresAtIso: new Date(Date.now()+10000).toISOString() });
    expect(verifyLoginAssertion(assertion, { secret: 's', serviceId: 'svc' }).scopedUserId).toBe('m_svc_1');
    expect(() => verifyLoginAssertion(assertion.replace(/.$/, 'x'), { secret: 's' })).toThrow();
  });

  it('creates a provider domain claim proof without exposing the raw token', () => {
    const claim = createUnetProviderClaim({
      serviceId: 'demo-shop',
      origin: 'https://shop.example/',
      claimId: 'claim_123',
      challenge: 'challenge_abc',
      claimToken: 'unet_claim_secret',
    });
    expect(claim).toMatchObject({
      serviceId: 'demo-shop',
      origin: 'https://shop.example',
      claimId: 'claim_123',
      challenge: 'challenge_abc',
    });
    expect(claim.proof).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(claim)).not.toContain('unet_claim_secret');
  });

  it('returns a reusable route handler for well-known provider claims', () => {
    const handler = createUnetProviderClaimHandler({
      serviceId: 'demo-shop',
      origin: 'https://shop.example',
      claimId: 'claim_123',
      challenge: 'challenge_abc',
      claimToken: 'unet_claim_secret',
    });
    expect(handler()).toEqual(createUnetProviderClaim({
      serviceId: 'demo-shop',
      origin: 'https://shop.example',
      claimId: 'claim_123',
      challenge: 'challenge_abc',
      claimToken: 'unet_claim_secret',
    }));
  });

  it('creates a miniapp manifest with an optional domain claim block', () => {
    const manifest = createUnetMiniappManifest({
      serviceId: 'demo-shop',
      name: 'Demo Shop',
      provider: 'Demo Provider',
      origin: 'https://shop.example',
      launchUrl: '/app',
      permissions: ['identity.scoped'],
      domainClaim: {
        serviceId: 'demo-shop',
        origin: 'https://shop.example',
        claimId: 'claim_123',
        challenge: 'challenge_abc',
        claimToken: 'unet_claim_secret',
      },
    });
    expect(manifest.launchUrl).toBe('https://shop.example/app');
    expect(manifest.domainClaim?.proof).toBeTypeOf('string');
    expect(JSON.stringify(manifest)).not.toContain('unet_claim_secret');
  });

  it('rejects a miniapp manifest launch URL on another origin', () => {
    expect(() => createUnetMiniappManifest({
      serviceId: 'demo-shop',
      name: 'Demo Shop',
      provider: 'Demo Provider',
      origin: 'https://shop.example',
      launchUrl: 'https://evil.example/app',
    })).toThrow('launch_url_origin_mismatch');
  });

  it('renders and encrypts an official automation without sending variable values to U-net', async () => {
    const recipient = x25519.keygen();
    const requests: Array<{ url: string; body: string }> = [];
    const fetchMock = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: String(init?.body ?? '') });
      if (url.endsWith('/resolve')) return new Response(JSON.stringify({
        success: true,
        recipientEncryptionPublicKey: Buffer.from(recipient.publicKey).toString('base64url'),
        automation: { automationId: 'auto_1', eventKey: 'order.approved', mode: 'create' },
        template: {
          templateId: 'tpl_1', version: 1, kind: 'standard', category: 'service', notificationTitle: 'Order update',
          variables: [{ key: 'status', type: 'text', required: true }],
          content: { title: 'Order {{status}}', body: 'Your order is {{status}}.' },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ success: true, messageId: 'msg_1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const client = createOfficialMessagingClient({ issuerBaseUrl: 'https://issuer.example', serviceId: 'demo-shop', automationKey: 'provider_secret', fetch: fetchMock as typeof fetch });
    await client.emitEvent({ eventKey: 'order.approved', scopedUserId: 'scoped_1', eventId: 'evt_random_123456', variables: { status: 'ready_for_pickup' } });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.body).not.toContain('ready_for_pickup');
    const dispatched = JSON.parse(requests[1]?.body ?? '{}');
    expect(dispatched.variableKeys).toEqual(['status']);
    expect(dispatched.encryptedPayload.ciphertext).toBeTypeOf('string');
  });

  it('rejects undeclared automation variables before dispatch', async () => {
    const recipient = x25519.keygen();
    const fetchMock = async () => new Response(JSON.stringify({
      success: true,
      recipientEncryptionPublicKey: Buffer.from(recipient.publicKey).toString('base64url'),
      automation: { automationId: 'auto_1', eventKey: 'order.approved', mode: 'create' },
      template: { templateId: 'tpl_1', version: 1, kind: 'standard', category: 'service', notificationTitle: 'Update', variables: [], content: { title: 'Update', body: 'Done' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const client = createOfficialMessagingClient({ issuerBaseUrl: 'https://issuer.example', serviceId: 'demo-shop', automationKey: 'provider_secret', fetch: fetchMock as typeof fetch });
    await expect(client.emitEvent({ eventKey: 'order.approved', scopedUserId: 'scoped_1', eventId: 'evt_random_123456', variables: { secret: 'must-not-leak' } })).rejects.toThrow('undeclared_automation_variable:secret');
  });
});
