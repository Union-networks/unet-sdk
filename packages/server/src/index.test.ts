import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createUnetMiniappManifest, createUnetProviderClaim, createUnetProviderClaimHandler, verifyLoginAssertion } from './index.js';

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
});
