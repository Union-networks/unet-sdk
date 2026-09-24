import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDirectIssuerService, InMemoryDirectIssuerRequestStore } from './directIssuer.js';
import { createDirectIssuerWebHandlers } from './webAdapters.js';

const canary = 'DELIVERY_CAPABILITY_CANARY_MUST_NOT_LEAK';
const envelope = { version: 2, ciphertext: 'opaque-ciphertext' };
const input = { serviceAccountRef: 'test-account', checkId: 'test-check', holderBinding: 'binding',
  deliveryPublicKey: 'public-key', holderRevocationSigner: `0x${'11'.repeat(20)}`, idempotencyKey: 'request-one' };
function fixture() {
  const store = new InMemoryDirectIssuerRequestStore();
  const service = createDirectIssuerService({ store, replacementModeFor: async () => 'parallel',
    buildCredential: async () => ({ attestationHash: 'a'.repeat(64), encryptedCredentialEnvelope: envelope }),
    anchorCredential: async () => ({ transactionHash: 'test-transaction', status: 'active' }),
    revokeReplacedCredential: async () => {},
  });
  return { store, service, handlers: createDirectIssuerWebHandlers({ service, authorizeManagement: async () => true }) };
}
const request = (query: string, authorization?: string) => new Request(`https://issuer.test/delivery${query}`, {
  headers: authorization === undefined ? {} : { authorization },
});

afterEach(() => vi.restoreAllMocks());
describe('direct issuer header-only delivery', () => {
  it('uses the actual same handler/service to deliver and acknowledge an opaque request ID', async () => {
    const { handlers, service, store } = fixture();
    const issued = await service.createRequest(input);
    const ready = await service.approve(issued.requestId);
    const opaqueId = 'opaque:/request?x=+&y';
    await store.create({ ...ready, requestId: opaqueId });
    const url = new URL('https://issuer.test/delivery');
    url.searchParams.set('requestId', opaqueId);
    expect(url.href).not.toContain(issued.deliveryCapability);
    for (const scheme of ['Bearer', 'bearer']) {
      const response = await handlers.requestStatus(new Request(url, { headers: { authorization: `${scheme} ${issued.deliveryCapability}` } }));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ success: true, state: 'ready', attestationHash: 'a'.repeat(64), encryptedCredentialEnvelope: envelope });
    }
    const ack = await handlers.acknowledge(new Request('https://issuer.test/acknowledge', { method: 'POST',
      body: JSON.stringify({ requestId: opaqueId, deliveryCapability: issued.deliveryCapability, attestationHash: 'a'.repeat(64) }) }));
    expect(ack.status).toBe(200);
    const delivered = await handlers.requestStatus(new Request(url, { headers: { authorization: `Bearer ${issued.deliveryCapability}` } }));
    expect((await delivered.json()).state).toBe('delivered');
  });

  it.each(['deliveryCapability=', `deliveryCapability=${canary}`, `deliveryCapability=${canary}&deliveryCapability=second`,
    `delivery%43apability=${canary}`])('rejects query capabilities before service access: %s', async query => {
    const { service, handlers } = fixture();
    const get = vi.spyOn(service, 'getDelivery');
    const issued = await service.createRequest(input);
    for (const header of [undefined, `Bearer ${issued.deliveryCapability}`]) {
      const response = await handlers.requestStatus(request(`?requestId=${issued.requestId}&${query}`, header));
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ success: false, error: 'delivery_capability_invalid' });
    }
    expect(get).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'Bearer', 'Basic secret', canary, `Bearer  ${canary}`, `Bearer\t${canary}`,
    `Bearer ${canary} extra`, `Bearer ${canary},Bearer other`, `Bearer ${canary}?query`])('rejects missing/malformed authorization %#', async auth => {
    const { handlers, service } = fixture();
    const get = vi.spyOn(service, 'getDelivery');
    const response = await handlers.requestStatus(request('?requestId=opaque', auth));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: 'delivery_capability_invalid' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(get).not.toHaveBeenCalled();
  });

  it.each(['', '?requestId=', '?requestId=a&requestId=b'])('rejects absent/ambiguous request IDs: %s', async query => {
    const { handlers, service } = fixture();
    const get = vi.spyOn(service, 'getDelivery');
    const response = await handlers.requestStatus(request(query, `Bearer ${canary}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'delivery_reference_required' });
    expect(get).not.toHaveBeenCalled();
  });

  it('retains exact service errors, but never regex-classifies or echoes arbitrary exceptions in any handler', async () => {
    const { handlers, service } = fixture();
    const logs = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')].map(spy => spy.mockImplementation(() => {}));
    const operations = [
      ['createRequest', 'createRequest', input], ['requestStatus', 'getDelivery', {}],
      ['acknowledge', 'acknowledgeDelivery', { requestId: 'opaque', deliveryCapability: canary, attestationHash: 'a'.repeat(64) }],
      ['renew', 'createRenewalRequest', {}],
      ['authorizeRevocation', 'authorizeRevocation', { requestId: 'opaque', deliveryCapability: canary, attestationHash: 'a'.repeat(64) }],
      ['approve', 'approve', { requestId: 'opaque' }], ['deny', 'deny', { requestId: 'opaque' }],
    ] as const;
    for (const [handler, method, body] of operations) {
      for (const error of [new Error(`delivery_capability_invalid:${canary}`), new Error(`https://issuer.test/?deliveryCapability=${canary}`),
        new Error(`authorization_unavailable_${canary}`), new Error('toString'), canary]) {
        const mock = vi.spyOn(service, method).mockRejectedValueOnce(error);
        const req = handler === 'requestStatus' ? request('?requestId=opaque', `Bearer ${canary}`)
          : new Request('https://issuer.test/operation', { method: 'POST', body: JSON.stringify(body) });
        const response = await handlers[handler](req);
        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({ success: false, error: 'direct_issuer_request_failed' });
        mock.mockRestore();
      }
    }
    for (const log of logs) expect(log).not.toHaveBeenCalled();
    const bad = await handlers.requestStatus(request('?requestId=missing', `Bearer ${canary}`));
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ success: false, error: 'delivery_capability_invalid' });
  });

  it('sanitizes management authorizer exceptions through the same shared helper', async () => {
    const { service } = fixture();
    const handlers = createDirectIssuerWebHandlers({ service, authorizeManagement: async () => { throw new Error(canary); } });
    for (const handler of [handlers.approve, handlers.deny]) {
      const response = await handler(new Request('https://issuer.test/manage', { method: 'POST', body: '{}' }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ success: false, error: 'direct_issuer_request_failed' });
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
});
