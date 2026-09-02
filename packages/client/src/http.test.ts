import { describe, expect, it } from 'vitest';
import { UnetApiError, UnetContractError, createUnetClient } from './index.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const service = {
  serviceId: 'svc', name: 'Service', provider: 'Provider', origin: 'https://svc.test', status: 'active',
  accountPolicy: { mode: 'single', maxAccounts: 1, policyVersion: 2 },
  endpoints: { challenge: 'https://svc.test/challenge', approval: 'https://svc.test/approval', status: 'https://svc.test/status', exchange: 'https://svc.test/exchange', retirement: 'https://svc.test/retirement' },
};

describe('UnetClient', () => {
  it('binds fetch safely and resolves verified services', async () => {
    const seen: string[] = [];
    const fetchImpl = function (this: unknown, input: string | URL | Request) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      seen.push(String(input));
      return Promise.resolve(jsonResponse({ success: true, registryRevision: 'rev-1', service }));
    } as typeof fetch;
    const client = createUnetClient({ controlPlaneUrl: 'https://control.test', fetchImpl });
    await expect(client.resolveService({ serviceId: 'svc', origin: 'https://svc.test' })).resolves.toMatchObject({ service: { serviceId: 'svc' } });
    expect(seen[0]).toBe('https://control.test/v2/services/resolve?serviceId=svc&origin=https%3A%2F%2Fsvc.test');
  });

  it('lists paginated verification checks and mini programs', async () => {
    const seen: string[] = [];
    const client = createUnetClient({
      controlPlaneUrl: 'https://control.test', verifierBaseUrl: 'https://verifier.test',
      fetchImpl: async (url) => {
        seen.push(String(url));
        if (String(url).includes('/v1/verification-checks')) return jsonResponse({ checks: [{ requestType: 'age_over_18' }], pageInfo: { limit: 1, hasNextPage: false } });
        return jsonResponse({ success: true, programs: [{ id: 'demo' }], pageInfo: { limit: 1, hasNextPage: false } });
      },
    });
    await expect(client.listVerificationChecks({ limit: 1 })).resolves.toMatchObject({ checks: [{ requestType: 'age_over_18' }] });
    await expect(client.listMiniPrograms({ limit: 1 })).resolves.toMatchObject({ programs: [{ id: 'demo' }] });
    expect(seen).toContain('https://control.test/v1/mini-programs?limit=1');
  });

  it('iterates verification check pages', async () => {
    const client = createUnetClient({ fetchImpl: async (url) => {
      const second = String(url).includes('cursor=1');
      return jsonResponse({ checks: [{ requestType: second ? 'citizen' : 'age' }], pageInfo: { limit: 1, hasNextPage: !second, ...(second ? {} : { nextCursor: '1' }) } });
    } });
    const checks: string[] = [];
    for await (const check of client.iterateVerificationChecks({ limit: 1 })) checks.push(check.requestType);
    expect(checks).toEqual(['age', 'citizen']);
  });

  it('throws API and contract errors', async () => {
    const api = createUnetClient({ fetchImpl: async () => jsonResponse({ errorCode: 'bad_request', message: 'nope' }, 400) });
    await expect(api.resolveService({ serviceId: 'svc', origin: 'https://svc.test' })).rejects.toBeInstanceOf(UnetApiError);
    const contract = createUnetClient({ fetchImpl: async () => jsonResponse({ success: true }) });
    await expect(contract.resolveService({ serviceId: 'svc', origin: 'https://svc.test' })).rejects.toBeInstanceOf(UnetContractError);
  });
});
