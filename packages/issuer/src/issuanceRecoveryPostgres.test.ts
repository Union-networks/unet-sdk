import { describe, expect, it, vi } from 'vitest';
import type { SqlClient } from './directIssuerPostgres.js';
import {
  claimRecoveryRecord, createRecoveryRecord, recoveryDigest, transitionRecoveryRecord,
  type RecoveryAction, type RecoveryInput, type RecoveryRecord,
} from './issuanceRecovery.js';
import { ledgerV2IssuerIdHash, ledgerV2RequestHash } from './ledgerV2.js';
import {
  ensureIssuanceRecoverySchema, PostgresIssuanceRecoveryStore, TransactionalIssuanceRecoveryStore, type SqlPool,
} from './issuanceRecoveryPostgres.js';

type Step = {
  sql: string | RegExp;
  values?: unknown[];
  rows?: Record<string, unknown>[];
  rowCount?: number | null;
  error?: Error;
  inspect?: (values: unknown[]) => void;
};

// These fixtures verify SQL shape and kernel integration, not PostgreSQL locking semantics.
function fixture(steps: Step[]) {
  let cursor = 0;
  const release = vi.fn();
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    const step = steps[cursor++];
    if (!step) throw new Error(`unexpected_fixture_query: ${sql}`);
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (typeof step.sql === 'string') expect(normalized).toBe(step.sql);
    else expect(normalized).toMatch(step.sql);
    if (step.values) expect(values).toEqual(step.values);
    step.inspect?.(values);
    if (step.error) throw step.error;
    return { rows: step.rows ?? [], rowCount: Object.hasOwn(step, 'rowCount') ? step.rowCount : 1 };
  });
  const client = { query: query as SqlClient['query'], release };
  const poolQuery = vi.fn(async () => { throw new Error('unexpected_pool_query'); });
  const pool: SqlPool = { query: poolQuery, connect: vi.fn(async () => client) };
  return {
    pool, client, query, release,
    done(ownedTransaction = true) {
      expect(cursor).toBe(steps.length);
      expect(poolQuery).not.toHaveBeenCalled();
      expect(pool.connect).toHaveBeenCalledTimes(ownedTransaction ? 1 : 0);
      expect(release).toHaveBeenCalledTimes(ownedTransaction ? 1 : 0);
    },
  };
}

function begin(): Step[] {
  return [
    { sql: 'BEGIN' },
    { sql: "SET LOCAL lock_timeout = '5s'" },
    { sql: "SET LOCAL statement_timeout = '10s'" },
  ];
}

const now = 1_790_300_000_123;
const requestId = 'synthetic_recovery_request';

function input(): RecoveryInput {
  return {
    request: {
      requestId, serviceAccountRef: 'synthetic_account', checkId: 'synthetic_check',
      holderBinding: 'synthetic_holder', deliveryPublicKey: Buffer.alloc(32, 1).toString('base64url'),
      holderRevocationSigner: `0x${'11'.repeat(20)}`, idempotencyKey: 'synthetic_idempotency',
      deliveryCapabilityHash: '22'.repeat(32), state: 'pending',
      createdAtIso: new Date(now).toISOString(), updatedAtIso: new Date(now).toISOString(),
      claims: { eligibility: true, context: { b: 2, a: 1 } },
    },
    context: {
      schemaId: 'synthetic_schema_v1',
      chainId: 31337, ledgerAddress: `0x${'33'.repeat(20)}`, issuerId: 'synthetic_issuer',
      issuerIdHash: ledgerV2IssuerIdHash('synthetic_issuer'), issuerKeyEpoch: 1, requiredConfirmations: 1,
      credentialKeyId: 'synthetic_credential_key', credentialKeyFingerprint: `0x${'44'.repeat(32)}`,
      validFromEpoch: Math.floor(now / 1000), validUntilEpoch: Math.floor(now / 1000) + 3600,
    },
  };
}

const preparation = {
  attestationHash: '55'.repeat(32),
  encryptedCredentialEnvelope: {
    version: 2, algorithm: 'x25519-xchacha20poly1305',
    senderPublicKey: Buffer.alloc(32, 1).toString('base64url'),
    nonce: Buffer.alloc(24, 2).toString('base64url'), ciphertext: Buffer.alloc(16, 3).toString('base64url'),
  },
};

