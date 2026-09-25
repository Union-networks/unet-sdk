import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimRecoveryRecord, createRecoveryRecord, recoveryDigest, transitionRecoveryRecord,
  validateRecoveryRecord, type RecoveryRecord,
} from './issuanceRecovery.js';
import { reconcileRecoveryAnchor } from './issuanceRecoveryLedger.js';
import { ledgerV2IssuerIdHash, ledgerV2RequestHash } from './ledgerV2.js';

const URL_BASE = 'https://ledger.example/gateway/';
const NOW = 1_000_000;
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const address = (digit: string) => `0x${digit.repeat(40)}`;
const encoded = (length: number) => Buffer.alloc(length, 1).toString('base64url');
const unavailable = { kind: 'unavailable' };
const pending = { success: true, protocolVersion: 2, status: 'pending', reason: 'receipt_pending' };
const revoked = { success: false, error: 'ledger_v2_attestation_revoked' };

function submitted(): RecoveryRecord {
  let record = claimRecoveryRecord(createRecoveryRecord({
    request: {
      requestId: 'request-1', serviceAccountRef: 'account-1', checkId: 'age-check',
      holderBinding: 'holder-private', deliveryPublicKey: 'delivery-private',
      holderRevocationSigner: address('A'), idempotencyKey: 'idempotency-private',
      deliveryCapabilityHash: 'b'.repeat(64), state: 'pending', claims: { age: 21 },
      consent: { text: 'Consent private', acceptedAtIso: '2026-09-25T00:00:00.000Z' },
      createdAtIso: '2026-09-25T00:00:00.000Z', updatedAtIso: '2026-09-25T00:00:00.000Z',
    },
    context: {
      chainId: 31337, ledgerAddress: address('D'), issuerId: 'issuer-1',
      issuerIdHash: ledgerV2IssuerIdHash('issuer-1'), issuerKeyEpoch: 2, requiredConfirmations: 2,
      credentialKeyId: 'credential-private', credentialKeyFingerprint: hash('e'),
      validFromEpoch: 0, validUntilEpoch: 2_000_000,
    },
  }, NOW), 'owner', NOW)!;
  record = transitionRecoveryRecord(record, 'owner', record.revision, { kind: 'prepare', preparation: {
    attestationHash: 'f'.repeat(64), encryptedCredentialEnvelope: {
      version: 2, algorithm: 'x25519-xchacha20poly1305',
      senderPublicKey: encoded(32), nonce: encoded(24), ciphertext: encoded(48),
    },
  } }, NOW);
  return transitionRecoveryRecord(record, 'owner', record.revision, { kind: 'submit', submission: {
    operation: {
      attestationHash: hash('f'), issuerIdHash: record.input.context.issuerIdHash,
      holderRevocationSigner: address('A'), requestIdHash: ledgerV2RequestHash(record.requestId),
      issuerKeyEpoch: 2, nonce: '17', deadline: 2_000,
    },
    // Synthetic signature tests exact replay/binding, not cryptographic verification.
    signature: `0x${'AB'.repeat(64)}1B`,
  } }, NOW);
}

function confirmed(record = submitted()) {
  return { success: true, protocolVersion: 2, status: 'confirmed', receipt: {
    chainId: record.input.context.chainId, ledgerAddress: record.input.context.ledgerAddress.toLowerCase(),
    attestationHash: record.submission!.operation.attestationHash, issuerIdHash: record.input.context.issuerIdHash,
    transactionHash: hash('1'), blockHash: hash('2'), blockNumber: 40,
    confirmations: 3, requiredConfirmations: 2, checkedHeadHash: hash('3'), checkedHeadNumber: 42, status: 'active',
  } };
}

function json(payload: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': contentType } });
}

