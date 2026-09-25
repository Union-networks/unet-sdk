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
      schemaId: 'age-schema-v1',
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

function resubmitted(count = 2): RecoveryRecord {
  let record = submitted();
  for (let i = 1; i < count; i++) {
    const submission = structuredClone(record.submission!);
    submission.operation.nonce = String(17 + i);
    submission.operation.deadline++;
    submission.signature = `0x${i.toString(16).padStart(2, '0').repeat(64)}1b`;
    record = transitionRecoveryRecord(record, 'owner', record.revision, { kind: 'resubmit', submission }, NOW);
  }
  return record;
}

function savedConfirmation(record = resubmitted()): RecoveryRecord {
  const attempt = record.previousSubmissions![0];
  const op = attempt.operation;
  return transitionRecoveryRecord(record, 'owner', record.revision, { kind: 'confirm', receipt: {
    chainId: record.input.context.chainId, ledgerAddress: record.input.context.ledgerAddress,
    attestationHash: op.attestationHash, issuerIdHash: op.issuerIdHash,
    holderRevocationSigner: op.holderRevocationSigner, requestIdHash: op.requestIdHash,
    submissionDigest: recoveryDigest(attempt), transactionHash: hash('1'), blockHash: hash('2'),
    blockNumber: 40, confirmations: 2,
  } }, NOW);
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

describe('saved attempt reconciliation', () => {
  it.each([0, 1, 2, 3, 4, 32])('rotates newest-first traversal by durable claim count %s and wraps', async claims => {
    const record = resubmitted(3);
    record.attempts = claims;
    const newestFirst = [record.submission!, ...record.previousSubmissions!.slice().reverse()];
    const offset = Math.max(0, claims - 1) % newestFirst.length;
    const expected = [...newestFirst.slice(offset), ...newestFirst.slice(0, offset)];
    // Reusing the same snapshot repeats the same ordering, not a worker retry.
    for (let replay = 0; replay < 2; replay++) {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(pending, 202));
      expect(await reconcileRecoveryAnchor(record, URL_BASE, { fetch: fetcher })).toEqual({ kind: 'pending' });
      expect(fetcher.mock.calls.map(call => {
        const body = JSON.parse(call[1]!.body as string);
        return { operation: body.operation, signature: body.signature };
      })).toEqual(expected);
    }
  });

  it('tries newest first, then exact older bytes, binding the receipt to the successful attempt', async () => {
    const record = freezeDeep(resubmitted(3));
    const before = structuredClone(record);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(pending, 202))
      .mockResolvedValueOnce(json(pending, 202))
      .mockResolvedValueOnce(json(confirmed(record)));
    const result = await reconcileRecoveryAnchor(record, URL_BASE, { fetch: fetcher });
    expect(result).toMatchObject({ kind: 'confirmed', receipt: {
      submissionDigest: recoveryDigest(record.previousSubmissions![0]),
    } });
    const attempts = [record.submission, ...record.previousSubmissions!.slice().reverse()];
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [index, attempt] of attempts.entries()) {
      expect(JSON.parse(fetcher.mock.calls[index][1]!.body as string)).toEqual({
        chainId: 31337, ledgerAddress: address('D'), requiredConfirmations: 2,
        operation: attempt!.operation, signature: attempt!.signature,
      });
    }
    if (result.kind !== 'confirmed') throw new Error('expected confirmation');
    expect(() => transitionRecoveryRecord(record, 'owner', record.revision, { kind: 'confirm', receipt: result.receipt }, NOW)).not.toThrow();
    expect(record).toEqual(before);
  });

  it('stops on newest confirmation and snapshots history before the first await', async () => {
    const record = resubmitted();
    const saved = structuredClone(record);
    const waiting = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValueOnce(waiting.promise).mockResolvedValueOnce(json(confirmed(saved)));
    const result = reconcileRecoveryAnchor(record, URL_BASE, { fetch: fetcher });
    record.previousSubmissions![0].signature = 'changed';
    record.previousSubmissions!.push(record.submission!);
    waiting.resolve(json(pending, 202));
    expect(await result).toMatchObject({ kind: 'confirmed', receipt: { submissionDigest: recoveryDigest(saved.previousSubmissions![0]) } });
    const newest = vi.fn<typeof fetch>().mockResolvedValueOnce(json(confirmed(saved)));
    expect(await reconcileRecoveryAnchor(saved, URL_BASE, { fetch: newest }))
      .toMatchObject({ kind: 'confirmed', receipt: { submissionDigest: recoveryDigest(saved.submission) } });
    expect(newest).toHaveBeenCalledTimes(1);
  });

  it.each(['pending', 'unavailable', 'throw', 'active'] as const)('continues past %s without trusting it as confirmation', async first => {
    const record = resubmitted();
    const fetcher = vi.fn<typeof fetch>();
    if (first === 'throw') fetcher.mockRejectedValueOnce(new Error('private dependency error'));
    else fetcher.mockResolvedValueOnce(first === 'pending' ? json(pending, 202)
      : first === 'active' ? json({ success: true, protocolVersion: 2, status: 'active' }) : json({}, 409));
    fetcher.mockResolvedValueOnce(json(confirmed(record)));
    expect(await reconcileRecoveryAnchor(record, URL_BASE, { fetch: fetcher }))
      .toMatchObject({ kind: 'confirmed', receipt: { submissionDigest: recoveryDigest(record.previousSubmissions![0]) } });
  });

  it.each([false, true])('returns pending only when every saved attempt is pending (unavailable: %s)', async failed => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(failed ? json({}, 409) : json(pending, 202))
      .mockResolvedValueOnce(json(pending, 202));
    expect(await reconcileRecoveryAnchor(resubmitted(), URL_BASE, { fetch: fetcher }))
      .toEqual({ kind: failed ? 'unavailable' : 'pending' });
  });

  it('retains strict evidence validation for historical attempts and exact revocation semantics', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(pending, 202));
    const payload = confirmed();
    payload.receipt.checkedHeadNumber++;
    fetcher.mockResolvedValueOnce(json(payload));
    expect(await reconcileRecoveryAnchor(resubmitted(), URL_BASE, { fetch: fetcher })).toEqual(unavailable);
    const revokedFetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(pending, 202)).mockResolvedValueOnce(json(revoked, 409));
    expect(await reconcileRecoveryAnchor(resubmitted(3), URL_BASE, { fetch: revokedFetcher })).toEqual({ kind: 'revoked' });
    expect(revokedFetcher).toHaveBeenCalledTimes(2);
  });

  it('validates every historical attempt before any transport', async () => {
    for (const mutate of [
      (r: RecoveryRecord) => { r.previousSubmissions![0].signature = 'invalid'; },
      (r: RecoveryRecord) => { r.previousSubmissions![0].operation.requestIdHash = hash('1'); },
      (r: RecoveryRecord) => { r.previousSubmissions!.push(r.submission!); },
      (r: RecoveryRecord) => { r.previousSubmissions = Array(32).fill(r.submission); },
    ]) {
      const record = resubmitted();
      mutate(record);
      expect(await reconcileRecoveryAnchor(record, URL_BASE)).toEqual(unavailable);
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rechecks only the receipt-bound historical attempt, allowing confirmation depth to change', async () => {
    const record = savedConfirmation(resubmitted(3));
    record.attempts = 2;
    record.receipt!.confirmations = 3;
    freezeDeep(record);
    for (const depth of [2, 3, 4]) {
      const payload = confirmed(record);
      payload.receipt.confirmations = depth;
      payload.receipt.checkedHeadNumber = 40 + depth - 1;
      const fetcher = fetchResponse(json(payload));
      expect(await reconcileRecoveryAnchor(record, URL_BASE, { fetch: fetcher })).toMatchObject({
        kind: 'confirmed', receipt: { ...record.receipt, ledgerAddress: address('d'), confirmations: depth },
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).signature).toBe(record.previousSubmissions![0].signature);
    }
    expect(record.receipt!.confirmations).toBe(3);
  });

  it.each(['transactionHash', 'blockHash', 'blockNumber'] as const)('cannot change confirmed %s binding or fall back to another attempt', async field => {
    const record = savedConfirmation();
    const payload = confirmed(record);
    if (field === 'blockNumber') {
      payload.receipt.blockNumber++;
      payload.receipt.checkedHeadNumber++;
    } else payload.receipt[field] = hash('9');
    const fetcher = fetchResponse(json(payload));
    expect(await reconcileRecoveryAnchor(record, URL_BASE, { fetch: fetcher })).toEqual(unavailable);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['insufficient_confirmations', 'reorg_detected'])('leaves a confirmed record unchanged on %s', async reason => {
    const record = freezeDeep(savedConfirmation());
    const fetcher = fetchResponse(json({ ...pending, reason }, 202));
    expect(await reconcileRecoveryAnchor(record, URL_BASE, { fetch: fetcher })).toEqual({ kind: 'pending' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(record.phase).toBe('confirmed');
  });

  it('can reconcile all 32 saved attempts without dropping signatures', async () => {
    const record = resubmitted(32);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(pending, 202));
    expect(await reconcileRecoveryAnchor(record, URL_BASE, { fetch: fetcher })).toEqual({ kind: 'pending' });
    expect(fetcher).toHaveBeenCalledTimes(32);
    expect(record.previousSubmissions).toHaveLength(31);
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

  it('starts older on the next fresh claim after newest consumes the entire first 10s budget', async () => {
    const record = freezeDeep(resubmitted());
    const first = vi.fn<typeof fetch>().mockReturnValue(new Promise<Response>(() => undefined));
    const stalled = reconcileRecoveryAnchor(record, URL_BASE, { fetch: first });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await stalled).toEqual(unavailable);
    expect(first).toHaveBeenCalledTimes(1);
    expect(JSON.parse(first.mock.calls[0][1]!.body as string).signature).toBe(record.submission!.signature);
    expect(first.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    const deferredRecord = transitionRecoveryRecord(record, 'owner', record.revision,
      { kind: 'defer', category: 'dependency_unavailable' }, NOW + 10_000);
    const retry = claimRecoveryRecord(deferredRecord, 'retry-owner', deferredRecord.nextAttemptAtMs)!;
    expect(retry.attempts).toBe(record.attempts + 1);
    expect(retry.revision).toBe(record.revision + 2);
    expect(retry.previousSubmissions).toEqual(record.previousSubmissions);
    expect(retry.submission).toEqual(record.submission);
    const waiting = deferred<Response>();
    const second = vi.fn<typeof fetch>().mockReturnValueOnce(waiting.promise);
    const recovered = reconcileRecoveryAnchor(retry, URL_BASE, { fetch: second });
    expect(JSON.parse(second.mock.calls[0][1]!.body as string).signature).toBe(record.previousSubmissions![0].signature);
    await vi.advanceTimersByTimeAsync(2_000);
    waiting.resolve(json(confirmed(retry)));
    const result = await recovered;
    expect(result).toMatchObject({ kind: 'confirmed', receipt: {
      submissionDigest: recoveryDigest(record.previousSubmissions![0]),
    } });
    expect(second).toHaveBeenCalledTimes(1);
    if (result.kind !== 'confirmed') throw new Error('expected confirmation');
    expect(transitionRecoveryRecord(retry, 'retry-owner', retry.revision,
      { kind: 'confirm', receipt: result.receipt }, retry.updatedAtMs + 2_000).phase).toBe('confirmed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['headers', 'body'] as const)('shares one total 10s across attempts including stalled older %s', async mode => {
    const first = deferred<Response>();
    const late = deferred<Response>();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const fetcher = vi.fn<typeof fetch>().mockReturnValueOnce(first.promise);
    if (mode === 'headers') fetcher.mockReturnValueOnce(late.promise);
    else fetcher.mockResolvedValueOnce(new Response(stream, { headers: { 'content-type': 'application/json' } }));
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const result = reconcileRecoveryAnchor(resubmitted(3), URL_BASE, { fetch: fetcher, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(9_000);
    first.resolve(json(pending, 202));
    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual(unavailable);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]!.signal!.aborted).toBe(true);
    if (mode === 'headers') {
      late.resolve(new Response(stream, { headers: { 'content-type': 'application/json' } }));
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove.mock.calls.map(call => call[1])).toEqual(add.mock.calls.map(call => call[1]));
  });

  it('does not start older attempts after caller cancellation', async () => {
    const first = deferred<Response>();
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockReturnValueOnce(first.promise);
    const result = reconcileRecoveryAnchor(resubmitted(), URL_BASE, { fetch: fetcher, signal: controller.signal });
    first.resolve(json(pending, 202));
    controller.abort();
    expect(await result).toEqual(unavailable);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

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