function row(record: RecoveryRecord): Record<string, unknown> {
  return {
    request_id: record.requestId, record, revision: String(record.revision), phase: record.phase,
    lease_token: record.leaseToken ?? null,
    lease_until_ms: record.leaseUntilMs === undefined ? null : `${record.leaseUntilMs}.000000`,
    next_attempt_at_ms: `${record.nextAttemptAtMs}.000000`, created_at_ms: `${record.createdAtMs}.000000`,
    updated_at_ms: `${record.updatedAtMs}.000000`,
  };
}

function read(record?: RecoveryRecord, lock = true): Step {
  return {
    sql: new RegExp(`^SELECT request_id,record,revision,phase,lease_token, .+ FROM unet_issuance_recovery_v2 WHERE request_id=\\$1${lock ? ' FOR UPDATE' : ''}$`),
    values: [requestId], rows: record ? [row(record)] : [],
  };
}

function clock(nowMs = now): Step {
  return {
    sql: 'SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms',
    rows: [{ now_ms: String(nowMs) }],
  };
}

function expectProjection(values: unknown[], record: RecoveryRecord) {
  expect(values.slice(0, 9)).toEqual([
    record.requestId, record, record.revision, record.phase, record.leaseToken ?? null,
    record.leaseUntilMs === undefined ? null : new Date(record.leaseUntilMs).toISOString(),
    new Date(record.nextAttemptAtMs).toISOString(), new Date(record.createdAtMs).toISOString(),
    new Date(record.updatedAtMs).toISOString(),
  ]);
}

function insert(record: RecoveryRecord): Step {
  return {
    sql: 'INSERT INTO unet_issuance_recovery_v2 (request_id,record,revision,phase,lease_token,lease_until,next_attempt_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(request_id) DO NOTHING',
    inspect: values => { expect(values).toHaveLength(9); expectProjection(values, record); },
  };
}

function update(previous: RecoveryRecord, inspect: (record: RecoveryRecord) => void, mode: 'claim' | 'transition' = 'claim'): Step {
  const guard = mode === 'claim' ? '$6::timestamptz>clock_timestamp()' : 'lease_token=$11 AND lease_until>clock_timestamp()';
  return {
    sql: `UPDATE unet_issuance_recovery_v2 SET record=$2,revision=$3,phase=$4,lease_token=$5,lease_until=$6,next_attempt_at=$7,created_at=$8,updated_at=$9 WHERE request_id=$1 AND revision=$10 AND ${guard}`,
    inspect: values => {
      const next = values[1] as RecoveryRecord;
      inspect(next);
      expectProjection(values, next);
      expect(values).toHaveLength(mode === 'claim' ? 10 : 11);
      expect(values[9]).toBe(previous.revision);
      if (mode === 'transition') expect(values[10]).toBe(previous.leaseToken);
    },
  };
}

function claimed(): RecoveryRecord {
  return claimRecoveryRecord(createRecoveryRecord(input(), now), 'old_lease_token', now)!;
}

function confirmed(): RecoveryRecord {
  let record = claimed();
  const apply = (action: RecoveryAction) => {
    record = transitionRecoveryRecord(record, record.leaseToken!, record.revision, action, now);
  };
  apply({ kind: 'prepare', preparation });
  const submission = {
    operation: {
      attestationHash: `0x${preparation.attestationHash}`, issuerIdHash: record.input.context.issuerIdHash,
      holderRevocationSigner: record.input.request.holderRevocationSigner, requestIdHash: ledgerV2RequestHash(requestId),
      issuerKeyEpoch: 1, nonce: '1', deadline: Math.floor(now / 1000) + 3600,
    },
    signature: `0x${'66'.repeat(64)}1b`,
  };
  apply({ kind: 'submit', submission });
  apply({ kind: 'confirm', receipt: {
    chainId: record.input.context.chainId, ledgerAddress: record.input.context.ledgerAddress,
    attestationHash: submission.operation.attestationHash, issuerIdHash: submission.operation.issuerIdHash,
    holderRevocationSigner: submission.operation.holderRevocationSigner, requestIdHash: submission.operation.requestIdHash,
    submissionDigest: recoveryDigest(submission), transactionHash: `0x${'77'.repeat(32)}`,
    blockHash: `0x${'88'.repeat(32)}`, blockNumber: 100, confirmations: 2,
  } });
  return record;
}

