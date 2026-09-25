import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DirectIssuerRequestRecord, DirectIssuerRequestStore } from './directIssuer.js';
import { PostgresDirectIssuerRequestStore, type SqlClient } from './directIssuerPostgres.js';

type Step = {
  sql: string | RegExp;
  values?: unknown[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  error?: Error;
};

// SQL mocks verify connection ownership and query shape, not PostgreSQL lock semantics.
function fixture(steps: Step[]) {
  let cursor = 0;
  const release = vi.fn();
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    const step = steps[cursor++];
    if (!step) throw new Error('unexpected_fixture_query');
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (typeof step.sql === 'string') expect(normalized).toBe(step.sql);
    else expect(normalized).toMatch(step.sql);
    if (step.values) expect(values).toEqual(step.values);
    if (step.error) throw step.error;
    return { rows: step.rows ?? [], rowCount: step.rowCount ?? 1 };
  });
  const client = { query: query as SqlClient['query'], release };
  const poolQuery = vi.fn(async () => { throw new Error('unexpected_pool_query'); });
  const pool = { query: poolQuery, connect: vi.fn(async () => client) };
  return {
    client, pool, query, release, store: new PostgresDirectIssuerRequestStore(pool),
    done() {
      expect(cursor).toBe(steps.length);
      expect(poolQuery).not.toHaveBeenCalled();
      expect(pool.connect).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
    },
  };
}

function begin(): Step[] {
  return [
    { sql: 'BEGIN' },
    { sql: "SET LOCAL lock_timeout = '5s'" },
    { sql: "SET LOCAL statement_timeout = '10s'" },
    { sql: 'SELECT pg_advisory_xact_lock($1::bigint)' },
  ];
}

