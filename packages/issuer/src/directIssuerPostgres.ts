import { createHash } from 'node:crypto';
import type { DirectIssuerRequestRecord, DirectIssuerRequestStore } from './directIssuer.js';

/** @public */
export interface SqlClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

interface SqlPool extends SqlClient {
  connect(): Promise<SqlClient & { release(destroy?: boolean): void }>;
}

function accountLockKey(serviceAccountRef: string, checkId: string): string {
  for (const value of [serviceAccountRef, checkId]) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')
      || value.length > 1024 || Buffer.byteLength(value, 'utf8') > 1024) {
      throw new Error('issuer_account_transaction_scope_invalid');
    }
  }
  // Tuple encoding preserves exact identities without ambiguous separators or raw SQL values.
  return createHash('sha256').update(JSON.stringify([
    'unet:direct-issuer:admission:v1', serviceAccountRef, checkId,
  ])).digest().readBigInt64BE(0).toString();
}

/** @public */
export async function ensureDirectIssuerSchema(db: SqlClient): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS unet_attestation_requests_v2 (
      request_id TEXT PRIMARY KEY,
      service_account_ref TEXT NOT NULL,
      check_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','anchoring','ready','delivered','denied','failed','revoked')),
      attestation_hash TEXT,
      request_record JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      UNIQUE(service_account_ref,idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS unet_attestation_active_v2_idx
      ON unet_attestation_requests_v2(service_account_ref,check_id,state);
  `);
  await db.query(`
    ALTER TABLE unet_attestation_requests_v2 DROP CONSTRAINT IF EXISTS unet_attestation_requests_v2_state_check;
    ALTER TABLE unet_attestation_requests_v2 ADD CONSTRAINT unet_attestation_requests_v2_state_check
      CHECK(state IN ('pending','anchoring','ready','delivered','denied','failed','revoked'));
  `);
}

/** @public */
export class PostgresDirectIssuerRequestStore implements DirectIssuerRequestStore {
  private transactionScope?: { serviceAccountRef: string; checkId: string };

  public constructor(private readonly db: SqlClient) {}

  public async withAccountTransaction<T>(
    serviceAccountRef: string,
    checkId: string,
    work: (store: DirectIssuerRequestStore) => Promise<T>,
  ): Promise<T> {
    if (this.transactionScope) throw new Error('issuer_account_transaction_nested');
    const key = accountLockKey(serviceAccountRef, checkId);
    const scope = { serviceAccountRef, checkId };
    if (!('connect' in this.db) || typeof this.db.connect !== 'function') {
      throw new Error('issuer_account_transaction_pool_required');
    }
    const db = await (this.db as SqlPool).connect();
    if (!db || typeof db.query !== 'function' || typeof db.release !== 'function') {
      throw new Error('issuer_account_transaction_pool_required');
    }
    let discard = false;
    let active = true;
    const bound = new PostgresDirectIssuerRequestStore({
      query: (text, values) => {
        if (!active) throw new Error('issuer_account_transaction_closed');
        return db.query(text, values);
      },
    });
    bound.transactionScope = scope;
    try {
      await db.query('BEGIN');
      await db.query("SET LOCAL lock_timeout = '5s'");
      await db.query("SET LOCAL statement_timeout = '10s'");
      await db.query('SELECT pg_advisory_xact_lock($1::bigint)', [key]);
      const result = await work(bound);
      active = false;
      await db.query('COMMIT');
      return result;
    } catch (error) {
      active = false;
      try { await db.query('ROLLBACK'); }
      catch { discard = true; }
      throw error;
    } finally {
      active = false;
      if (discard) db.release(true);
      else db.release();
    }
  }

  private assertScope(serviceAccountRef: string, checkId: string | undefined): void {
    if (this.transactionScope && (serviceAccountRef !== this.transactionScope.serviceAccountRef
      || checkId !== this.transactionScope.checkId)) {
      throw new Error('issuer_account_transaction_scope_mismatch');
    }
  }

  public async create(record: DirectIssuerRequestRecord): Promise<void> {
    if (this.transactionScope) {
      record = structuredClone(record);
      this.assertScope(record.serviceAccountRef, record.checkId);
    }
    try {
      await this.db.query(
        `INSERT INTO unet_attestation_requests_v2(request_id,service_account_ref,check_id,idempotency_key,state,attestation_hash,request_record,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [record.requestId, record.serviceAccountRef, record.checkId, record.idempotencyKey, record.state, record.attestationHash ?? null, record, record.createdAtIso, record.updatedAtIso],
      );
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new Error('issuer_request_idempotency_conflict');
      }
      throw error;
    }
  }

  public async get(requestId: string): Promise<DirectIssuerRequestRecord | undefined> {
    const scope = this.transactionScope;
    const result = await this.db.query<{ request_record: DirectIssuerRequestRecord }>(
      `SELECT request_record FROM unet_attestation_requests_v2 WHERE request_id=$1${scope ? ' AND service_account_ref=$2 AND check_id=$3 FOR UPDATE' : ''}`,
      scope ? [requestId, scope.serviceAccountRef, scope.checkId] : [requestId],
    );
    return result.rows[0]?.request_record;
  }

  public async findByIdempotency(serviceAccountRef: string, idempotencyKey: string): Promise<DirectIssuerRequestRecord | undefined> {
    this.assertScope(serviceAccountRef, this.transactionScope?.checkId);
    const scope = this.transactionScope;
    const result = await this.db.query<{ request_record: DirectIssuerRequestRecord }>(
      `SELECT request_record FROM unet_attestation_requests_v2 WHERE service_account_ref=$1 AND idempotency_key=$2${scope ? ' AND check_id=$3 FOR UPDATE' : ''}`,
      scope ? [serviceAccountRef, idempotencyKey, scope.checkId] : [serviceAccountRef, idempotencyKey],
    );
    return result.rows[0]?.request_record;
  }

  public async findActive(serviceAccountRef: string, checkId: string): Promise<DirectIssuerRequestRecord[]> {
    this.assertScope(serviceAccountRef, checkId);
    const result = await this.db.query<{ request_record: DirectIssuerRequestRecord }>(
      `SELECT request_record FROM unet_attestation_requests_v2
       WHERE service_account_ref=$1 AND check_id=$2 AND state IN ('ready','delivered')
       ORDER BY created_at DESC${this.transactionScope ? ' FOR UPDATE' : ''}`,
      [serviceAccountRef, checkId],
    );
    return result.rows.map((row) => row.request_record);
  }

  public async findPending(serviceAccountRef: string, checkId: string): Promise<DirectIssuerRequestRecord[]> {
    this.assertScope(serviceAccountRef, checkId);
    const result = await this.db.query<{ request_record: DirectIssuerRequestRecord }>(
      `SELECT request_record FROM unet_attestation_requests_v2
       WHERE service_account_ref=$1 AND check_id=$2 AND state IN ('pending','anchoring')
       ORDER BY created_at DESC,request_id DESC${this.transactionScope ? ' FOR UPDATE' : ''}`,
      [serviceAccountRef, checkId],
    );
    return result.rows.map((row) => row.request_record);
  }

  public async findByAttestationHash(attestationHash: string): Promise<DirectIssuerRequestRecord | undefined> {
    const scope = this.transactionScope;
    const result = await this.db.query<{ request_record: DirectIssuerRequestRecord }>(
      `SELECT request_record FROM unet_attestation_requests_v2 WHERE attestation_hash=$1${scope ? ' AND service_account_ref=$2 AND check_id=$3' : ''} LIMIT 1${scope ? ' FOR UPDATE' : ''}`,
      scope ? [attestationHash, scope.serviceAccountRef, scope.checkId] : [attestationHash],
    );
    return result.rows[0]?.request_record;
  }

  public async list(input: { state?: DirectIssuerRequestRecord['state']; serviceAccountRef?: string; limit?: number } = {}): Promise<DirectIssuerRequestRecord[]> {
    const scope = this.transactionScope;
    if (input.serviceAccountRef !== undefined) this.assertScope(input.serviceAccountRef, scope?.checkId);
    const limit = Math.min(500, Math.max(1, input.limit ?? 100));
    const result = await this.db.query<{ request_record: DirectIssuerRequestRecord }>(
      `SELECT request_record FROM unet_attestation_requests_v2
       WHERE ($1::text IS NULL OR state=$1) AND ($2::text IS NULL OR service_account_ref=$2)${scope ? ' AND check_id=$4' : ''}
       ORDER BY created_at DESC LIMIT $3`,
      scope ? [input.state ?? null, scope.serviceAccountRef, limit, scope.checkId]
        : [input.state ?? null, input.serviceAccountRef ?? null, limit],
    );
    return result.rows.map((row) => row.request_record);
  }

  public async update(record: DirectIssuerRequestRecord): Promise<void> {
    const scope = this.transactionScope;
    if (scope) {
      record = structuredClone(record);
      this.assertScope(record.serviceAccountRef, record.checkId);
    }
    const result = await this.db.query(
      `UPDATE unet_attestation_requests_v2
       SET state=$2,attestation_hash=$3,request_record=$4,updated_at=$5
       WHERE request_id=$1${scope ? ' AND service_account_ref=$6 AND check_id=$7 AND idempotency_key=$8' : ''}`,
      [record.requestId, record.state, record.attestationHash ?? null, record, record.updatedAtIso,
        ...(scope ? [scope.serviceAccountRef, scope.checkId, record.idempotencyKey] : [])],
    );
    if (result.rowCount === 0) throw new Error('issuer_request_not_found');
  }
}