function fetchResponse(response: Response) {
  return vi.fn<typeof fetch>().mockResolvedValue(response);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

beforeEach(() => {
  // All requests in this suite are synthetic; never fall through to real fetch.
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('unexpected network')));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('private recovery gateway binding', () => {
  it('posts only the exact durable submission and builds a valid private receipt without a candidate', async () => {
    const record = freezeDeep(submitted());
    const before = structuredClone(record);
    const response = json(confirmed(record));
    const fetcher = fetchResponse(response);
    const result = await reconcileRecoveryAnchor(record, URL_BASE, { fetch: fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://ledger.example/gateway/v2/operations/anchor/reconcile');
    expect(init).toEqual({
      method: 'POST', headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      cache: 'no-store', credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal),
      body: JSON.stringify({
        chainId: record.input.context.chainId, ledgerAddress: record.input.context.ledgerAddress,
        requiredConfirmations: 2, operation: record.submission!.operation, signature: record.submission!.signature,
      }),
    });
    expect(result).toEqual({ kind: 'confirmed', receipt: {
      chainId: 31337, ledgerAddress: address('d'), attestationHash: hash('f'),
      issuerIdHash: record.input.context.issuerIdHash, holderRevocationSigner: address('A'),
      requestIdHash: ledgerV2RequestHash(record.requestId), submissionDigest: recoveryDigest(record.submission),
      transactionHash: hash('1'), blockHash: hash('2'), blockNumber: 40, confirmations: 3,
    } });
    if (result.kind !== 'confirmed') throw new Error('expected confirmation');
    const next = transitionRecoveryRecord(record, 'owner', record.revision, { kind: 'confirm', receipt: result.receipt }, NOW);
    expect(() => validateRecoveryRecord(next)).not.toThrow();
    expect(record).toEqual(before);
    expect(response.body!.locked).toBe(false);
  });

  it('uses global fetch when no override is supplied', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(json(pending, 202));
    expect(await reconcileRecoveryAnchor(submitted(), 'https://ledger.example')).toEqual({ kind: 'pending' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the pre-await snapshot when the caller mutates every binding during fetch', async () => {
    const record = submitted();
    const before = structuredClone(record);
    const waiting = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(waiting.promise);
    const result = reconcileRecoveryAnchor(record, URL_BASE, { fetch: fetcher });
    record.input.context.chainId++;
    record.input.context.ledgerAddress = address('1');
    record.input.context.requiredConfirmations = 99;
    record.input.request.requestId = 'changed';
    record.preparation!.attestationHash = 'a'.repeat(64);
    Object.assign(record.submission!.operation, {
      attestationHash: hash('a'), issuerIdHash: hash('b'), holderRevocationSigner: address('1'),
      requestIdHash: hash('c'), nonce: '999', deadline: 9_999, issuerKeyEpoch: 99,
    });
    record.submission!.signature = `0x${'12'.repeat(64)}1c`;
    record.phase = 'blocked';
    waiting.resolve(json(confirmed(before)));
    expect(await result).toMatchObject({ kind: 'confirmed', receipt: {
      chainId: before.input.context.chainId, holderRevocationSigner: address('A'),
      requestIdHash: before.submission!.operation.requestIdHash, submissionDigest: recoveryDigest(before.submission),
    } });
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).operation).toEqual(before.submission!.operation);
    expect(record.phase).toBe('blocked');
  });

  it('rejects a response matching a post-start mutation instead of the snapshot', async () => {
    const record = submitted();
    const waiting = deferred<Response>();
    const result = reconcileRecoveryAnchor(record, URL_BASE, { fetch: vi.fn<typeof fetch>().mockReturnValue(waiting.promise) });
    record.submission!.operation.attestationHash = hash('a');
    waiting.resolve(json(confirmed(record)));
    expect(await result).toEqual(unavailable);
  });

  it.each(['reserved', 'prepared', 'confirmed', 'completed', 'blocked'] as const)('never fetches in phase %s', async phase => {
    const record = submitted();
    record.phase = phase;
    expect(await reconcileRecoveryAnchor(record, URL_BASE)).toEqual(unavailable);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  const invalidRecords: [string, (record: RecoveryRecord) => void][] = [
    ['preparation missing', record => { delete record.preparation; }],
    ['submission missing', record => { delete record.submission; }],
    ['input digest stale', record => { record.input.context.chainId++; }],
    ['preparation binding', record => { record.preparation!.attestationHash = 'a'.repeat(64); }],
    ['request binding', record => { record.submission!.operation.requestIdHash = hash('a'); }],
    ['holder binding', record => { record.submission!.operation.holderRevocationSigner = address('b'); }],
    ['epoch binding', record => { record.submission!.operation.issuerKeyEpoch++; }],
    ['bad signature', record => { record.submission!.signature = 'private-invalid'; }],
    ['array signature', record => { Reflect.set(record.submission!, 'signature', [record.submission!.signature]); }],
    ['bad nonce', record => { record.submission!.operation.nonce = '01'; }],
    ['extra field', record => { Reflect.set(record, 'privateKey', 'private'); }],
    ['clone error', record => { Reflect.set(record, 'privateKey', () => 'private'); }],
  ];
  it.each(invalidRecords)('validates the snapshot before fetching: %s', async (_name, mutate) => {
    const record = submitted();
    mutate(record);
    expect(await reconcileRecoveryAnchor(record, URL_BASE)).toEqual(unavailable);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    'http://ledger.example', 'https://user:password@ledger.example', 'https://user@ledger.example',
    'https://@ledger.example', 'https://ledger.example?secret', 'https://ledger.example#secret',
    'https://ledger.example?', 'https://ledger.example#', '/relative', 'file:///private', 'not a URL',
  ])('rejects unsafe endpoint %s without fetching', async base => {
    expect(await reconcileRecoveryAnchor(submitted(), base)).toEqual(unavailable);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('strict reconciliation evidence', () => {
  it.each(['receipt_pending', 'insufficient_confirmations', 'reorg_detected'])('recognizes 202 reason %s', async reason => {
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, {
      fetch: fetchResponse(json({ ...pending, reason }, 202)),
    })).toEqual({ kind: 'pending' });
  });

  it('recognizes only the request-specific gateway revocation error', async () => {
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetchResponse(json(revoked, 409)) }))
      .toEqual({ kind: 'revoked' });
  });

  it.each([
    [200, pending], [409, pending], [200, revoked], [202, revoked], [503, revoked],
    [202, confirmed()], [409, confirmed()], [201, confirmed()], [500, confirmed()],
    [200, { success: true, result: { protocolVersion: 2, attestationHash: hash('f'), status: 'active' } }],
    [200, { success: true, protocolVersion: 2, status: 'active' }],
    [200, { ...confirmed(), success: 'true' }], [200, { ...confirmed(), protocolVersion: '2' }],
    [200, { ...confirmed(), protocolVersion: 1 }], [200, { ...confirmed(), status: 'active' }],
    [200, null], [200, []], [200, 'active'], [200, {}],
    [202, { ...pending, success: false }], [202, { ...pending, protocolVersion: '2' }],
    [202, { ...pending, status: 'confirmed' }], [202, { ...pending, reason: ['receipt_pending'] }],
    [202, { ...pending, reason: 'unknown' }], [202, { ...pending, reason: undefined }],
    [409, { ...revoked, success: true }], [409, { ...revoked, success: 'false' }],
    [409, { ...revoked, error: 'ledger_v2_anchor_transaction_failed' }],
    [409, { ...revoked, error: 'ledger_v2_anchor_evidence_mismatch' }],
    [409, { ...revoked, error: ['ledger_v2_attestation_revoked'] }],
    [409, { ...revoked, error: 'ledger_v2_attestation_revoked ' }],
    [409, { success: false, error: 'SQL SELECT * FROM private_claims: password=private' }],
  ])('fails closed for HTTP %s with malformed or unrelated evidence (%#)', async (status, payload) => {
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetchResponse(json(payload, status as number)) }))
      .toEqual(unavailable);
  });

  const privateFields = ['holderRevocationSigner', 'requestIdHash', 'submissionDigest', 'operation', 'signature',
    'claims', 'deliveryCapability', 'encryptedCredentialEnvelope', 'sql', 'stack', 'unknown', '__proto__'];
  it.each(privateFields)('rejects unexpected/private response field %s at every level', async field => {
    for (const [status, payload] of [[200, confirmed()], [202, pending], [409, revoked]] as const) {
      expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, {
        fetch: fetchResponse(json({ ...payload, [field]: 'private' }, status)),
      })).toEqual(unavailable);
    }
    const payload = confirmed();
    Reflect.set(payload.receipt, field, 'private');
    // Define an own __proto__ key as JSON.parse would, instead of changing the prototype.
    if (field === '__proto__') Object.defineProperty(payload.receipt, field, { value: 'private', enumerable: true });
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetchResponse(json(payload)) })).toEqual(unavailable);
  });

  it.each(Object.keys(confirmed().receipt))('requires receipt field %s and rejects nonscalar echoes', async field => {
    for (const value of [undefined, null, [], [Reflect.get(confirmed().receipt, field)], {}]) {
      const payload = confirmed();
      Reflect.set(payload.receipt, field, value);
      expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetchResponse(json(payload)) })).toEqual(unavailable);
    }
  });

  it.each([
    ['chainId', 1], ['chainId', '31337'], ['ledgerAddress', address('a')], ['ledgerAddress', 'bad'],
    ['attestationHash', hash('a')], ['attestationHash', 'f'.repeat(64)], ['issuerIdHash', hash('b')],
    ['transactionHash', 'bad'], ['transactionHash', hash('A')], ['blockHash', '2'.repeat(64)],
    ['checkedHeadHash', '0x123'], ['blockNumber', -1], ['blockNumber', 40.5], ['blockNumber', '40'],
    ['blockNumber', Number.MAX_SAFE_INTEGER + 1], ['checkedHeadNumber', 39], ['checkedHeadNumber', '42'],
    ['checkedHeadNumber', 42.5], ['checkedHeadNumber', Number.MAX_SAFE_INTEGER + 1],
    ['confirmations', 0], ['confirmations', 2], ['confirmations', 4], ['confirmations', '3'],
    ['confirmations', Number.MAX_SAFE_INTEGER + 1], ['requiredConfirmations', 0],
    ['requiredConfirmations', 1], ['requiredConfirmations', 4], ['requiredConfirmations', '2'],
    ['requiredConfirmations', 2.5], ['requiredConfirmations', Number.MAX_SAFE_INTEGER + 1],
    ['status', 'revoked'], ['status', 'unknown'], ['status', true],
  ])('rejects wrong binding or invalid scalar %s=%s', async (field, value) => {
    const payload = confirmed();
    Reflect.set(payload.receipt, field, value);
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetchResponse(json(payload)) })).toEqual(unavailable);
  });

  it('accepts a stronger gateway confirmation floor but not insufficient evidence for it', async () => {
    const payload = confirmed();
    payload.receipt.requiredConfirmations = 3;
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetchResponse(json(payload)) }))
      .toMatchObject({ kind: 'confirmed' });
    payload.receipt.requiredConfirmations = 4;
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetchResponse(json(payload)) })).toEqual(unavailable);
  });

  it('checks same-height head hashes and accepts block zero with one confirmation', async () => {
    const record = submitted();
    record.input.context.requiredConfirmations = 1;
    record.inputDigest = recoveryDigest(record.input);
    const payload = confirmed(record);
    Object.assign(payload.receipt, { blockNumber: 0, checkedHeadNumber: 0, confirmations: 1, requiredConfirmations: 1 });
    expect(await reconcileRecoveryAnchor(record, URL_BASE, { fetch: fetchResponse(json(payload)) })).toEqual(unavailable);
    payload.receipt.checkedHeadHash = payload.receipt.blockHash;
    expect(await reconcileRecoveryAnchor(record, URL_BASE, { fetch: fetchResponse(json(payload)) }))
      .toMatchObject({ kind: 'confirmed', receipt: { blockNumber: 0, confirmations: 1 } });
  });

  it('rejects confirmation arithmetic overflowing the safe integer range', async () => {
    const payload = confirmed();
    Object.assign(payload.receipt, { blockNumber: 0, checkedHeadNumber: Number.MAX_SAFE_INTEGER,
      confirmations: Number.MAX_SAFE_INTEGER });
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetchResponse(json(payload)) })).toEqual(unavailable);
  });
});