function record(overrides: Partial<DirectIssuerRequestRecord> = {}): DirectIssuerRequestRecord {
  return {
    requestId: 'request-a', serviceAccountRef: 'account-a', checkId: 'check-a',
    holderBinding: 'holder', deliveryPublicKey: 'delivery', holderRevocationSigner: `0x${'11'.repeat(20)}`,
    idempotencyKey: 'idempotency-a', deliveryCapabilityHash: '22'.repeat(32), state: 'pending',
    createdAtIso: '2026-09-25T00:00:00.000Z', updatedAtIso: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('Postgres direct issuer account admission', () => {
  it('pins all callback APIs to one connection, scopes reads and locks only targeted rows', async () => {
    const saved = record();
    const rows = [{ request_record: saved }];
    const f = fixture([
      ...begin(),
      { sql: /^INSERT INTO unet_attestation_requests_v2/, values: [saved.requestId, saved.serviceAccountRef, saved.checkId, saved.idempotencyKey, saved.state, null, saved, saved.createdAtIso, saved.updatedAtIso] },
      { sql: 'SELECT request_record FROM unet_attestation_requests_v2 WHERE request_id=$1 AND service_account_ref=$2 AND check_id=$3 FOR UPDATE', values: ['request-a', 'account-a', 'check-a'], rows },
      { sql: 'SELECT request_record FROM unet_attestation_requests_v2 WHERE service_account_ref=$1 AND idempotency_key=$2 AND check_id=$3 FOR UPDATE', values: ['account-a', 'idempotency-a', 'check-a'], rows },
      { sql: "SELECT request_record FROM unet_attestation_requests_v2 WHERE service_account_ref=$1 AND check_id=$2 AND state IN ('ready','delivered') ORDER BY created_at DESC FOR UPDATE", values: ['account-a', 'check-a'], rows },
      { sql: "SELECT request_record FROM unet_attestation_requests_v2 WHERE service_account_ref=$1 AND check_id=$2 AND state IN ('pending','anchoring') ORDER BY created_at DESC,request_id DESC FOR UPDATE", values: ['account-a', 'check-a'], rows },
      { sql: 'SELECT request_record FROM unet_attestation_requests_v2 WHERE attestation_hash=$1 AND service_account_ref=$2 AND check_id=$3 LIMIT 1 FOR UPDATE', values: ['hash', 'account-a', 'check-a'], rows },
      { sql: 'SELECT request_record FROM unet_attestation_requests_v2 WHERE ($1::text IS NULL OR state=$1) AND ($2::text IS NULL OR service_account_ref=$2) AND check_id=$4 ORDER BY created_at DESC LIMIT $3', values: [null, 'account-a', 100, 'check-a'], rows },
      { sql: 'UPDATE unet_attestation_requests_v2 SET state=$2,attestation_hash=$3,request_record=$4,updated_at=$5 WHERE request_id=$1 AND service_account_ref=$6 AND check_id=$7 AND idempotency_key=$8', values: ['request-a', 'pending', null, saved, saved.updatedAtIso, 'account-a', 'check-a', 'idempotency-a'] },
      { sql: 'COMMIT' },
    ]);
    const value = await f.store.withAccountTransaction('account-a', 'check-a', async (bound) => {
      expect(bound).toBeInstanceOf(PostgresDirectIssuerRequestStore);
      expect(bound).not.toBe(f.store);
      await bound.create(saved);
      expect(await bound.get('request-a')).toEqual(saved);
      expect(await bound.findByIdempotency('account-a', 'idempotency-a')).toEqual(saved);
      expect(await bound.findActive('account-a', 'check-a')).toEqual([saved]);
      expect(await bound.findPending('account-a', 'check-a')).toEqual([saved]);
      expect(await bound.findByAttestationHash('hash')).toEqual(saved);
      expect(await bound.list()).toEqual([saved]);
      await bound.update(saved);
      return { admitted: true };
    });
    expect(value).toEqual({ admitted: true });
    expect(f.release).toHaveBeenCalledWith();
    f.done();
  });

  it('preserves unlocked root reads and returns all pending rows without a list cap', async () => {
    const records = Array.from({ length: 501 }, (_, index) => record({ requestId: `request-${index}` }));
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: records.map((request_record) => ({ request_record })) }));
    const store = new PostgresDirectIssuerRequestStore({ query: query as SqlClient['query'] });
    expect(await store.findPending('account-a', 'check-a')).toEqual(records);
    expect(query.mock.calls[0]).toEqual([
      expect.stringMatching(/state IN \('pending','anchoring'\)\s+ORDER BY created_at DESC,request_id DESC$/),
      ['account-a', 'check-a'],
    ]);
    await store.get('request-a');
    await store.findByIdempotency('account-a', 'idempotency-a');
    await store.findActive('account-a', 'check-a');
    await store.findByAttestationHash('hash');
    await store.list();
    await store.create(record());
    await store.update(record());
    expect(JSON.stringify(query.mock.calls)).not.toContain('FOR UPDATE');
    expect(query.mock.calls[1]).toEqual(['SELECT request_record FROM unet_attestation_requests_v2 WHERE request_id=$1', ['request-a']]);
  });

  it.each([0, 1, 2, 3, 4])('rolls back failures at transaction statement %i and preserves the error', async (index) => {
    const error = new Error('synthetic_database_failure');
    const statements = [...begin(), { sql: 'COMMIT' }];
    const steps = statements.slice(0, index + 1);
    steps[index] = { ...steps[index]!, error };
    const f = fixture([...steps, { sql: 'ROLLBACK' }]);
    const work = vi.fn(async () => 'result');
    await expect(f.store.withAccountTransaction('account-a', 'check-a', work)).rejects.toBe(error);
    expect(work).toHaveBeenCalledTimes(index === 4 ? 1 : 0);
    expect(f.release).toHaveBeenCalledWith();
    f.done();
  });

  it.each([false, true])('rolls back callback failure and destroys the connection only if rollback fails: %s', async (rollbackFails) => {
    const error = new Error('synthetic_callback_failure');
    const f = fixture([...begin(), { sql: 'ROLLBACK', ...(rollbackFails ? { error: new Error('rollback_failed') } : {}) }]);
    await expect(f.store.withAccountTransaction('account-a', 'check-a', async () => { throw error; })).rejects.toBe(error);
    if (rollbackFails) expect(f.release).toHaveBeenCalledWith(true);
    else expect(f.release).toHaveBeenCalledWith();
    f.done();
  });

  it('does not issue pool queries or release a connection when acquisition fails', async () => {
    const error = new Error('connect_failed');
    const query = vi.fn();
    const pool = { query, connect: vi.fn(async () => { throw error; }) };
    const work = vi.fn();
    await expect(new PostgresDirectIssuerRequestStore(pool).withAccountTransaction('account-a', 'check-a', work)).rejects.toBe(error);
    expect(query).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it('requires a pool and rejects nested transactions and escaped bound stores', async () => {
    const query = vi.fn();
    await expect(new PostgresDirectIssuerRequestStore({ query }).withAccountTransaction('account-a', 'check-a', vi.fn())).rejects.toThrow('issuer_account_transaction_pool_required');
    expect(query).not.toHaveBeenCalled();
    const f = fixture([...begin(), { sql: 'COMMIT' }]);
    let escaped!: DirectIssuerRequestStore;
    await f.store.withAccountTransaction('account-a', 'check-a', async (bound) => {
      escaped = bound;
      await expect(bound.withAccountTransaction('account-a', 'check-a', vi.fn())).rejects.toThrow('issuer_account_transaction_nested');
    });
    await expect(escaped.get('request-a')).rejects.toThrow('issuer_account_transaction_closed');
    await expect(escaped.create(record())).rejects.toThrow('issuer_account_transaction_closed');
    f.done();
  });

  it.each(['', '  ', 'secret\0identity', 'x'.repeat(1025), '\u00e9'.repeat(513), null, {}, 42])('rejects invalid scope before connecting without exposing it (%#)', async (invalid) => {
    for (const values of [[invalid, 'check-a'], ['account-a', invalid]]) {
      const query = vi.fn();
      const pool = { query, connect: vi.fn() };
      const work = vi.fn();
      const store = new PostgresDirectIssuerRequestStore(pool);
      await expect(store.withAccountTransaction(values[0] as string, values[1] as string, work)).rejects.toThrow(/^issuer_account_transaction_scope_invalid$/);
      expect(pool.connect).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
      expect(work).not.toHaveBeenCalled();
    }
  });

  it('derives stable signed 64-bit SHA-256 keys with separated account/check tuples before awaiting', async () => {
    const scopes = [['account-a', 'check-a'], ['account-a', 'check-a'], ['account-b', 'check-a'], ['account-a', 'check-b'], ['a:b', 'c'], ['a', 'b:c'], ['account-a ', 'check-a']];
    const keys: string[] = [];
    for (const [account, check] of scopes) {
      const input = { account: account!, check: check! };
      const f = fixture([...begin(), { sql: 'COMMIT' }]);
      f.pool.connect.mockImplementation(async () => {
        input.account = 'mutated-account';
        input.check = 'mutated-check';
        return f.client;
      });
      await f.store.withAccountTransaction(input.account, input.check, async () => undefined);
      const key = f.query.mock.calls[3]![1]![0] as string;
      const digest = createHash('sha256').update(JSON.stringify(['unet:direct-issuer:admission:v1', account, check])).digest();
      expect(key).toBe(digest.readBigInt64BE(0).toString());
      expect(BigInt(key)).toBeGreaterThanOrEqual(-(1n << 63n));
      expect(BigInt(key)).toBeLessThan(1n << 63n);
      const parameters = f.query.mock.calls.flatMap((call) => call[1] ?? []);
      expect(parameters).toEqual([key]);
      expect(parameters).not.toContain(account!);
      expect(parameters).not.toContain(check!);
      keys.push(key);
      f.done();
    }
    expect(keys[0]).toBe(keys[1]);
    expect(new Set(keys).size).toBe(scopes.length - 1);
    expect(keys.some((key) => key.startsWith('-'))).toBe(true);
  });

  it('rejects foreign writes, changed account/check fields, and foreign read scopes before querying', async () => {
    const f = fixture([...begin(), { sql: 'COMMIT' }]);
    await f.store.withAccountTransaction('account-a', 'check-a', async (bound) => {
      for (const foreign of [record({ serviceAccountRef: 'foreign-account' }), record({ checkId: 'foreign-check' })]) {
        await expect(bound.create(foreign)).rejects.toThrow('issuer_account_transaction_scope_mismatch');
        await expect(bound.update(foreign)).rejects.toThrow('issuer_account_transaction_scope_mismatch');
      }
      await expect(bound.findByIdempotency('foreign-account', 'key')).rejects.toThrow('issuer_account_transaction_scope_mismatch');
      await expect(bound.findActive('account-a', 'foreign-check')).rejects.toThrow('issuer_account_transaction_scope_mismatch');
      await expect(bound.findPending('foreign-account', 'check-a')).rejects.toThrow('issuer_account_transaction_scope_mismatch');
      await expect(bound.list({ serviceAccountRef: 'foreign-account' })).rejects.toThrow('issuer_account_transaction_scope_mismatch');
    });
    f.done();
  });

  it('does not transfer a foreign request into the bound scope by updating its JSON record', async () => {
    const f = fixture([
      ...begin(),
      { sql: /WHERE request_id=\$1 AND service_account_ref=\$6 AND check_id=\$7 AND idempotency_key=\$8$/, rowCount: 0 },
      { sql: 'ROLLBACK' },
    ]);
    await expect(f.store.withAccountTransaction('account-a', 'check-a', (bound) => bound.update(record({ requestId: 'foreign-request' })))).rejects.toThrow('issuer_request_not_found');
    f.done();
  });

  it('rejects bound updates that change the indexed idempotency key in the JSON record', async () => {
    const changed = record({ idempotencyKey: 'changed-key' });
    const f = fixture([
      ...begin(),
      {
        sql: /WHERE request_id=\$1 AND service_account_ref=\$6 AND check_id=\$7 AND idempotency_key=\$8$/,
        values: ['request-a', 'pending', null, changed, changed.updatedAtIso, 'account-a', 'check-a', 'changed-key'],
        rowCount: 0,
      },
      { sql: 'ROLLBACK' },
    ]);
    await expect(f.store.withAccountTransaction('account-a', 'check-a', (bound) => bound.update(changed))).rejects.toThrow('issuer_request_not_found');
    f.done();
  });

  it('sanitizes account-wide idempotency races across different check locks and rolls back', async () => {
    const error = Object.assign(new Error('duplicate key: private-account, private-idempotency'), {
      code: '23505', detail: 'private-account, private-idempotency',
    });
    const f = fixture([...begin(), { sql: /^INSERT INTO/, error }, { sql: 'ROLLBACK' }]);
    await expect(f.store.withAccountTransaction('account-a', 'check-a', (bound) => bound.create(record())))
      .rejects.toThrow(/^issuer_request_idempotency_conflict$/);
    f.done();
  });

  it('preserves non-unique create failures and rolls back', async () => {
    const error = Object.assign(new Error('synthetic_insert_failure'), { code: '57014' });
    const f = fixture([...begin(), { sql: /^INSERT INTO/, error }, { sql: 'ROLLBACK' }]);
    await expect(f.store.withAccountTransaction('account-a', 'check-a', (bound) => bound.create(record()))).rejects.toBe(error);
    f.done();
  });

  it('keeps overlapping callbacks on independently owned clients without rebinding the root store', async () => {
    let enter!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const resumed = new Promise<void>((resolve) => { resume = resolve; });
    const first = fixture([...begin(), { sql: /WHERE request_id=\$1 AND service_account_ref=\$2 AND check_id=\$3 FOR UPDATE$/, values: ['first', 'account-a', 'check-a'] }, { sql: 'COMMIT' }]);
    const second = fixture([...begin(), { sql: /WHERE request_id=\$1 AND service_account_ref=\$2 AND check_id=\$3 FOR UPDATE$/, values: ['second', 'account-b', 'check-a'] }, { sql: 'COMMIT' }]);
    const poolQuery = vi.fn(async () => ({ rows: [] }));
    const connect = vi.fn().mockResolvedValueOnce(first.client).mockResolvedValueOnce(second.client);
    const store = new PostgresDirectIssuerRequestStore({ query: poolQuery, connect } as SqlClient);
    const a = store.withAccountTransaction('account-a', 'check-a', async (bound) => {
      enter();
      await resumed;
      await bound.get('first');
      return 'first-result';
    });
    await entered;
    try {
      expect(await store.withAccountTransaction('account-b', 'check-a', async (bound) => {
        await bound.get('second');
        return 'second-result';
      })).toBe('second-result');
      await store.get('root');
      expect(poolQuery).toHaveBeenCalledWith('SELECT request_record FROM unet_attestation_requests_v2 WHERE request_id=$1', ['root']);
      expect(first.release).not.toHaveBeenCalled();
      expect(second.release).toHaveBeenCalledOnce();
    } finally {
      resume();
      await a;
    }
    expect(await a).toBe('first-result');
    expect(first.query).toHaveBeenCalledTimes(6);
    expect(second.query).toHaveBeenCalledTimes(6);
    expect(first.release).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
