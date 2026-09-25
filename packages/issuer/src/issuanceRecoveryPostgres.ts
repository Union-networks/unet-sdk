import { randomUUID } from 'node:crypto';
import type { SqlClient } from './directIssuerPostgres.js';
import {
  claimRecoveryRecord, createRecoveryRecord, transitionRecoveryRecord, validateRecoveryRecord,
  type RecoveryAction, type RecoveryInput, type RecoveryRecord,
} from './issuanceRecovery.js';

export interface SqlPool extends SqlClient {
  connect(): Promise<SqlClient & { release(destroy?: boolean): void }>;
}

export async function ensureIssuanceRecoverySchema(db: SqlClient): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS unet_issuance_recovery_v2 (
      request_id TEXT PRIMARY KEY,
      record JSONB NOT NULL,
      revision BIGINT NOT NULL,
      phase TEXT NOT NULL,
      lease_token TEXT,
      lease_until TIMESTAMPTZ,
      next_attempt_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS unet_issuance_recovery_ready_v2_idx
      ON unet_issuance_recovery_v2(phase,next_attempt_at,lease_until);
  `);
}

async function transaction<T>(pool: SqlPool, work: (db: SqlClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  let discard = false;
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout = '5s'");
    await db.query("SET LOCAL statement_timeout = '10s'");
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); }
    catch { discard = true; }
    throw error;
  } finally {
    if (discard) db.release(true);
    else db.release();
  }
}

async function databaseNow(db: SqlClient): Promise<number> {
  const result = await db.query<{ now_ms: string | number }>(
    'SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms',
  );
  const value = result.rows[0]?.now_ms;
  const nowMs = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof nowMs !== 'number' || !Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error('issuance_recovery_invalid_database_time');
  }
  return nowMs;
}

const projection = `request_id,record,revision,phase,lease_token,
  extract(epoch FROM lease_until) * 1000 AS lease_until_ms,
  extract(epoch FROM next_attempt_at) * 1000 AS next_attempt_at_ms,
  extract(epoch FROM created_at) * 1000 AS created_at_ms,
  extract(epoch FROM updated_at) * 1000 AS updated_at_ms`;

function matchesInteger(value: unknown, expected: number): boolean {
  if (typeof value === 'string' && /^\d+(?:\.0+)?$/.test(value)) value = Number(value);
  return typeof value === 'number' && Number.isSafeInteger(value) && value === expected;
}

async function readRecord(db: SqlClient, requestId: string, lock: boolean): Promise<RecoveryRecord | undefined> {
  const result = await db.query(
    `SELECT ${projection} FROM unet_issuance_recovery_v2 WHERE request_id=$1${lock ? ' FOR UPDATE' : ''}`,
    [requestId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const record = structuredClone(row.record) as RecoveryRecord;
  try {
    validateRecoveryRecord(record);
  } catch {
    throw new Error('issuance_recovery_record_invalid');
  }
  if (row.request_id !== requestId || record.requestId !== requestId
    || !matchesInteger(row.revision, record.revision) || row.phase !== record.phase
    || row.lease_token !== (record.leaseToken ?? null)
    || (record.leaseUntilMs === undefined ? row.lease_until_ms !== null : !matchesInteger(row.lease_until_ms, record.leaseUntilMs))
    || !matchesInteger(row.next_attempt_at_ms, record.nextAttemptAtMs)
    || !matchesInteger(row.created_at_ms, record.createdAtMs)
    || !matchesInteger(row.updated_at_ms, record.updatedAtMs)) {
    throw new Error('issuance_recovery_projection_invalid');
  }
  return record;
}

function values(record: RecoveryRecord): unknown[] {
  validateRecoveryRecord(record);
  return [
    record.requestId, record, record.revision, record.phase, record.leaseToken ?? null,
    record.leaseUntilMs === undefined ? null : new Date(record.leaseUntilMs).toISOString(),
    new Date(record.nextAttemptAtMs).toISOString(), new Date(record.createdAtMs).toISOString(),
    new Date(record.updatedAtMs).toISOString(),
  ];
}

async function updateRecord(db: SqlClient, previous: RecoveryRecord, next: RecoveryRecord, mode: 'claim' | 'transition'): Promise<void> {
  const guard = mode === 'claim' ? '$6::timestamptz>clock_timestamp()' : 'lease_token=$11 AND lease_until>clock_timestamp()';
  const result = await db.query(
    `UPDATE unet_issuance_recovery_v2
     SET record=$2,revision=$3,phase=$4,lease_token=$5,lease_until=$6,next_attempt_at=$7,created_at=$8,updated_at=$9
     WHERE request_id=$1 AND revision=$10 AND ${guard}`,
    [...values(next), previous.revision, ...(mode === 'transition' ? [previous.leaseToken] : [])],
  );
  if (result.rowCount !== 1) throw new Error('issuance_recovery_lease_lost');
}

// Internal adapter only; deliberately absent from the package's public entry point.
export class PostgresIssuanceRecoveryStore {
  public constructor(private readonly pool: SqlPool) {}

  public async reserve(input: RecoveryInput): Promise<RecoveryRecord> {
    const snapshot = createRecoveryRecord(input, 0).input;
    return transaction(this.pool, async (db) => {
      let record = await readRecord(db, snapshot.request.requestId, true);
      const candidate = createRecoveryRecord(snapshot, await databaseNow(db));
      if (!record) {
        await db.query(
          `INSERT INTO unet_issuance_recovery_v2
           (request_id,record,revision,phase,lease_token,lease_until,next_attempt_at,created_at,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(request_id) DO NOTHING`,
          values(candidate),
        );
        // Another reservation can win after the absent-row read; compare its locked record.
        record = await readRecord(db, candidate.requestId, true);
      }
      if (!record) throw new Error('issuance_recovery_not_found');
      if (record.inputDigest !== candidate.inputDigest) throw new Error('issuance_recovery_input_conflict');
      return record;
    });
  }

  public async get(requestId: string): Promise<RecoveryRecord | undefined> {
    return transaction(this.pool, db => readRecord(db, requestId, false));
  }

  public async claim(requestId: string): Promise<RecoveryRecord | undefined> {
    return transaction(this.pool, async (db) => {
      const record = await readRecord(db, requestId, true);
      if (!record) return undefined;
      // Time must be sampled separately after the row lock has been acquired.
      const nowMs = await databaseNow(db);
      const next = claimRecoveryRecord(record, randomUUID(), nowMs);
      if (next) await updateRecord(db, record, next, 'claim');
      return next;
    });
  }

  public async transition(requestId: string, token: string, revision: number, action: RecoveryAction): Promise<RecoveryRecord> {
    const snapshot = structuredClone(action);
    return transaction(this.pool, async (db) => {
      const record = await readRecord(db, requestId, true);
      if (!record) throw new Error('issuance_recovery_not_found');
      const next = transitionRecoveryRecord(record, token, revision, snapshot, await databaseNow(db));
      await updateRecord(db, record, next, 'transition');
      return next;
    });
  }
}