describe('issuance recovery PostgreSQL SQL-shape fixtures', () => {
  it.each([false, true])('persists append-only resubmission and confirms the older attempt (caller-owned: %s)', async callerOwned => {
    const original = confirmed();
    const submitted = structuredClone(original);
    submitted.phase = 'submitted';
    delete submitted.receipt;
    const action: RecoveryAction = { kind: 'resubmit', submission: structuredClone(submitted.submission!) };
    action.submission.operation.nonce = '2';
    action.submission.signature = `0x${'99'.repeat(64)}1c`;
    const expected = transitionRecoveryRecord(submitted, submitted.leaseToken!, submitted.revision, action, now);
    const f = fixture([
      ...(callerOwned ? [] : begin()), read(submitted), clock(),
      update(submitted, next => {
        expect(next).toEqual(expected);
        expect(next.previousSubmissions).toEqual([submitted.submission]);
      }, 'transition'), ...(callerOwned ? [] : [{ sql: 'COMMIT' }]),
    ]);
    const store = callerOwned ? new TransactionalIssuanceRecoveryStore(f.client) : new PostgresIssuanceRecoveryStore(f.pool);
    const result = await store.transition(requestId, submitted.leaseToken!, submitted.revision, action);
    expect(result).toEqual(expected);
    f.done(!callerOwned);

    const confirm: RecoveryAction = { kind: 'confirm', receipt: original.receipt! };
    const confirmedRecord = transitionRecoveryRecord(result, result.leaseToken!, result.revision, confirm, now);
    const confirmationFixture = fixture([
      ...(callerOwned ? [] : begin()), read(result), clock(),
      update(result, next => { expect(next).toEqual(confirmedRecord); }, 'transition'),
      ...(callerOwned ? [] : [{ sql: 'COMMIT' }]),
    ]);
    const confirmationStore = callerOwned ? new TransactionalIssuanceRecoveryStore(confirmationFixture.client)
      : new PostgresIssuanceRecoveryStore(confirmationFixture.pool);
    expect(await confirmationStore.transition(requestId, result.leaseToken!, result.revision, confirm)).toEqual(confirmedRecord);
    confirmationFixture.done(!callerOwned);
  });

  it.each([false, true])('does not issue an UPDATE at the attempt limit (caller-owned: %s)', async callerOwned => {
    let record = confirmed();
    record.phase = 'submitted';
    delete record.receipt;
    for (let i = 2; i <= 32; i++) {
      const submission = structuredClone(record.submission!);
      submission.operation.nonce = String(i);
      record = transitionRecoveryRecord(record, record.leaseToken!, record.revision, { kind: 'resubmit', submission }, now);
    }
    const before = structuredClone(record);
    const submission = structuredClone(record.submission!);
    submission.operation.nonce = '33';
    const f = fixture([
      ...(callerOwned ? [] : begin()), read(record), clock(), ...(callerOwned ? [] : [{ sql: 'ROLLBACK' }]),
    ]);
    const store = callerOwned ? new TransactionalIssuanceRecoveryStore(f.client) : new PostgresIssuanceRecoveryStore(f.pool);
    await expect(store.transition(requestId, record.leaseToken!, record.revision, { kind: 'resubmit', submission }))
      .rejects.toThrow('issuance_recovery_submission_limit');
    expect(record).toEqual(before);
    f.done(!callerOwned);
  });

  it('creates the private recovery table and scheduling index', async () => {
    const query = vi.fn(async (_sql: string) => ({ rows: [] }));
    await ensureIssuanceRecoverySchema({ query });
    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0]![0].replace(/\s+/g, ' ');
    for (const column of [
      'request_id TEXT PRIMARY KEY', 'record JSONB NOT NULL', 'revision BIGINT NOT NULL',
      'phase TEXT NOT NULL', 'lease_token TEXT', 'lease_until TIMESTAMPTZ',
      'next_attempt_at TIMESTAMPTZ NOT NULL', 'created_at TIMESTAMPTZ NOT NULL', 'updated_at TIMESTAMPTZ NOT NULL',
    ]) expect(sql).toContain(column);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS unet_issuance_recovery_v2');
    expect(sql).toContain('ON unet_issuance_recovery_v2(phase,next_attempt_at,lease_until)');
  });

  it('reserves with database time, conflict-safe insert and a locked read on one client', async () => {
    const original = input();
    const expected = createRecoveryRecord(original, now);
    const f = fixture([
      ...begin(), { ...read(), inspect: () => { original.request.checkId = 'mutated_after_reserve'; } },
      clock(), insert(expected), read(expected), { sql: 'COMMIT' },
    ]);
    const result = await new PostgresIssuanceRecoveryStore(f.pool).reserve(original);
    expect(result).toEqual(expected);
    expect(result).not.toBe(expected);
    f.done();
  });

  it('replays canonical-equivalent input without changing an existing record or its lease', async () => {
    const existing = claimed();
    const reordered = input();
    reordered.request.claims = { context: { a: 1, b: 2 }, eligibility: true };
    const f = fixture([...begin(), read(existing), clock(now + 100), { sql: 'COMMIT' }]);
    expect(await new PostgresIssuanceRecoveryStore(f.pool).reserve(reordered)).toEqual(existing);
    f.done();
  });

  it.each([false, true])('compares the winning locked reservation after an insert conflict (different input: %s)', async different => {
    const candidate = createRecoveryRecord(input(), now);
    const winnerInput = input();
    if (different) winnerInput.context.credentialKeyId = 'different_credential_key';
    const winner = createRecoveryRecord(winnerInput, now - 10);
    const f = fixture([
      ...begin(), read(), clock(), { ...insert(candidate), rowCount: 0 }, read(winner),
      { sql: different ? 'ROLLBACK' : 'COMMIT' },
    ]);
    const result = new PostgresIssuanceRecoveryStore(f.pool).reserve(input());
    if (different) await expect(result).rejects.toThrow('issuance_recovery_input_conflict');
    else expect(await result).toEqual(winner);
    f.done();
  });

  it('rejects different immutable input on replay without writing', async () => {
    const existing = createRecoveryRecord(input(), now);
    const changed = input();
    changed.request.claims = { eligibility: false };
    const f = fixture([...begin(), read(existing), clock(), { sql: 'ROLLBACK' }]);
    await expect(new PostgresIssuanceRecoveryStore(f.pool).reserve(changed)).rejects.toThrow('issuance_recovery_input_conflict');
    f.done();
  });

  it('returns an isolated, validated get snapshot', async () => {
    const existing = claimed();
    const f = fixture([...begin(), read(existing, false), { sql: 'COMMIT' }]);
    const result = await new PostgresIssuanceRecoveryStore(f.pool).get(requestId);
    expect(result).toEqual(existing);
    result!.input.request.claims!.eligibility = false;
    expect(existing.input.request.claims!.eligibility).toBe(true);
    f.done();
  });

  it.each(['get', 'claim'] as const)('returns undefined for missing %s without writes', async method => {
    const f = fixture([...begin(), read(undefined, method === 'claim'), { sql: 'COMMIT' }]);
    expect(await new PostgresIssuanceRecoveryStore(f.pool)[method](requestId)).toBeUndefined();
    f.done();
  });

  it.each([
    ['request_id', 'other_request'], ['revision', '9007199254740993'], ['phase', 'completed'],
    ['lease_token', null], ['lease_until_ms', null], ['next_attempt_at_ms', String(now + 1)],
    ['created_at_ms', `${now}.000001`], ['updated_at_ms', null],
  ])('fails closed on mismatched %s projection', async (column, value) => {
    const record = claimed();
    const f = fixture([
      ...begin(), { ...read(record, false), rows: [{ ...row(record), [column as string]: value }] }, { sql: 'ROLLBACK' },
    ]);
    await expect(new PostgresIssuanceRecoveryStore(f.pool).get(requestId)).rejects.toThrow('issuance_recovery_projection_invalid');
    f.done();
  });

  it.each([null, { inputDigest: 'tampered' }, { revision: 0 }, { input: { secret: 'not_a_recovery_input' } }])('fails closed on malformed stored JSON %j', async corruption => {
    const existing = createRecoveryRecord(input(), now);
    const corrupted = corruption === null ? null : { ...existing, ...corruption };
    const f = fixture([
      ...begin(), { ...read(existing, false), rows: [{ ...row(existing), record: corrupted }] }, { sql: 'ROLLBACK' },
    ]);
    await expect(new PostgresIssuanceRecoveryStore(f.pool).get(requestId)).rejects.toThrow('issuance_recovery_record_invalid');
    f.done();
  });

  it('claims using fresh post-lock database time and a UUID token with a five-minute lease', async () => {
    const previous = claimed();
    const afterLock = previous.leaseUntilMs!;
    const original = structuredClone(previous);
    let written: RecoveryRecord | undefined;
    const f = fixture([
      ...begin(), read(previous), clock(afterLock), update(previous, next => {
        expect(next.leaseToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(next.leaseToken).not.toBe(previous.leaseToken);
        expect(next).toEqual(claimRecoveryRecord(previous, next.leaseToken!, afterLock));
        expect(next.leaseUntilMs).toBe(afterLock + 300_000);
        written = next;
      }), { sql: 'COMMIT' },
    ]);
    expect(await new PostgresIssuanceRecoveryStore(f.pool).claim(requestId)).toEqual(written);
    expect(previous).toEqual(original);
    f.done();
  });

  it.each(['active_lease', 'backoff', 'blocked'] as const)('does not write when the kernel rejects claim eligibility: %s', async state => {
    let record = claimed();
    if (state === 'backoff') record = transitionRecoveryRecord(record, record.leaseToken!, record.revision, { kind: 'defer', category: 'receipt_pending' }, now);
    if (state === 'blocked') record = transitionRecoveryRecord(record, record.leaseToken!, record.revision, { kind: 'block', category: 'policy_denied' }, now);
    const f = fixture([...begin(), read(record), clock(now + 1), { sql: 'COMMIT' }]);
    expect(await new PostgresIssuanceRecoveryStore(f.pool).claim(requestId)).toBeUndefined();
    f.done();
  });

  it.each<RecoveryAction>([
    { kind: 'prepare', preparation }, { kind: 'defer', category: 'dependency_unavailable' },
    { kind: 'block', category: 'artifact_invalid' },
  ])('persists the kernel $kind transition with matching projections and current revision', async action => {
    const previous = claimed();
    const original = structuredClone(previous);
    const expected = transitionRecoveryRecord(previous, previous.leaseToken!, previous.revision, action, now + 1);
    const f = fixture([
      ...begin(), read(previous), clock(now + 1), update(previous, next => expect(next).toEqual(expected), 'transition'), { sql: 'COMMIT' },
    ]);
    const result = await new PostgresIssuanceRecoveryStore(f.pool).transition(requestId, previous.leaseToken!, previous.revision, action);
    expect(result).toEqual(expected);
    expect(previous).toEqual(original);
    if (action.kind === 'defer') {
      expect(result.nextAttemptAtMs).toBe(now + 1 + 15_000);
      expect(result.leaseToken).toBeUndefined();
      expect(result.leaseUntilMs).toBeUndefined();
    }
    f.done();
  });

  it.each(['expired_after_lock', 'wrong_token', 'stale_revision'] as const)('rejects a fenced transition without writing: %s', async reason => {
    const previous = claimed();
    const f = fixture([
      ...begin(), read(previous), clock(reason === 'expired_after_lock' ? previous.leaseUntilMs! : now), { sql: 'ROLLBACK' },
    ]);
    await expect(new PostgresIssuanceRecoveryStore(f.pool).transition(
      requestId, reason === 'wrong_token' ? 'another_token' : previous.leaseToken!,
      reason === 'stale_revision' ? previous.revision - 1 : previous.revision, { kind: 'prepare', preparation },
    )).rejects.toThrow('issuance_recovery_lease_lost');
    f.done();
  });

  it('rejects missing transition records', async () => {
    const f = fixture([...begin(), read(), { sql: 'ROLLBACK' }]);
    await expect(new PostgresIssuanceRecoveryStore(f.pool).transition(requestId, 'token', 1, { kind: 'complete' }))
      .rejects.toThrow('issuance_recovery_not_found');
    f.done();
  });

  it.each([0, null, undefined])('rolls back when an exact-revision update does not report one row (%s)', async rowCount => {
    const previous = claimed();
    const f = fixture([
      ...begin(), read(previous), clock(previous.leaseUntilMs!), { ...update(previous, () => undefined), rowCount }, { sql: 'ROLLBACK' },
    ]);
    await expect(new PostgresIssuanceRecoveryStore(f.pool).claim(requestId)).rejects.toThrow('issuance_recovery_lease_lost');
    f.done();
  });

  it('rolls back a claim whose newly computed lease expires between the sampled clock and UPDATE', async () => {
    const previous = createRecoveryRecord(input(), now);
    const f = fixture([
      ...begin(), read(previous), clock(),
      { ...update(previous, next => expect(next.leaseUntilMs).toBe(now + 300_000)), rowCount: 0 },
      { sql: 'ROLLBACK' },
    ]);
    await expect(new PostgresIssuanceRecoveryStore(f.pool).claim(requestId)).rejects.toThrow('issuance_recovery_lease_lost');
    f.done();
  });

  it('rolls back a transition whose prior lease expires between the sampled clock and UPDATE', async () => {
    const previous = claimed();
    const action: RecoveryAction = { kind: 'defer', category: 'receipt_pending' };
    const expected = transitionRecoveryRecord(previous, previous.leaseToken!, previous.revision, action, now);
    const f = fixture([
      ...begin(), read(previous), clock(),
      { ...update(previous, next => expect(next).toEqual(expected), 'transition'), rowCount: 0 },
      { sql: 'ROLLBACK' },
    ]);
    await expect(new PostgresIssuanceRecoveryStore(f.pool).transition(requestId, previous.leaseToken!, previous.revision, action))
      .rejects.toThrow('issuance_recovery_lease_lost');
    f.done();
  });

  it.each([1, 0])('completion checks the old lease while clearing lease projections (updated rows: %i)', async rowCount => {
    const previous = confirmed();
    const action: RecoveryAction = { kind: 'complete' };
    const expected = transitionRecoveryRecord(previous, previous.leaseToken!, previous.revision, action, now);
    expect(expected.leaseToken).toBeUndefined();
    expect(expected.leaseUntilMs).toBeUndefined();
    const f = fixture([
      ...begin(), read(previous), clock(),
      { ...update(previous, next => expect(next).toEqual(expected), 'transition'), rowCount },
      { sql: rowCount === 1 ? 'COMMIT' : 'ROLLBACK' },
    ]);
    const result = new PostgresIssuanceRecoveryStore(f.pool).transition(requestId, previous.leaseToken!, previous.revision, action);
    if (rowCount === 1) expect(await result).toEqual(expected);
    else await expect(result).rejects.toThrow('issuance_recovery_lease_lost');
    f.done();
  });

  it.each([undefined, null, 'not_time', '9007199254740993', '-1', '1.25'])('rejects invalid database clock %s', async nowMs => {
    const f = fixture([
      ...begin(), read(createRecoveryRecord(input(), now)), { ...clock(), rows: [{ now_ms: nowMs }] }, { sql: 'ROLLBACK' },
    ]);
    await expect(new PostgresIssuanceRecoveryStore(f.pool).claim(requestId)).rejects.toThrow('issuance_recovery_invalid_database_time');
    f.done();
  });

  it.each([0, 1, 2, 3, 4, 5, 6])('rolls back and releases on transaction failure at query %i, even if rollback fails', async failureIndex => {
    const previous = claimed();
    const error = new Error('synthetic_database_failure');
    const steps = [
      ...begin(), read(previous), clock(previous.leaseUntilMs!), update(previous, () => undefined), { sql: 'COMMIT' },
    ];
    const f = fixture([
      ...steps.slice(0, failureIndex), { ...steps[failureIndex]!, error },
      { sql: 'ROLLBACK', error: new Error('synthetic_rollback_failure') },
    ]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(new PostgresIssuanceRecoveryStore(f.pool).claim(requestId)).rejects.toBe(error);
      expect(f.release).toHaveBeenCalledWith(true);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      f.done();
    } finally { warn.mockRestore(); log.mockRestore(); }
  });
});

