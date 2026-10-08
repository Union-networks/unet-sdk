import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDirectIssuerService, InMemoryDirectIssuerRequestStore } from './directIssuer.js';
import { createDirectIssuerWebHandlers } from './webAdapters.js';
import type { DirectIssuerWebAdapterOptions } from './webAdapters.js';

const canary = 'DELIVERY_CAPABILITY_CANARY_MUST_NOT_LEAK';
const hashCapability = (value: string) => createHash('sha256').update(value).digest('hex');
const envelope = { version: 2, ciphertext: 'opaque-ciphertext' };
const input = { serviceAccountRef: 'test-account', checkId: 'test-check', holderBinding: 'binding',
  deliveryPublicKey: 'public-key', deliveryCapabilityHash: hashCapability(canary),
  holderRevocationSigner: `0x${'11'.repeat(20)}`, idempotencyKey: 'request-one' };
function fixture() {
  const store = new InMemoryDirectIssuerRequestStore();
  const service = createDirectIssuerService({ store, replacementModeFor: async () => 'parallel',
    buildCredential: async () => ({ attestationHash: 'a'.repeat(64), encryptedCredentialEnvelope: envelope }),
    anchorCredential: async () => ({ transactionHash: 'test-transaction', status: 'active' }),
    revokeReplacedCredential: async () => {},
  });
  return { store, service, handlers: createDirectIssuerWebHandlers({ service,
    authenticateAccount: async () => ({ serviceAccountRef: input.serviceAccountRef }), authorizeManagement: async () => true }) };
}
const request = (query: string, authorization?: string) => new Request(`https://issuer.test/delivery${query}`, {
  headers: authorization === undefined ? {} : { authorization },
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('direct issuer header-only delivery', () => {
  it('uses the actual same handler/service to deliver and acknowledge an opaque request ID', async () => {
    const { handlers, service, store } = fixture();
    const issued = await service.createRequest(input);
    const ready = await service.approve(issued.requestId);
    const opaqueId = 'opaque:/request?x=+&y';
    await store.create({ ...ready, requestId: opaqueId, idempotencyKey: 'opaque-request' });
    const url = new URL('https://issuer.test/delivery');
    url.searchParams.set('requestId', opaqueId);
    expect(url.href).not.toContain(canary);
    for (const scheme of ['Bearer', 'bearer']) {
      const response = await handlers.requestStatus(new Request(url, { headers: { authorization: `${scheme} ${canary}` } }));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ success: true, state: 'ready', attestationHash: 'a'.repeat(64), encryptedCredentialEnvelope: envelope });
    }
    const ack = await handlers.acknowledge(new Request('https://issuer.test/acknowledge', { method: 'POST',
      body: JSON.stringify({ requestId: opaqueId, deliveryCapability: canary, attestationHash: 'a'.repeat(64) }) }));
    expect(ack.status).toBe(200);
    const delivered = await handlers.requestStatus(new Request(url, { headers: { authorization: `Bearer ${canary}` } }));
    expect((await delivered.json()).state).toBe('delivered');
  });

  it.each(['deliveryCapability=', `deliveryCapability=${canary}`, `deliveryCapability=${canary}&deliveryCapability=second`,
    `delivery%43apability=${canary}`])('rejects query capabilities before service access: %s', async query => {
    const { service, handlers } = fixture();
    const get = vi.spyOn(service, 'getDelivery');
    const issued = await service.createRequest(input);
    for (const header of [undefined, `Bearer ${canary}`]) {
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
    const handlers = createDirectIssuerWebHandlers({ service, authenticateAccount: async () => undefined,
      authorizeManagement: async () => { throw new Error(canary); } });
    for (const handler of [handlers.approve, handlers.deny]) {
      const response = await handler(new Request('https://issuer.test/manage', { method: 'POST', body: '{}' }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ success: false, error: 'direct_issuer_request_failed' });
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
});

const post = (value: unknown, headers?: HeadersInit) => new Request('https://issuer.test/operation', {
  method: 'POST', headers, body: JSON.stringify(value),
});
const streamedRequest = (stream: ReadableStream<Uint8Array>) => new Request('https://issuer.test/operation', {
  method: 'POST', body: stream, duplex: 'half',
} as RequestInit & { duplex: 'half' });
async function expectFailure(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ success: false, error });
}

describe('authenticated direct issuer admission handlers', () => {
  it('derives the account from the callback and replays lost responses without disclosing the wallet secret', async () => {
    const { service, store } = fixture();
    const authenticateAccount = vi.fn(async (req: Request) => {
      expect(req.bodyUsed).toBe(false);
      expect(req.headers.get('cookie')).toBe('session=provider-session');
      return { serviceAccountRef: 'authenticated-account' };
    });
    const handlers = createDirectIssuerWebHandlers({ service, authenticateAccount, authorizeManagement: async () => false });
    const { serviceAccountRef: _account, ...walletInput } = input;
    const original = post(walletInput, { cookie: 'session=provider-session' });
    const first = await handlers.createRequest(original);
    expect(first.status).toBe(201);
    expect(first.headers.get('cache-control')).toBe('no-store');
    const firstBody = await first.json();
    expect(firstBody).toEqual({ success: true, requestId: expect.any(String), state: 'pending', replacementRequired: false });
    const retry = await handlers.createRequest(post(walletInput, { cookie: 'session=provider-session' }));
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(firstBody);
    expect(authenticateAccount).toHaveBeenNthCalledWith(1, original);
    expect(await store.list()).toHaveLength(1);
    const persisted = await store.get(firstBody.requestId);
    expect(persisted?.serviceAccountRef).toBe('authenticated-account');
    expect(persisted?.deliveryCapabilityHash).toBe(hashCapability(canary));
    expect(JSON.stringify([firstBody, persisted])).not.toContain(canary);
    await expectFailure(await handlers.createRequest(post({ ...walletInput, holderBinding: 'changed' },
      { cookie: 'session=provider-session' })), 409, 'issuer_request_idempotency_conflict');
  });

  it.each(['missing callback', 'no session', 'empty account', 'invalid account'] as const)('fails closed before body access: %s', async kind => {
    const { service, store } = fixture();
    const authenticateAccount = kind === 'missing callback' ? undefined
      : async () => kind === 'no session' ? undefined : { serviceAccountRef: kind === 'empty account' ? '  ' : 42 };
    const handlers = createDirectIssuerWebHandlers({ service, authenticateAccount,
      authorizeManagement: async () => true } as unknown as DirectIssuerWebAdapterOptions);
    const req = post(input);
    const read = vi.spyOn(req.body!, 'getReader');
    await expectFailure(await handlers.createRequest(req), 401, 'issuer_account_authorization_required');
    expect(read).not.toHaveBeenCalled();
    expect(req.bodyUsed).toBe(false);
    expect(await store.list()).toEqual([]);
  });

  it('rejects a caller-supplied cross-account reference before service admission', async () => {
    const { handlers, service, store } = fixture();
    const create = vi.spyOn(service, 'createRequest');
    await expectFailure(await handlers.createRequest(post({ ...input, serviceAccountRef: 'victim-account' })), 403, 'issuer_account_mismatch');
    expect(create).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([]);
  });

  it.each(['https://evil.test', undefined])('honors callback origin/CSRF rejection before body parsing: %s', async origin => {
    const { service, store } = fixture();
    const authenticateAccount = vi.fn(async (req: Request) => {
      if (req.headers.get('origin') !== 'https://wallet.test' || req.headers.get('x-csrf-token') !== 'session-csrf') return undefined;
      return { serviceAccountRef: input.serviceAccountRef };
    });
    const handlers = createDirectIssuerWebHandlers({ service, authenticateAccount, authorizeManagement: async () => true });
    const req = post(input, origin ? { origin, 'x-csrf-token': 'session-csrf' } : { origin: 'https://wallet.test' });
    const read = vi.spyOn(req.body!, 'getReader');
    await expectFailure(await handlers.createRequest(req), 401, 'issuer_account_authorization_required');
    expect(authenticateAccount).toHaveBeenCalledExactlyOnceWith(req);
    expect(read).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([]);
    expect((await handlers.createRequest(post(input, { origin: 'https://wallet.test', 'x-csrf-token': 'session-csrf' }))).status).toBe(201);
  });

  it.each([new Error(`origin_failed:${canary}`), new Error(`issuer_account_mismatch:${canary}`), canary])('sanitizes account callback failures %#', async error => {
    const { service, store } = fixture();
    const handlers = createDirectIssuerWebHandlers({ service, authenticateAccount: async () => { throw error; },
      authorizeManagement: async () => true });
    const req = post(input);
    const read = vi.spyOn(req.body!, 'getReader');
    await expectFailure(await handlers.createRequest(req), 503, 'direct_issuer_request_failed');
    expect(read).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([]);
  });

  it.each([
    [{ ...input, deliveryCapabilityHash: undefined }, 'issuer_request_invalid'],
    [{ ...input, deliveryCapabilityHash: canary }, 'issuer_request_invalid'],
    [{ ...input, deliveryCapability: canary }, 'issuer_request_invalid'],
    [{ ...input, holderRevocationSigner: `0x${'00'.repeat(20)}` }, 'holder_revocation_signer_invalid'],
    [{ ...input, consent: { text: 'yes', acceptedAtIso: 'not-a-date' } }, 'issuer_request_invalid'],
  ] as const)('returns finite service validation errors for malformed admission %#', async (value, code) => {
    const { handlers, store } = fixture();
    await expectFailure(await handlers.createRequest(post(value)), 400, code);
    expect(await store.list()).toEqual([]);
  });

  it('uses actual renewal handlers with wallet-held child capabilities and parent-bound replay', async () => {
    const { handlers, service, store } = fixture();
    const parent = await service.createRequest(input);
    const ready = await service.approve(parent.requestId);
    await service.acknowledgeDelivery(parent.requestId, canary, ready.attestationHash!);
    const childSecret = 'wallet-child-secret-not-returned';
    const renewal = { requestId: parent.requestId, deliveryCapability: canary, deliveryCapabilityHash: hashCapability(childSecret),
      holderBinding: 'child-holder', deliveryPublicKey: 'child-public-key', holderRevocationSigner: input.holderRevocationSigner, idempotencyKey: 'child' };
    await expectFailure(await handlers.renew(post({ ...renewal, deliveryCapability: 'wrong' })), 401, 'renewal_capability_invalid');
    await expectFailure(await handlers.renew(post({ ...renewal, deliveryCapabilityHash: input.deliveryCapabilityHash })), 400, 'issuer_renewal_invalid');
    const admitted = await handlers.renew(post(renewal));
    expect(admitted.status).toBe(201);
    const result = await admitted.json();
    expect(result).toEqual({ success: true, requestId: expect.any(String), state: 'pending', replacementRequired: true });
    expect((await store.get(result.requestId))?.renewalOfRequestId).toBe(parent.requestId);
    const replay = await handlers.renew(post(renewal));
    expect(await replay.json()).toEqual(result);
    expect(JSON.stringify(result)).not.toContain(childSecret);
    expect(JSON.stringify(result)).not.toContain(canary);
    await expectFailure(await handlers.renew(post({ ...renewal, holderBinding: 'changed' })), 409, 'issuer_request_idempotency_conflict');
  });
});

describe('bounded issuer request body reader', () => {
  const bodyHandlers = ['createRequest', 'acknowledge', 'renew', 'authorizeRevocation', 'approve', 'deny'] as const;
  it.each(bodyHandlers)('returns finite 400s for malformed JSON and non-object bodies in %s', async name => {
    const { handlers, store } = fixture();
    for (const raw of ['', '{', `{"secret":"${canary}",`, 'null', '[]', 'true', '42', '"string"']) {
      await expectFailure(await handlers[name](new Request('https://issuer.test/operation', { method: 'POST', body: raw })), 400, 'request_body_invalid');
    }
    await expectFailure(await handlers[name](new Request('https://issuer.test/operation', { method: 'POST' })), 400, 'request_body_invalid');
    expect(await store.list()).toEqual([]);
  });

  it.each(bodyHandlers)('rejects oversized bodies in %s before service work', async name => {
    const { handlers, store } = fixture();
    const raw = JSON.stringify({ ...input, padding: 'x'.repeat(65_536) });
    await expectFailure(await handlers[name](new Request('https://issuer.test/operation', { method: 'POST', body: raw })), 400, 'request_body_invalid');
    expect(await store.list()).toEqual([]);
  });

  it('accepts exactly 64KiB and rejects one additional byte independent of Content-Length', async () => {
    const { handlers, store } = fixture();
    const json = JSON.stringify(input);
    const raw = json + ' '.repeat(65_536 - Buffer.byteLength(json));
    const exact = await handlers.createRequest(new Request('https://issuer.test/operation', { method: 'POST', body: raw }));
    expect(exact.status).toBe(201);
    await expectFailure(await handlers.createRequest(new Request('https://issuer.test/operation', {
      method: 'POST', body: `${raw} `, headers: { 'content-length': '1' },
    })), 400, 'request_body_invalid');
    expect(await store.list()).toHaveLength(1);
  });

  it('counts streamed bytes cumulatively, including multi-byte UTF-8 content, and cancels oversized streams', async () => {
    const { handlers, store } = fixture();
    const cancel = vi.fn();
    const encoder = new TextEncoder();
    const chunk = encoder.encode('\u00e9'.repeat(16_384));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(chunk); controller.enqueue(chunk); controller.enqueue(encoder.encode(' ')); }, cancel,
    });
    await expectFailure(await handlers.createRequest(streamedRequest(stream)), 400, 'request_body_invalid');
    expect(cancel).toHaveBeenCalledOnce();
    expect(await store.list()).toEqual([]);
  });

  it.each([false, true])('enforces a 5s whole-stream deadline (partial progress: %s)', async partial => {
    vi.useFakeTimers();
    const { handlers, store } = fixture();
    const cancel = vi.fn();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel });
    let settled = false;
    const pending = handlers.createRequest(streamedRequest(stream)).then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(3_000);
    if (partial) controller.enqueue(new TextEncoder().encode('{"checkId":'));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expectFailure(await pending, 400, 'request_body_invalid');
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(await store.list()).toEqual([]);
  });

  it('sanitizes read failures and does not leak stream error messages', async () => {
    const { handlers, store } = fixture();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error(canary)); } });
    await expectFailure(await handlers.createRequest(streamedRequest(stream)), 400, 'request_body_invalid');
    expect(await store.list()).toEqual([]);
  });

  it('returns a finite body error when upstream middleware has locked the body', async () => {
    const { handlers, store } = fixture();
    const req = post(input);
    const reader = req.body!.getReader();
    try {
      await expectFailure(await handlers.createRequest(req), 400, 'request_body_invalid');
      expect(await store.list()).toEqual([]);
    } finally {
      reader.releaseLock();
    }
  });
});
