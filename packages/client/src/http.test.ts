import { describe, expect, it } from 'vitest';
import { UnetApiError, UnetContractError, createUnetClient } from './index.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('UnetClient', () => {
  it('binds fetch safely for browser runtimes', async () => {
    const fetchImpl = function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return jsonResponse({ sessionId: 's1', requestRef: 'r1', serviceId: 'svc', origin: 'https://svc.test', status: 'pending' });
    } as typeof fetch;
    const client = createUnetClient({ issuerBaseUrl: 'https://issuer.test', fetchImpl });
    await expect(client.createLoginSession({ serviceId: 'svc', origin: 'https://svc.test' })).resolves.toMatchObject({ sessionId: 's1' });
  });

  it('creates and polls a login session', async () => {
    const fetchImpl = async () =>
      jsonResponse({
        success: true,
        sessionId: 's1',
        requestRef: 'r1',
        serviceId: 'svc',
        origin: 'https://example.test',
        status: 'approved',
        scopedUserId: 'm_svc_1',
        assertionJws: 'jwt',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 1000).toISOString(),
      });
    const client = createUnetClient({ issuerBaseUrl: 'https://issuer.test', fetchImpl });
    await expect(client.getLoginSession('s1')).resolves.toMatchObject({ status: 'approved', scopedUserId: 'm_svc_1' });
  });

  it('resolves services and creates miniapp service sessions', async () => {
    const seen: Array<{ url: string; body?: string }> = [];
    const client = createUnetClient({
      issuerBaseUrl: 'https://issuer.test',
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), body: typeof init?.body === 'string' ? init.body : undefined });
        if (String(url).includes('/v1/web-login/services/resolve')) {
          return jsonResponse({ success: true, service: { serviceId: 'svc', name: 'Service', provider: 'Provider', origin: 'https://svc.test', redirectUrl: 'https://svc.test', icon: 'app', scopes: ['identity.scoped'], status: 'active' } });
        }
        return jsonResponse({ success: true, serviceId: 'svc', scopedUserId: 'm_svc_1', sessionId: 'minisess_1', assertionJws: 'jwt', expiresAtIso: 'later' });
      },
    });
    await expect(client.resolveWebLoginService({ serviceId: 'svc', origin: 'https://svc.test' })).resolves.toMatchObject({ service: { serviceId: 'svc' } });
    await expect(client.createServiceSession({ serviceId: 'svc', origin: 'https://svc.test', scopedUserId: 'm_svc_1', proofJws: 'proof' })).resolves.toMatchObject({ assertionJws: 'jwt' });
    expect(seen[0]?.url).toBe('https://issuer.test/v1/web-login/services/resolve?serviceId=svc&origin=https%3A%2F%2Fsvc.test');
    expect(seen[1]?.body).toContain('proof');
  });

  it('lists paginated verification checks and mini programs', async () => {
    const seen: string[] = [];
    const client = createUnetClient({
      issuerBaseUrl: 'https://issuer.test',
      verifierBaseUrl: 'https://verifier.test',
      fetchImpl: async (url) => {
        seen.push(String(url));
        if (String(url).includes('/v1/verification-checks')) {
          return jsonResponse({ checks: [{ requestType: 'age_over_18', label: 'Over 18' }], pageInfo: { limit: 1, hasNextPage: false, totalCount: 1 } });
        }
        return jsonResponse({
          success: true,
          programs: [{ id: 'demo', name: 'Demo', provider: 'Provider', description: '', category: 'Test', status: 'MVP', icon: 'apps', origin: 'https://issuer.test', launchUrl: 'https://issuer.test/demo', permissions: ['identity.scoped'] }],
          pageInfo: { limit: 1, hasNextPage: false, totalCount: 1 },
        });
      },
    });
    await expect(client.listVerificationChecks({ limit: 1, query: 'age' })).resolves.toMatchObject({ checks: [{ requestType: 'age_over_18' }] });
    await expect(client.listMiniPrograms({ limit: 1, query: 'demo' })).resolves.toMatchObject({ programs: [{ id: 'demo' }] });
    expect(seen.some((url) => url === 'https://verifier.test/v1/verification-checks?limit=1&query=age')).toBe(true);
    expect(seen.some((url) => url === 'https://issuer.test/v1/mini-programs?limit=1&query=demo')).toBe(true);
  });

  it('iterates verification check pages', async () => {
    const client = createUnetClient({
      verifierBaseUrl: 'https://verifier.test',
      fetchImpl: async (url) => {
        const isSecond = String(url).includes('cursor=1');
        return jsonResponse({
          checks: [{ requestType: isSecond ? 'dutch_citizen' : 'age_over_18' }],
          pageInfo: { limit: 1, hasNextPage: !isSecond, ...(isSecond ? {} : { nextCursor: '1' }), totalCount: 2 },
        });
      },
    });
    const checks: string[] = [];
    for await (const check of client.iterateVerificationChecks({ limit: 1 })) checks.push(check.requestType);
    expect(checks).toEqual(['age_over_18', 'dutch_citizen']);
  });

  it('throws API errors', async () => {
    const client = createUnetClient({ fetchImpl: async () => jsonResponse({ success: false, errorCode: 'bad_request', message: 'nope' }, 400) });
    await expect(client.getLoginSession('missing')).rejects.toBeInstanceOf(UnetApiError);
  });

  it('throws contract errors for malformed success payloads', async () => {
    const client = createUnetClient({ fetchImpl: async () => jsonResponse({ success: true }) });
    await expect(client.getLoginSession('bad')).rejects.toBeInstanceOf(UnetContractError);
  });
});