describe('transaction-bound issuance recovery SQL-shape fixtures', () => {
  // The fixture models caller ownership only, not PostgreSQL commit/rollback semantics.
  async function outerTransaction<T>(f: ReturnType<typeof fixture>, work: (db: SqlClient) => Promise<T>): Promise<T> {
    const db = await f.pool.connect();
    try {
      await db.query('BEGIN');
      const result = await work(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  it('composes reserve, locked get, claim and prepare with provider writes before the caller commits', async () => {
    const reserved = createRecoveryRecord(input(), now);
    let leased: RecoveryRecord;
    let prepared: RecoveryRecord;
    const f = fixture([
      { sql: 'BEGIN' }, { sql: 'INSERT INTO provider_requests VALUES($1)', values: [requestId] },
      read(), clock(), insert(reserved), read(reserved), read(reserved),
      read(reserved), clock(), update(reserved, next => {
        expect(next).toEqual(claimRecoveryRecord(reserved, next.leaseToken!, now));
        leased = next;
      }),
      { ...read(), get rows() { return [row(leased)]; } }, clock(),
      {
        sql: update(reserved, () => undefined, 'transition').sql,
        inspect: values => {
          prepared = transitionRecoveryRecord(leased, leased.leaseToken!, leased.revision, { kind: 'prepare', preparation }, now);
          update(leased, next => expect(next).toEqual(prepared), 'transition').inspect!(values);
        },
      },
      { sql: 'UPDATE provider_applications SET request_id=$1', values: [requestId] }, { sql: 'COMMIT' },
    ]);
    await outerTransaction(f, async db => {
      const store = new TransactionalIssuanceRecoveryStore(db);
      await db.query('INSERT INTO provider_requests VALUES($1)', [requestId]);
      expect(await store.reserve(input())).toEqual(reserved);
      expect(await store.get(requestId)).toEqual(reserved);
      const claim = (await store.claim(requestId))!;
      expect(await store.transition(requestId, claim.leaseToken!, claim.revision, { kind: 'prepare', preparation })).toEqual(prepared!);
      await db.query('UPDATE provider_applications SET request_id=$1', [requestId]);
      expect(f.release).not.toHaveBeenCalled();
      expect(f.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    });
    f.done();
  });

  it.each(['commit', 'publication_error', 'completion_cas_error'] as const)
    ('leaves composed completion and publication outcome to the caller: %s', async outcome => {
      const previous = confirmed();
      const completed = transitionRecoveryRecord(previous, previous.leaseToken!, previous.revision, { kind: 'complete' }, now);
      const publicationError = new Error('synthetic_publication_failure');
      const f = fixture([
        { sql: 'BEGIN' },
        { sql: 'UPDATE provider_requests SET state=$1', values: ['ready'] },
        read(previous), clock(),
        { ...update(previous, next => expect(next).toEqual(completed), 'transition'), rowCount: outcome === 'completion_cas_error' ? 0 : 1 },
        ...(outcome === 'completion_cas_error' ? [] : [{
          sql: 'UPDATE provider_applications SET status=$1', values: ['pending'],
          ...(outcome === 'publication_error' ? { error: publicationError } : {}),
        }]),
        { sql: outcome === 'commit' ? 'COMMIT' : 'ROLLBACK' },
      ]);
      const result = outerTransaction(f, async db => {
        const store = new TransactionalIssuanceRecoveryStore(db);
        await db.query('UPDATE provider_requests SET state=$1', ['ready']);
        expect(await store.transition(requestId, previous.leaseToken!, previous.revision, { kind: 'complete' })).toEqual(completed);
        await db.query('UPDATE provider_applications SET status=$1', ['pending']);
      });
      if (outcome === 'commit') await result;
      else if (outcome === 'publication_error') await expect(result).rejects.toBe(publicationError);
      else await expect(result).rejects.toThrow('issuance_recovery_lease_lost');
      f.done();
    });

  it('returns an isolated validated snapshot while retaining the caller-owned row lock', async () => {
    const previous = claimed();
    const f = fixture([read(previous)]);
    const result = await new TransactionalIssuanceRecoveryStore(f.client).get(requestId);
    expect(result).toEqual(previous);
    result!.input.request.claims!.eligibility = false;
    expect(previous.input.request.claims!.eligibility).toBe(true);
    f.done(false);
  });

  it.each(['get', 'claim'] as const)('returns missing %s without any transaction management', async method => {
    const f = fixture([read()]);
    expect(await new TransactionalIssuanceRecoveryStore(f.client)[method](requestId)).toBeUndefined();
    f.done(false);
  });

  it.each(['json', 'projection', 'database'] as const)('propagates %s read failure without rollback or release', async failure => {
    const previous = claimed();
    const error = new Error('synthetic_database_failure');
    const f = fixture([{
      ...read(previous),
      ...(failure === 'database' ? { error } : {
        rows: [{ ...row(previous), ...(failure === 'json' ? { record: null } : { revision: '0' }) }],
      }),
    }]);
    const result = new TransactionalIssuanceRecoveryStore(f.client).get(requestId);
    if (failure === 'database') await expect(result).rejects.toBe(error);
    else await expect(result).rejects.toThrow(failure === 'json' ? 'issuance_recovery_record_invalid' : 'issuance_recovery_projection_invalid');
    f.done(false);
  });

  it('leaves immutable reservation conflicts to the outer transaction', async () => {
    const previous = createRecoveryRecord(input(), now);
    const different = input();
    different.context.issuerKeyEpoch++;
    const f = fixture([read(previous), clock()]);
    await expect(new TransactionalIssuanceRecoveryStore(f.client).reserve(different)).rejects.toThrow('issuance_recovery_input_conflict');
    f.done(false);
  });

  it('checks database time after the claim lock and retains the SQL lease guard', async () => {
    const previous = claimed();
    const afterLock = previous.leaseUntilMs!;
    const f = fixture([
      read(previous), clock(afterLock),
      { ...update(previous, next => expect(next).toEqual(claimRecoveryRecord(previous, next.leaseToken!, afterLock))), rowCount: 0 },
    ]);
    await expect(new TransactionalIssuanceRecoveryStore(f.client).claim(requestId)).rejects.toThrow('issuance_recovery_lease_lost');
    f.done(false);
  });

  it.each(['expired', 'token', 'revision'] as const)('rejects a %s transition fence without owning rollback', async failure => {
    const previous = claimed();
    const f = fixture([read(previous), clock(failure === 'expired' ? previous.leaseUntilMs! : now)]);
    await expect(new TransactionalIssuanceRecoveryStore(f.client).transition(
      requestId, failure === 'token' ? 'wrong_token' : previous.leaseToken!,
      failure === 'revision' ? previous.revision - 1 : previous.revision, { kind: 'prepare', preparation },
    )).rejects.toThrow('issuance_recovery_lease_lost');
    f.done(false);
  });

  it.each([false, true])('snapshots reservation before any await (standalone: %s)', async standalone => {
    const original = input();
    const expected = createRecoveryRecord(original, now);
    const f = fixture([
      ...(standalone ? begin() : []), read(), clock(), insert(expected), read(expected),
      ...(standalone ? [{ sql: 'COMMIT' }] : []),
    ]);
    const store = standalone ? new PostgresIssuanceRecoveryStore(f.pool) : new TransactionalIssuanceRecoveryStore(f.client);
    const result = store.reserve(original);
    original.context.issuerKeyEpoch++;
    original.request.claims!.context = { mutated: true };
    expect(await result).toEqual(expected);
    f.done(standalone);
  });

  it.each([false, true])('snapshots transition action before any await (standalone: %s)', async standalone => {
    const previous = claimed();
    const action: RecoveryAction = { kind: 'prepare', preparation: structuredClone(preparation) };
    const expected = transitionRecoveryRecord(previous, previous.leaseToken!, previous.revision, action, now);
    const f = fixture([
      ...(standalone ? begin() : []), read(previous), clock(),
      update(previous, next => expect(next).toEqual(expected), 'transition'), ...(standalone ? [{ sql: 'COMMIT' }] : []),
    ]);
    const store = standalone ? new PostgresIssuanceRecoveryStore(f.pool) : new TransactionalIssuanceRecoveryStore(f.client);
    const result = store.transition(requestId, previous.leaseToken!, previous.revision, action);
    action.preparation.attestationHash = '99'.repeat(32);
    action.preparation.encryptedCredentialEnvelope.ciphertext = 'mutated';
    expect(await result).toEqual(expected);
    f.done(standalone);
  });
});