describe('bounded, privacy-safe transport', () => {
  it.each(['text/plain', 'application/problem+json', 'application/jsonp', 'text/html', ''])('rejects content type %s', async type => {
    const response = json(confirmed(), 200, type);
    const cancel = vi.spyOn(response.body!, 'cancel');
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetchResponse(response) })).toEqual(unavailable);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.body!.locked).toBe(false);
  });

  it('accepts application/json with UTF-8 parameters', async () => {
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, {
      fetch: fetchResponse(json(pending, 202, 'Application/JSON; charset=utf-8')),
    })).toEqual({ kind: 'pending' });
  });

  it.each([301, 302, 307, 308, 400, 401, 404, 429, 500, 503])('cancels HTTP %s without trusting its body', async status => {
    const response = json(confirmed(), status);
    const cancel = vi.spyOn(response.body!, 'cancel');
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetchResponse(response) })).toEqual(unavailable);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects a followed redirect even if an injected fetch ignores redirect:error', async () => {
    const response = json(confirmed());
    Object.defineProperty(response, 'redirected', { value: true });
    const cancel = vi.spyOn(response.body!, 'cancel');
    const fetcher = fetchResponse(response);
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetcher })).toEqual(unavailable);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(['{', '', '{"success":true} trailing', '<html>SQL private</html>'])('rejects malformed JSON (%#)', async body => {
    const response = new Response(body, { headers: { 'content-type': 'application/json' } });
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetchResponse(response) })).toEqual(unavailable);
    expect(response.body!.locked).toBe(false);
  });

  it('rejects invalid UTF-8 instead of replacement-decoding it into otherwise valid JSON', async () => {
    const bytes = Buffer.concat([Buffer.from(JSON.stringify(confirmed()) + ' '), Buffer.from([0xff])]);
    const response = new Response(bytes, { headers: { 'content-type': 'application/json' } });
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetchResponse(response) })).toEqual(unavailable);
    expect(response.body!.locked).toBe(false);
  });

  it('rejects a missing body', async () => {
    const response = new Response(null, { headers: { 'content-type': 'application/json' } });
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetchResponse(response) })).toEqual(unavailable);
  });

  it.each([65_536, 65_537])('enforces the 64 KiB cumulative body boundary (%s bytes)', async size => {
    const bytes = new TextEncoder().encode(JSON.stringify(pending).padEnd(size, ' '));
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (let i = 0; i < bytes.length; i += 997) controller.enqueue(bytes.slice(i, i + 997));
      controller.close();
    } });
    const response = new Response(stream, { status: 202, headers: {
      'content-type': 'application/json', 'content-length': '1',
    } });
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetchResponse(response) }))
      .toEqual(size === 65_536 ? { kind: 'pending' } : unavailable);
    expect(stream.locked).toBe(false);
  });

  it('cancels oversized streams without waiting for their end or cancellation promise', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(65_537)); }, cancel,
    });
    const response = new Response(stream, { headers: { 'content-type': 'application/json' } });
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetchResponse(response) })).toEqual(unavailable);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  it('returns only unavailable for raw fetch/body errors, with no logs', async () => {
    const logs = ['log', 'warn', 'error', 'info', 'debug'].map(method =>
      vi.spyOn(console, method as 'log').mockImplementation(() => undefined));
    const raw = new Error('SQL SELECT private_claims password=private');
    const fetchers = [
      vi.fn<typeof fetch>().mockRejectedValue(raw),
      vi.fn<typeof fetch>().mockImplementation(() => { throw raw; }),
      fetchResponse(new Response(new ReadableStream({ start(controller) { controller.error(raw); } }), {
        headers: { 'content-type': 'application/json' },
      })),
      fetchResponse(json({ success: false, error: raw.message, stack: raw.stack }, 409)),
    ];
    for (const fetcher of fetchers) {
      expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetcher })).toEqual(unavailable);
    }
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});

