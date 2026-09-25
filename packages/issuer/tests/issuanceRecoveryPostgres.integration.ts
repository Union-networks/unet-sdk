import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import { isAbsolute } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import type { SqlClient } from '../src/directIssuerPostgres.js';
import type { SqlPool } from '../src/issuanceRecoveryPostgres.js';
import type { RecoveryAction, RecoveryInput, RecoveryRecord } from '../src/issuanceRecovery.js';

const requiredEnvironment = ['UNET_PROVIDER_TEST_DATABASE_URL', 'UNET_PROVIDER_TEST_DATABASE_CA',
  'UNET_ISSUANCE_TEST_OWNER', 'UNET_PROVIDER_TEST_SERVER_ADDRESS'] as const;
const missingEnvironment = requiredEnvironment.filter(key => !process.env[key]);
const waitLimit = 10_000;
const caseCount = 25;
type Connection = Awaited<ReturnType<SqlPool['connect']>>;
type FixturePool = SqlPool & { end(): Promise<void>; on(event: 'error', handler: () => void): void };

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('acceptance_wait_timeout')), waitLimit);
    })]);
  } finally { clearTimeout(timer); }
}

// No runtime application or pg imports, and no sockets, before this environment gate.
test('real PostgreSQL private issuance recovery acceptance', {
  timeout: 240_000,
  skip: missingEnvironment.length ? 'missing disposable fixture environment: ' + missingEnvironment.join(', ') : false,
}, async t => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0, poolErrors = 0, cases = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error('acceptance_network_forbidden'); };
  let pool: FixturePool | undefined;
  let createdSchema = false, cleanupComplete = false;
  let schemaOid: number | undefined;
  const workers: Promise<unknown>[] = [];
  const releases: Array<() => void> = [];
  const schema = 'issuance_acceptance_' + randomBytes(16).toString('hex');
  const applicationName = 'issuance-acceptance-' + randomBytes(8).toString('hex');
  const owner = process.env.UNET_ISSUANCE_TEST_OWNER!;
  const serverAddress = process.env.UNET_PROVIDER_TEST_SERVER_ADDRESS!;
  const query: SqlClient['query'] = (sql, values) => bounded(pool!.query(sql, values));
  const track = <T>(promise: Promise<T>): Promise<T> => {
    workers.push(promise);
    void promise.catch(() => undefined);
    const result = bounded(promise);
    void result.catch(() => undefined);
    return result;
  };
  const verifyFixture = async () => {
    const identity = (await query(`SELECT current_database() AS database, current_user AS username,
      session_user AS session_username, host(inet_server_addr()) AS server_address,
      (SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()) AS encrypted`)).rows[0];
    assert.deepEqual(identity, { database: 'unet_security_test', username: 'provider_next_fixture',
      session_username: 'provider_next_fixture', server_address: serverAddress, encrypted: true });
    assert.deepEqual((await query('SELECT owner FROM public.issuance_test_owner')).rows, [{ owner }]);
    const version = (await query("SELECT current_setting('server_version_num')::int AS version")).rows[0].version;
    assert.ok(typeof version === 'number' && version >= 170000, 'PostgreSQL 17 or newer required');
  };
  const verifySchema = async () => {
    assert.match(schema, /^issuance_acceptance_[a-f0-9]{32}$/);
    const result = await query(`SELECT oid::int AS oid, pg_catalog.pg_get_userbyid(nspowner) AS owner
      FROM pg_catalog.pg_namespace WHERE nspname=$1`, [schema]);
    assert.equal(result.rowCount, 1);
    assert.equal(result.rows[0].owner, 'provider_next_fixture');
    if (schemaOid !== undefined) assert.equal(result.rows[0].oid, schemaOid);
    return result.rows[0].oid as number;
  };
  const runCase = async (name: string, fn: () => Promise<void>) => {
    let complete = false;
    const started = performance.now();
    const index = cases + 1;
    assert.ok(index <= caseCount);
    console.log(JSON.stringify({ kind: 'issuance-postgres-case', index, phase: 'started' }));
    await t.test(name, { timeout: waitLimit }, async () => {
      try {
        await fn();
        assert.equal(fetchCalls, 0);
        assert.equal(poolErrors, 0);
        complete = true;
        cases++;
        console.log(JSON.stringify({ kind: 'issuance-postgres-case', index, phase: 'passed' }));
      } catch (error) {
        const source = error instanceof Error
          ? error.stack?.match(/issuanceRecoveryPostgres\.integration\.ts:(\d+):\d+/) : undefined;
        console.log(JSON.stringify({ kind: 'issuance-postgres-case-failure', index,
          sourceLine: source ? Number(source[1]) : 0, elapsedMs: Math.round(performance.now() - started) }));
        throw new Error('issuance_postgres_case_failed');
      }
    });
    assert.ok(complete, 'acceptance case incomplete');
  };

  try {
    assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
    const url = new URL(process.env.UNET_PROVIDER_TEST_DATABASE_URL!);
    assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '55490');
    assert.equal(decodeURIComponent(url.pathname), '/unet_security_test');
    assert.equal(decodeURIComponent(url.username), 'provider_next_fixture');
    assert.match(decodeURIComponent(url.password), /^[a-f0-9]{48}$/);
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
    assert.match(owner, /^[a-f0-9]{20}$/);
    assert.equal(isIP(serverAddress), 4);
    const [a, b] = serverAddress.split('.').map(Number);
    assert.ok(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
    const caPath = process.env.UNET_PROVIDER_TEST_DATABASE_CA!;
    assert.ok(isAbsolute(caPath));
    const ca = await bounded(readFile(caPath, 'utf8'));
    assert.match(ca.trim(), /^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/);
    assert.ok(!ca.includes('PRIVATE KEY'));
    // Reuse installed fixture tooling without changing SDK dependencies or public exports.
    const require = createRequire(new URL('../../../../safety-current/package.json', import.meta.url));
    const { Pool } = require('pg');
    pool = new Pool({ host: '127.0.0.1', port: 55490, database: 'unet_security_test',
      user: 'provider_next_fixture', password: decodeURIComponent(url.password),
      ssl: { ca, rejectUnauthorized: true }, application_name: applicationName,
      options: '-c search_path=' + schema, max: 8, connectionTimeoutMillis: 8_000,
      query_timeout: 8_000, statement_timeout: 8_000, lock_timeout: 6_000,
      idle_in_transaction_session_timeout: 8_000 }) as FixturePool;
    pool.on('error', () => { poolErrors++; });
    await verifyFixture();
    await query('CREATE SCHEMA "' + schema + '"');
    createdSchema = true;
    schemaOid = await verifySchema();
    assert.deepEqual((await query('SELECT current_schema() AS schema, current_schemas(false)::text[] AS schemas')).rows,
      [{ schema, schemas: [schema] }]);
    const { PostgresIssuanceRecoveryStore, TransactionalIssuanceRecoveryStore, ensureIssuanceRecoverySchema } = await bounded(import('../src/issuanceRecoveryPostgres.js'));
    const { PostgresDirectIssuerRequestStore, ensureDirectIssuerSchema } = await bounded(import('../src/directIssuerPostgres.js'));
    const { createDirectIssuerService } = await bounded(import('../src/directIssuer.js'));
    const { recoveryDigest, validateRecoveryRecord } = await bounded(import('../src/issuanceRecovery.js'));
    const { ledgerV2IssuerIdHash, ledgerV2RequestHash } = await bounded(import('../src/ledgerV2.js'));
    await bounded(ensureIssuanceRecoverySchema(pool));
    await bounded(ensureDirectIssuerSchema(pool));
    const store = new PostgresIssuanceRecoveryStore(pool);
    const input = (): RecoveryInput => {
      const id = randomBytes(12).toString('hex');
      return { request: { requestId: 'request-' + id, state: 'pending', deliveryCapabilityHash: 'a'.repeat(64),
        createdAtIso: '2026-09-25T00:00:00.000Z', updatedAtIso: '2026-09-25T00:00:00.000Z',
        serviceAccountRef: 'synthetic-' + id, checkId: 'synthetic-check', holderBinding: 'synthetic-holder',
        deliveryPublicKey: Buffer.alloc(32, 1).toString('base64url'),
        holderRevocationSigner: '0x' + '1'.repeat(40), idempotencyKey: 'synthetic-' + id },
      context: { chainId: 31337, ledgerAddress: '0x' + '2'.repeat(40), issuerId: 'synthetic-issuer',
        issuerIdHash: ledgerV2IssuerIdHash('synthetic-issuer'), issuerKeyEpoch: 1,
        credentialKeyId: 'synthetic-key', credentialKeyFingerprint: '0x' + '3'.repeat(64),
        validFromEpoch: 1, validUntilEpoch: 2, requiredConfirmations: 1 } };
    };
    const prepare: RecoveryAction = { kind: 'prepare', preparation: { attestationHash: 'b'.repeat(64),
      encryptedCredentialEnvelope: { version: 2, algorithm: 'x25519-xchacha20poly1305',
        senderPublicKey: Buffer.alloc(32, 2).toString('base64url'), nonce: Buffer.alloc(24, 3).toString('base64url'),
        ciphertext: Buffer.alloc(32, 4).toString('base64url') } } };
    const row = async (id: string) => (await query('SELECT to_jsonb(r) AS value FROM unet_issuance_recovery_v2 r WHERE request_id=$1', [id])).rows[0]?.value;
    const projection = async (id: string) => {
      const result = await query(`SELECT record, request_id, revision, phase, lease_token,
        (extract(epoch FROM lease_until)*1000)::bigint AS lease_ms,
        (extract(epoch FROM next_attempt_at)*1000)::bigint AS next_ms,
        (extract(epoch FROM created_at)*1000)::bigint AS created_ms,
        (extract(epoch FROM updated_at)*1000)::bigint AS updated_ms
        FROM unet_issuance_recovery_v2 WHERE request_id=$1`, [id]);
      assert.equal(result.rowCount, 1);
      const r = result.rows[0];
      const record = r.record as RecoveryRecord;
      validateRecoveryRecord(record);
      assert.equal(r.request_id, record.requestId);
      assert.equal(Number(r.revision), record.revision);
      assert.equal(r.phase, record.phase);
      assert.equal(r.lease_token, record.leaseToken ?? null);
      assert.equal(r.lease_ms === null ? undefined : Number(r.lease_ms), record.leaseUntilMs);
      assert.equal(Number(r.next_ms), record.nextAttemptAtMs);
      assert.equal(Number(r.created_ms), record.createdAtMs);
      assert.equal(Number(r.updated_ms), record.updatedAtMs);
      return record;
    };
    const claimed = async () => {
      const i = input();
      await track(store.reserve(i));
      const r = await track(store.claim(i.request.requestId));
      assert.ok(r?.leaseToken);
      return r;
    };
    const transition = (r: RecoveryRecord, action: RecoveryAction) => {
      assert.ok(r.leaseToken);
      return track(store.transition(r.requestId, r.leaseToken, r.revision, action));
    };
    // Only synthetic owned rows are adjusted. JSON and SQL remain consistent in one statement.
    const setLease = async (id: string, offsetMs: number) => {
      assert.ok(Number.isSafeInteger(offsetMs) && Math.abs(offsetMs) <= 2_000);
      assert.equal((await query(`WITH tick AS MATERIALIZED (
        SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint+$2::bigint AS ms)
        UPDATE unet_issuance_recovery_v2 SET
          record=jsonb_set(record,'{leaseUntilMs}',to_jsonb(tick.ms)),
          lease_until=to_timestamp(tick.ms::double precision/1000)
        FROM tick WHERE request_id=$1 AND lease_token IS NOT NULL`, [id, offsetMs])).rowCount, 1);
      return projection(id);
    };
    const waitExpired = async (id: string) => {
      const deadline = performance.now() + 3_000;
      while (!(await query('SELECT lease_until<=clock_timestamp() AS expired FROM unet_issuance_recovery_v2 WHERE request_id=$1', [id])).rows[0].expired) {
        assert.ok(performance.now() < deadline, 'lease expiry not observed');
        await sleep(10);
      }
    };
    const assertLive = async (id: string) => {
      assert.equal((await query('SELECT lease_until>clock_timestamp() AS live FROM unet_issuance_recovery_v2 WHERE request_id=$1', [id])).rows[0].live, true);
    };
    const waitLocked = async (pid: number, count: number) => {
      const deadline = performance.now() + 3_000;
      for (;;) {
        const state = (await query(`SELECT count(*)::int AS count,
          bool_or($2::int=ANY(pg_catalog.pg_blocking_pids(pid))) AS owned_blocker
          FROM pg_catalog.pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'
          AND cardinality(pg_catalog.pg_blocking_pids(pid))>0`, [applicationName, pid])).rows[0];
        if (Number(state.count) >= count && state.owned_blocker === true) return;
        assert.ok(performance.now() < deadline, 'expected owned PostgreSQL lock wait not observed');
        await sleep(10);
      }
    };
    const withLock = async (id: string | undefined, fn: (db: Connection, pid: number) => Promise<void>) => {
      const db = await bounded(pool!.connect());
      try {
        await bounded(db.query('BEGIN'));
        const pid = Number((await bounded(db.query('SELECT pg_backend_pid() AS pid'))).rows[0].pid);
        if (id) await bounded(db.query('SELECT request_id FROM unet_issuance_recovery_v2 WHERE request_id=$1 FOR UPDATE', [id]));
        else await bounded(db.query('LOCK TABLE unet_issuance_recovery_v2 IN SHARE MODE'));
        await fn(db, pid);
      } finally {
        try { await bounded(db.query('ROLLBACK')); } finally { db.release(); }
      }
    };

    await runCase('owned schema, real DDL, and absent request behavior', async () => {
      await bounded(ensureIssuanceRecoverySchema(pool!));
      await verifySchema();
      assert.equal(await track(store.get('absent')), undefined);
      assert.equal(await track(store.claim('absent')), undefined);
      await assert.rejects(track(store.transition('absent', 'token', 1, prepare)), /^Error: issuance_recovery_not_found$/);
    });
    await runCase('concurrent identical reservations really contend and converge', async () => {
      const i = input();
      await withLock(undefined, async (db, pid) => {
        const attempts = Array.from({ length: 4 }, () => track(store.reserve(i)));
        await waitLocked(pid, 4);
        await bounded(db.query('COMMIT'));
        const records = await bounded(Promise.all(attempts));
        records.forEach(r => assert.deepEqual(r, records[0]));
        assert.equal(records[0].revision, 1);
        assert.equal((await query('SELECT count(*)::int AS count FROM unet_issuance_recovery_v2 WHERE request_id=$1', [i.request.requestId])).rows[0].count, 1);
      });
    });
    await runCase('concurrent conflicting reservations commit exactly one immutable input', async () => {
      const a = input(), b = structuredClone(a);
      b.context.credentialKeyId = 'other-synthetic-key';
      await withLock(undefined, async (db, pid) => {
        const attempts = [track(store.reserve(a)), track(store.reserve(b))];
        await waitLocked(pid, 2);
        await bounded(db.query('COMMIT'));
        const results = await bounded(Promise.allSettled(attempts));
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        const rejected = results.find(r => r.status === 'rejected');
        assert.ok(rejected?.status === 'rejected');
        assert.equal(rejected.reason?.message, 'issuance_recovery_input_conflict');
        const winner = results.find(r => r.status === 'fulfilled');
        assert.ok(winner?.status === 'fulfilled');
        assert.deepEqual(await track(store.get(a.request.requestId)), winner.value);
      });
    });
    await runCase('immutable conflict cannot overwrite a leased record', async () => {
      const r = await claimed();
      const before = await row(r.requestId);
      for (const mutate of [(i: RecoveryInput) => { i.request.holderBinding = 'other-holder'; },
        (i: RecoveryInput) => { i.context.issuerKeyEpoch++; }]) {
        const changed = structuredClone(r.input); mutate(changed);
        await assert.rejects(track(store.reserve(changed)), /^Error: issuance_recovery_input_conflict$/);
        assert.deepEqual(await row(r.requestId), before);
      }
      assert.deepEqual(await track(store.reserve(r.input)), r);
    });
    await runCase('concurrent claims have exactly one live owner', async () => {
      const r = await track(store.reserve(input()));
      await withLock(r.requestId, async (db, pid) => {
        const attempts = Array.from({ length: 4 }, () => track(store.claim(r.requestId)));
        await waitLocked(pid, 4);
        await bounded(db.query('COMMIT'));
        const winners = (await bounded(Promise.all(attempts))).filter(Boolean) as RecoveryRecord[];
        assert.equal(winners.length, 1);
        assert.equal(winners[0].revision, r.revision + 1);
        assert.equal(winners[0].attempts, 1);
        assert.equal(winners[0].leaseUntilMs! - winners[0].updatedAtMs, 300_000);
        assert.deepEqual(await projection(r.requestId), winners[0]);
        assert.equal(await track(store.claim(r.requestId)), undefined);
      });
    });
    await runCase('expired takeover replaces token and fences stale owner', async () => {
      const old = await claimed();
      await setLease(old.requestId, -1_000);
      const next = await track(store.claim(old.requestId));
      assert.ok(next?.leaseToken);
      assert.notEqual(next.leaseToken, old.leaseToken);
      assert.equal(next.revision, old.revision + 1);
      assert.equal(next.attempts, old.attempts + 1);
      const before = await row(old.requestId);
      await assert.rejects(transition(old, prepare), /^Error: issuance_recovery_lease_lost$/);
      await assert.rejects(track(store.transition(old.requestId, old.leaseToken!, next.revision, prepare)), /^Error: issuance_recovery_lease_lost$/);
      assert.deepEqual(await row(old.requestId), before);
    });
    await runCase('concurrent transitions and stale revision cannot overwrite winner', async () => {
      const r = await claimed();
      await withLock(r.requestId, async (db, pid) => {
        const attempts = [transition(r, prepare), transition(r, prepare)];
        await waitLocked(pid, 2);
        await bounded(db.query('COMMIT'));
        const results = await bounded(Promise.allSettled(attempts));
        assert.equal(results.filter(v => v.status === 'fulfilled').length, 1);
        const failure = results.find(v => v.status === 'rejected');
        assert.ok(failure?.status === 'rejected');
        assert.equal(failure.reason?.message, 'issuance_recovery_lease_lost');
      });
      const before = await row(r.requestId);
      await assert.rejects(transition(r, { kind: 'block', category: 'policy_denied' }), /^Error: issuance_recovery_lease_lost$/);
      assert.deepEqual(await row(r.requestId), before);
    });
    await runCase('expired lease without replacement rejects transition', async () => {
      const r = await claimed();
      await setLease(r.requestId, -1_000);
      const before = await row(r.requestId);
      await assert.rejects(transition(r, prepare), /^Error: issuance_recovery_lease_lost$/);
      assert.deepEqual(await row(r.requestId), before);
    });
    await runCase('transition samples time after unchanged row lock wait', async () => {
      const r = await claimed();
      await setLease(r.requestId, 2_000);
      const before = await row(r.requestId);
      let work!: Promise<RecoveryRecord>;
      await withLock(r.requestId, async (db, pid) => {
        work = transition(r, prepare);
        await waitLocked(pid, 1);
        await assertLive(r.requestId);
        await waitExpired(r.requestId);
        await bounded(db.query('COMMIT'));
      });
      await assert.rejects(work, /^Error: issuance_recovery_lease_lost$/);
      assert.deepEqual(await row(r.requestId), before);
    });
    await runCase('claim sees lease expiry after unchanged row lock wait', async () => {
      const r = await claimed();
      await setLease(r.requestId, 2_000);
      let work!: Promise<RecoveryRecord | undefined>;
      await withLock(r.requestId, async (db, pid) => {
        work = track(store.claim(r.requestId));
        await waitLocked(pid, 1);
        await assertLive(r.requestId);
        await waitExpired(r.requestId);
        await bounded(db.query('COMMIT'));
      });
      const replacement = await work;
      assert.ok(replacement?.leaseToken);
      assert.notEqual(replacement.leaseToken, r.leaseToken);
      assert.equal(replacement.revision, r.revision + 1);
      assert.deepEqual(await projection(r.requestId), replacement);
    });
    await runCase('final SQL lease guard rejects expiry after successful clock sample', async () => {
      const r = await claimed();
      const shortened = await setLease(r.requestId, 2_000);
      const before = await row(r.requestId);
      let entered!: () => void, release!: () => void;
      const clockRead = new Promise<void>(resolve => { entered = resolve; });
      const pause = new Promise<void>(resolve => { release = resolve; });
      releases.push(release);
      let clockSamples = 0, updateCount: number | null | undefined, rollbacks = 0, commits = 0;
      // Every SQL statement still executes on the real connection. Only return of the
      // already-executed time query is paused; its stale result reaches the real kernel.
      const pausedPool: SqlPool = {
        query: (sql, values) => pool!.query(sql, values),
        connect: async () => {
          const db = await pool!.connect();
          const wrappedQuery: SqlClient['query'] = async <T extends Record<string, unknown>>(sql: string, values?: unknown[]) => {
            const result = await db.query<T>(sql, values);
            if (/^SELECT floor\(extract\(epoch FROM clock_timestamp\(\)\)/.test(sql.trim())) {
              clockSamples++;
              assert.ok(Number(result.rows[0].now_ms) < shortened.leaseUntilMs!);
              entered();
              await bounded(pause);
            }
            if (/^UPDATE unet_issuance_recovery_v2\b/.test(sql.trim())) updateCount = result.rowCount;
            if (sql === 'ROLLBACK') rollbacks++;
            if (sql === 'COMMIT') commits++;
            return result;
          };
          return { release: () => db.release(), query: wrappedQuery };
        },
      };
      const work = track(new PostgresIssuanceRecoveryStore(pausedPool).transition(r.requestId, r.leaseToken!, r.revision, prepare));
      try {
        await bounded(clockRead);
        await waitExpired(r.requestId);
      } finally { release(); }
      await assert.rejects(work, /^Error: issuance_recovery_lease_lost$/);
      assert.equal(clockSamples, 1);
      assert.equal(updateCount, 0, 'real guarded UPDATE must affect zero rows');
      assert.equal(rollbacks, 1);
      assert.equal(commits, 0);
      assert.deepEqual(await row(r.requestId), before);
    });
    await runCase('full synthetic lifecycle atomically projects JSON, phase, revision and lease', async () => {
      // A real BEFORE trigger rejects any intermediate mismatched projection, even
      // if an implementation would repair it in a later statement before COMMIT.
      await query(`CREATE FUNCTION "${schema}".check_projection() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.request_id IS DISTINCT FROM NEW.record->>'requestId'
            OR NEW.revision IS DISTINCT FROM (NEW.record->>'revision')::bigint
            OR NEW.phase IS DISTINCT FROM NEW.record->>'phase'
            OR NEW.lease_token IS DISTINCT FROM NEW.record->>'leaseToken'
            OR extract(epoch FROM NEW.lease_until)*1000 IS DISTINCT FROM (NEW.record->>'leaseUntilMs')::numeric
            OR extract(epoch FROM NEW.next_attempt_at)*1000 IS DISTINCT FROM (NEW.record->>'nextAttemptAtMs')::numeric
            OR extract(epoch FROM NEW.created_at)*1000 IS DISTINCT FROM (NEW.record->>'createdAtMs')::numeric
            OR extract(epoch FROM NEW.updated_at)*1000 IS DISTINCT FROM (NEW.record->>'updatedAtMs')::numeric
          THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='synthetic_projection_mismatch'; END IF;
          RETURN NEW;
        END $$`);
      await query(`CREATE TRIGGER check_projection BEFORE INSERT OR UPDATE ON unet_issuance_recovery_v2
        FOR EACH ROW EXECUTE FUNCTION "${schema}".check_projection()`);
      try {
        let r = await track(store.reserve(input()));
        assert.deepEqual(await projection(r.requestId), r);
        r = (await track(store.claim(r.requestId)))!;
        assert.deepEqual(await projection(r.requestId), r);
        r = await transition(r, prepare);
        assert.equal(r.phase, 'prepared');
        assert.deepEqual(await projection(r.requestId), r);
        const now = Number((await query('SELECT floor(extract(epoch FROM clock_timestamp()))::bigint AS now')).rows[0].now);
        r = await transition(r, { kind: 'submit', submission: { operation: {
          attestationHash: '0x' + r.preparation!.attestationHash, issuerIdHash: r.input.context.issuerIdHash,
          holderRevocationSigner: r.input.request.holderRevocationSigner, requestIdHash: ledgerV2RequestHash(r.requestId),
          issuerKeyEpoch: 1, nonce: '0', deadline: now + 600 }, signature: '0x' + '1'.repeat(128) + '1b' } });
        assert.equal(r.phase, 'submitted');
        assert.deepEqual(await projection(r.requestId), r);
        const op = r.submission!.operation;
        r = await transition(r, { kind: 'confirm', receipt: { chainId: r.input.context.chainId,
          ledgerAddress: r.input.context.ledgerAddress, attestationHash: op.attestationHash,
          issuerIdHash: op.issuerIdHash, holderRevocationSigner: op.holderRevocationSigner,
          requestIdHash: op.requestIdHash, submissionDigest: recoveryDigest(r.submission),
          transactionHash: '0x' + '4'.repeat(64), blockHash: '0x' + '5'.repeat(64), blockNumber: 1, confirmations: 1 } });
        assert.equal(r.phase, 'confirmed');
        assert.deepEqual(await projection(r.requestId), r);
        r = await transition(r, { kind: 'complete' });
        assert.equal(r.phase, 'completed');
        assert.equal(r.leaseToken, undefined);
        assert.deepEqual(await projection(r.requestId), r);
        assert.equal(await track(store.claim(r.requestId)), undefined);
        assert.deepEqual(await track(store.reserve(r.input)), r);
      } finally {
        await query('DROP TRIGGER check_projection ON unet_issuance_recovery_v2');
        await query(`DROP FUNCTION "${schema}".check_projection()`);
      }
    });
    await runCase('real failing SQL statement rolls back JSON, projection and trigger side effects', async () => {
      const r = await claimed();
      const before = await row(r.requestId);
      await query('CREATE TABLE rollback_probe(request_id text NOT NULL)');
      await query(`CREATE FUNCTION "${schema}".fail_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN INSERT INTO "${schema}".rollback_probe VALUES(NEW.request_id);
          RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='synthetic_rollback_failure'; END $$`);
      await query(`CREATE TRIGGER fail_update AFTER UPDATE ON unet_issuance_recovery_v2
        FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_update()`);
      try {
        await assert.rejects(transition(r, prepare), { code: 'P0001' });
        assert.deepEqual(await row(r.requestId), before);
        assert.equal((await query('SELECT count(*)::int AS count FROM rollback_probe')).rows[0].count, 0);
      } finally {
        await query('DROP TRIGGER fail_update ON unet_issuance_recovery_v2');
        await query(`DROP FUNCTION "${schema}".fail_update()`);
      }
      const after = await transition(r, prepare);
      assert.equal(after.revision, r.revision + 1);
      assert.deepEqual(await projection(r.requestId), after);
    });
    await runCase('defer backoff and terminal block remain unclaimable', async () => {
      const r = await claimed();
      const deferred = await transition(r, { kind: 'defer', category: 'dependency_unavailable' });
      assert.equal(deferred.nextAttemptAtMs - deferred.updatedAtMs, 15_000);
      assert.equal(deferred.leaseToken, undefined);
      assert.deepEqual(await projection(r.requestId), deferred);
      assert.equal(await track(store.claim(r.requestId)), undefined);
      const other = await claimed();
      const blocked = await transition(other, { kind: 'block', category: 'policy_denied' });
      assert.equal(blocked.phase, 'blocked');
      assert.equal(blocked.leaseToken, undefined);
      assert.deepEqual(await projection(other.requestId), blocked);
      assert.equal(await track(store.claim(other.requestId)), undefined);
    });
    await runCase('corrupt projection is rejected without repair or overwrite', async () => {
      const r = await claimed();
      await query('UPDATE unet_issuance_recovery_v2 SET revision=revision+1 WHERE request_id=$1', [r.requestId]);
      const before = await row(r.requestId);
      for (const invoke of [() => store.get(r.requestId), () => store.claim(r.requestId),
        () => store.reserve(r.input), () => store.transition(r.requestId, r.leaseToken!, r.revision, prepare)]) {
        await assert.rejects(track(invoke()), /^Error: issuance_recovery_projection_invalid$/);
        assert.deepEqual(await row(r.requestId), before);
      }
    });
    await verifyFixture();
    await verifySchema();
    await runCase('failed rollback evicts the connection and aborts its uncommitted write', async () => {
      const r = await claimed();
      const before = await row(r.requestId);
      let pid = 0;
      let discarded = false;
      let writeApplied = false;
      let rollbackAttempted = false;
      const damagedPool: SqlPool = {
        query: (sql, values) => pool!.query(sql, values),
        connect: async () => {
          const db = await pool!.connect();
          pid = Number((await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
          return {
            query: async <T extends Record<string, unknown>>(sql: string, values?: unknown[]) => {
              if (sql === 'ROLLBACK') {
                rollbackAttempted = true;
                throw new Error('synthetic_rollback_transport_failure');
              }
              const result = await db.query<T>(sql, values);
              if (/^UPDATE unet_issuance_recovery_v2/.test(sql)) {
                assert.equal(result.rowCount, 1);
                writeApplied = true;
                throw new Error('synthetic_write_response_lost');
              }
              return result;
            },
            release: destroy => { discarded = destroy === true; db.release(destroy); },
          };
        },
      };
      await assert.rejects(track(new PostgresIssuanceRecoveryStore(damagedPool)
        .transition(r.requestId, r.leaseToken!, r.revision, prepare)), /^Error: synthetic_write_response_lost$/);
      assert.ok(writeApplied && rollbackAttempted && discarded);
      const deadline = performance.now() + 3_000;
      while (Number((await query('SELECT count(*)::int AS count FROM pg_catalog.pg_stat_activity WHERE pid=$1', [pid])).rows[0].count)) {
        assert.ok(performance.now() < deadline, 'discarded backend still present');
        await sleep(10);
      }
      assert.deepEqual(await row(r.requestId), before);
      assert.equal((await transition(r, prepare)).phase, 'prepared');
    });
    // Provider projection here is synthetic; these cases prove transaction
    // composition, not Safety's account-policy or HTTP authorization boundary.
    await query('CREATE TABLE application_publication(request_id text PRIMARY KEY, state text NOT NULL)');
    const outerTransaction = async <T>(work: (db: Connection) => Promise<T>): Promise<T> => {
      const db = await bounded(pool!.connect());
      let discard = false;
      try {
        await bounded(db.query('BEGIN'));
        const result = await work(db);
        await bounded(db.query('COMMIT'));
        return result;
      } catch (error) {
        try { await bounded(db.query('ROLLBACK')); } catch { discard = true; }
        throw error;
      } finally { db.release(discard); }
    };
    await runCase('outer transaction atomically reserves request, journal and application', async () => {
      const i = input();
      const reserve = (fail: boolean) => outerTransaction(async db => {
        const requests = new PostgresDirectIssuerRequestStore(db);
        const recovery = new TransactionalIssuanceRecoveryStore(db);
        await requests.create(i.request);
        await recovery.reserve(i);
        await db.query('INSERT INTO application_publication VALUES($1,$2)', [i.request.requestId, 'pending']);
        // A separate pool connection must not observe any of the three writes.
        assert.equal(await store.get(i.request.requestId), undefined);
        assert.equal(await new PostgresDirectIssuerRequestStore(pool!).get(i.request.requestId), undefined);
        assert.equal((await query('SELECT request_id FROM application_publication WHERE request_id=$1', [i.request.requestId])).rowCount, 0);
        if (fail) throw new Error('synthetic_publication_failed');
      });
      await assert.rejects(reserve(true), /^Error: synthetic_publication_failed$/);
      assert.equal(await store.get(i.request.requestId), undefined);
      assert.equal(await new PostgresDirectIssuerRequestStore(pool!).get(i.request.requestId), undefined);
      assert.equal((await query('SELECT request_id FROM application_publication WHERE request_id=$1', [i.request.requestId])).rowCount, 0);
      await reserve(false);
      assert.equal((await store.get(i.request.requestId))?.phase, 'reserved');
      assert.equal((await new PostgresDirectIssuerRequestStore(pool!).get(i.request.requestId))?.state, 'pending');
      assert.deepEqual((await query('SELECT state FROM application_publication WHERE request_id=$1', [i.request.requestId])).rows, [{ state: 'pending' }]);
    });
    await runCase('outer publication failure rolls back completion and preserves its retry lease', async () => {
      let r = await claimed();
      await new PostgresDirectIssuerRequestStore(pool!).create(r.input.request);
      await query('INSERT INTO application_publication VALUES($1,$2)', [r.requestId, 'pending']);
      r = await transition(r, prepare);
      r = await transition(r, { kind: 'submit', submission: { operation: {
        attestationHash: '0x' + r.preparation!.attestationHash, issuerIdHash: r.input.context.issuerIdHash,
        holderRevocationSigner: r.input.request.holderRevocationSigner, requestIdHash: ledgerV2RequestHash(r.requestId),
        issuerKeyEpoch: 1, nonce: '0', deadline: 2_000_000_000 }, signature: '0x' + '1'.repeat(128) + '1b' } });
      const op = r.submission!.operation;
      r = await transition(r, { kind: 'confirm', receipt: { chainId: r.input.context.chainId,
        ledgerAddress: r.input.context.ledgerAddress, attestationHash: op.attestationHash,
        issuerIdHash: op.issuerIdHash, holderRevocationSigner: op.holderRevocationSigner,
        requestIdHash: op.requestIdHash, submissionDigest: recoveryDigest(r.submission),
        transactionHash: '0x' + '4'.repeat(64), blockHash: '0x' + '5'.repeat(64), blockNumber: 1, confirmations: 1 } });
      const before = await row(r.requestId);
      const publish = (fail: boolean) => outerTransaction(async db => {
        const recovery = new TransactionalIssuanceRecoveryStore(db);
        const requests = new PostgresDirectIssuerRequestStore(db);
        const current = await recovery.get(r.requestId);
        assert.deepEqual(current, r);
        await recovery.transition(r.requestId, r.leaseToken!, r.revision, { kind: 'complete' });
        await requests.update({ ...r.input.request, state: 'ready',
          attestationHash: r.preparation!.attestationHash,
          encryptedCredentialEnvelope: r.preparation!.encryptedCredentialEnvelope,
          ledgerTransactionHash: r.receipt!.transactionHash });
        assert.equal((await db.query('UPDATE application_publication SET state=$2 WHERE request_id=$1 AND state=$3', [r.requestId, 'ready', 'pending'])).rowCount, 1);
        assert.deepEqual(await row(r.requestId), before);
        assert.equal((await new PostgresDirectIssuerRequestStore(pool!).get(r.requestId))?.state, 'pending');
        if (fail) throw new Error('synthetic_publication_failed');
      });
      await assert.rejects(publish(true), /^Error: synthetic_publication_failed$/);
      assert.deepEqual(await row(r.requestId), before);
      assert.deepEqual((await query('SELECT state FROM application_publication WHERE request_id=$1', [r.requestId])).rows, [{ state: 'pending' }]);
      await publish(false);
      assert.equal((await projection(r.requestId)).phase, 'completed');
      assert.equal((await new PostgresDirectIssuerRequestStore(pool!).get(r.requestId))?.state, 'ready');
      assert.deepEqual((await query('SELECT state FROM application_publication WHERE request_id=$1', [r.requestId])).rows, [{ state: 'ready' }]);
      await assert.rejects(outerTransaction(db => new TransactionalIssuanceRecoveryStore(db)
        .transition(r.requestId, r.leaseToken!, r.revision, { kind: 'complete' })));
      assert.equal((await projection(r.requestId)).phase, 'completed');
    });
    const admissionInput = () => {
      const { requestId: _id, state: _state, createdAtIso: _created, updatedAtIso: _updated, ...request } = input().request;
      return request;
    };
    const admissionService = (requests = new PostgresDirectIssuerRequestStore(pool!), mode: 'deny' | 'parallel' | 'replace_after_delivery' = 'deny') =>
      createDirectIssuerService({ store: requests, replacementModeFor: async () => mode,
        buildCredential: async () => { throw new Error('admission_must_not_build'); },
        anchorCredential: async () => { throw new Error('admission_must_not_anchor'); },
        revokeReplacedCredential: async () => { throw new Error('admission_must_not_revoke'); } });
    const admissionBarrier = async <T>(start: () => Promise<T>[]): Promise<PromiseSettledResult<T>[]> => {
      const db = await bounded(pool!.connect());
      try {
        await bounded(db.query('BEGIN'));
        const pid = Number((await bounded(db.query('SELECT pg_backend_pid() AS pid'))).rows[0].pid);
        await bounded(db.query('LOCK TABLE unet_attestation_requests_v2 IN SHARE MODE'));
        const attempts = start().map(track);
        await waitLocked(pid, attempts.length);
        await bounded(db.query('COMMIT'));
        return bounded(Promise.allSettled(attempts));
      } finally { try { await bounded(db.query('ROLLBACK')); } finally { db.release(); } }
    };
    await runCase('actual admission concurrent identical retries converge on one durable request', async () => {
      const request = admissionInput(), service = admissionService();
      const results = await admissionBarrier(() => Array.from({ length: 4 }, () => service.createRequest(request)));
      const values = results.map(result => { assert.equal(result.status, 'fulfilled'); return (result as PromiseFulfilledResult<Awaited<ReturnType<typeof service.createRequest>>>).value; });
      values.forEach(value => assert.deepEqual(value, values[0]));
      assert.deepEqual(Object.keys(values[0]).sort(), ['replacementRequired', 'requestId', 'state']);
      assert.equal((await query('SELECT count(*)::int AS count FROM unet_attestation_requests_v2 WHERE service_account_ref=$1', [request.serviceAccountRef])).rows[0].count, 1);
      assert.equal((await new PostgresDirectIssuerRequestStore(pool!).get(values[0].requestId))?.deliveryCapabilityHash, request.deliveryCapabilityHash);
    });
    await runCase('actual deny admission serializes competing idempotency keys', async () => {
      const request = admissionInput(), service = admissionService();
      const results = await admissionBarrier(() => [service.createRequest(request), service.createRequest({ ...request, idempotencyKey: 'competing' })]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
      assert.equal(failure.reason?.message, 'active_credential_exists');
    });
    await runCase('actual admission rejects conflicting intent without altering the winner', async () => {
      const request = admissionInput(), service = admissionService();
      const results = await admissionBarrier(() => [service.createRequest(request), service.createRequest({ ...request, deliveryCapabilityHash: 'b'.repeat(64) })]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
      assert.equal(failure.reason?.message, 'issuer_request_idempotency_conflict');
      assert.equal((await query('SELECT count(*)::int AS count FROM unet_attestation_requests_v2 WHERE service_account_ref=$1', [request.serviceAccountRef])).rows[0].count, 1);
    });
    await runCase('lost COMMIT response is recovered by an identical admission retry', async () => {
      let loseResponse = true;
      const responseLossPool: SqlPool = { query: (sql, values) => pool!.query(sql, values), connect: async () => {
        const db = await pool!.connect();
        return { release: destroy => db.release(destroy), query: async <T extends Record<string, unknown>>(sql: string, values?: unknown[]) => {
          const result = await db.query<T>(sql, values);
          if (sql === 'COMMIT' && loseResponse) { loseResponse = false; throw new Error('synthetic_commit_response_lost'); }
          return result;
        } };
      } };
      const request = admissionInput();
      await assert.rejects(track(admissionService(new PostgresDirectIssuerRequestStore(responseLossPool)).createRequest(request)), /^Error: synthetic_commit_response_lost$/);
      const service = admissionService(), recovered = await track(service.createRequest(request));
      assert.deepEqual(await track(service.createRequest(request)), recovered);
      assert.equal((await query('SELECT count(*)::int AS count FROM unet_attestation_requests_v2 WHERE service_account_ref=$1', [request.serviceAccountRef])).rows[0].count, 1);
    });
    await runCase('account-wide idempotency cannot admit the same operation under another check', async () => {
      const request = admissionInput(), service = admissionService(undefined, 'parallel');
      const results = await admissionBarrier(() => [service.createRequest(request), service.createRequest({ ...request, checkId: 'other-check' })]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason?.message, 'issuer_request_idempotency_conflict');
      assert.equal((await query('SELECT count(*)::int AS count FROM unet_attestation_requests_v2 WHERE service_account_ref=$1', [request.serviceAccountRef])).rows[0].count, 1);
    });
    await runCase('admission transaction rollback leaves no request and permits retry', async () => {
      const request = input().request, requests = new PostgresDirectIssuerRequestStore(pool!);
      await assert.rejects(track(requests.withAccountTransaction(request.serviceAccountRef, request.checkId, async tx => {
        await tx.create(request);
        assert.equal(await requests.get(request.requestId), undefined);
        throw new Error('synthetic_admission_failure');
      })), /^Error: synthetic_admission_failure$/);
      assert.equal(await requests.get(request.requestId), undefined);
      await track(requests.withAccountTransaction(request.serviceAccountRef, request.checkId, tx => tx.create(request)));
      assert.equal((await requests.get(request.requestId))?.state, 'pending');
    });
    await runCase('concurrent renewal converges and remains replayable after parent revocation', async () => {
      const requests = new PostgresDirectIssuerRequestStore(pool!);
      const parent = input().request;
      const bearer = randomBytes(32).toString('base64url');
      parent.deliveryCapabilityHash = createHash('sha256').update(bearer).digest('hex');
      parent.state = 'delivered'; parent.attestationHash = 'e'.repeat(64);
      await requests.create(parent);
      const service = admissionService(requests, 'replace_after_delivery');
      const renewal = { requestId: parent.requestId, deliveryCapability: bearer, deliveryCapabilityHash: 'f'.repeat(64),
        holderBinding: 'next-holder', deliveryPublicKey: 'next-public-key', holderRevocationSigner: parent.holderRevocationSigner, idempotencyKey: 'next-request' };
      const results = await admissionBarrier(() => [service.createRenewalRequest(renewal), service.createRenewalRequest(renewal)]);
      const first = results[0], second = results[1];
      assert.equal(first.status, 'fulfilled'); assert.equal(second.status, 'fulfilled');
      if (first.status !== 'fulfilled' || second.status !== 'fulfilled') throw new Error('renewal_failed');
      assert.deepEqual(first.value, second.value);
      assert.equal((await requests.get(first.value.requestId))?.renewalOfRequestId, parent.requestId);
      await requests.update({ ...parent, state: 'revoked' });
      assert.deepEqual(await service.createRenewalRequest(renewal), first.value);
      await assert.rejects(service.createRenewalRequest({ ...renewal, deliveryCapability: 'wrong' }), /^Error: renewal_capability_invalid$/);
    });
    assert.equal(cases, caseCount);
    assert.equal(fetchCalls, 0);
    assert.equal(poolErrors, 0);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    console.log(JSON.stringify({ kind: 'issuance-postgres-failure', completedCases: cases,
      code: ['ERR_ASSERTION', 'ETIMEDOUT', 'ECONNREFUSED', '55P03', '57014'].includes(String(code)) ? code : 'acceptance_failed' }));
    throw new Error('issuance_postgres_acceptance_failed');
  } finally {
    for (const release of releases) release();
    try {
      await bounded(Promise.allSettled(workers));
      if (createdSchema) {
        await verifyFixture();
        await verifySchema();
        await query('DROP SCHEMA "' + schema + '" CASCADE');
        assert.equal((await query('SELECT oid FROM pg_catalog.pg_namespace WHERE nspname=$1', [schema])).rowCount, 0);
        await verifyFixture();
      }
      cleanupComplete = true;
    } catch {
      console.log(JSON.stringify({ kind: 'issuance-postgres-failure', completedCases: cases, code: 'acceptance_failed' }));
      throw new Error('issuance_postgres_cleanup_failed');
    } finally {
      try {
        if (pool) await bounded(pool.end());
      } catch {
        cleanupComplete = false;
        throw new Error('issuance_postgres_pool_cleanup_failed');
      } finally { globalThis.fetch = originalFetch; }
    }
  }
  assert.equal(cleanupComplete, true);
  console.log(JSON.stringify({ kind: 'issuance-postgres-acceptance', passed: true, cases,
    cleanupComplete: true, ledger: 'synthetic-only' }));
});