describe('whole-request deadlines and cancellation cleanup', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }); });

  it('does not call fetch for an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort(new Error('private reason'));
    expect(await reconcileRecoveryAnchor(submitted(), URL_BASE, { signal: controller.signal })).toEqual(unavailable);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['deadline', 'abort'] as const)('races stalled headers, even with ignored abort: %s', async mode => {
    const waiting = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(waiting.promise);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const result = reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetcher, signal: controller.signal });
    if (mode === 'deadline') await vi.advanceTimersByTimeAsync(10_000);
    else controller.abort(new Error('private cancellation'));
    expect(await result).toEqual(unavailable);
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    // Late responses cannot leak an unread body, even when cancellation rejects.
    const cancel = vi.fn().mockRejectedValue(new Error('private cancel error'));
    const stream = new ReadableStream<Uint8Array>({ cancel });
    waiting.resolve(new Response(stream, { headers: { 'content-type': 'application/json' } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  it('observes a late fetch rejection after returning unavailable', async () => {
    const waiting = deferred<Response>();
    const result = reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: vi.fn<typeof fetch>().mockReturnValue(waiting.promise) });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toEqual(unavailable);
    waiting.reject(new Error('late private network failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['deadline', 'abort'] as const)('races stalled bodies and releases the read lock: %s', async mode => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const response = new Response(stream, { headers: { 'content-type': 'application/json' } });
    const controller = new AbortController();
    const result = reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetchResponse(response), signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(stream.locked).toBe(true);
    if (mode === 'deadline') await vi.advanceTimersByTimeAsync(10_000);
    else controller.abort();
    expect(await result).toEqual(unavailable);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares one 10-second budget between headers and body', async () => {
    const waiting = deferred<Response>();
    const stream = new ReadableStream<Uint8Array>();
    const result = reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: vi.fn<typeof fetch>().mockReturnValue(waiting.promise) });
    await vi.advanceTimersByTimeAsync(9_000);
    waiting.resolve(new Response(stream, { headers: { 'content-type': 'application/json' } }));
    await vi.advanceTimersByTimeAsync(999);
    expect(stream.locked).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual(unavailable);
    expect(stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['resolve', 'reject'] as const)('observes a late body read that ignored cancellation: %s', async mode => {
    const waiting = deferred<ReadableStreamReadResult<Uint8Array>>();
    const current = {
      read: vi.fn().mockReturnValue(waiting.promise),
      cancel: vi.fn().mockRejectedValue(new Error('private cancel error')), releaseLock: vi.fn(),
    };
    const response = json(confirmed());
    vi.spyOn(response.body!, 'getReader').mockReturnValue(current as unknown as ReturnType<NonNullable<Response['body']>['getReader']>);
    const result = reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetchResponse(response) });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toEqual(unavailable);
    expect(current.cancel).toHaveBeenCalledTimes(1);
    expect(current.releaseLock).toHaveBeenCalledTimes(1);
    if (mode === 'resolve') waiting.resolve({ done: false, value: new TextEncoder().encode(JSON.stringify(confirmed())) });
    else waiting.reject(new Error('late private read error'));
    await vi.advanceTimersByTimeAsync(0);
    expect(current.read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('checks the deadline after JSON parsing, not just after the final read', async () => {
    const record = submitted();
    const response = json(confirmed());
    const parse = JSON.parse;
    vi.spyOn(JSON, 'parse').mockImplementationOnce(text => {
      // Synchronous parsing can consume the budget before the timer gets a turn.
      vi.spyOn(performance, 'now').mockReturnValue(10_000);
      return parse(text);
    });
    expect(await reconcileRecoveryAnchor(record, URL_BASE, { fetch: fetchResponse(response) })).toEqual(unavailable);
    expect(response.body!.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 202, 409])('cleans up timers and caller listeners after HTTP %s success', async status => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const response = json(status === 200 ? confirmed() : status === 202 ? pending : revoked, status);
    const fetcher = fetchResponse(response);
    expect((await reconcileRecoveryAnchor(submitted(), URL_BASE, { fetch: fetcher, signal: controller.signal })).kind)
      .toBe(status === 200 ? 'confirmed' : status === 202 ? 'pending' : 'revoked');
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
    expect(response.body!.locked).toBe(false);
    controller.abort();
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(false);
  });
});
