import type { DirectIssuerRequestRecord, DirectIssuerRequestStore } from './directIssuer.js';

export interface SqlClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

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

export class PostgresDirectIssuerRequestStore implements DirectIssuerRequestStore {
  public constructor(private readonly db: SqlClient) {}

  public async create(record: DirectIssuerRequestRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO unet_attestation_requests_v2(request_id,service_account_ref,check_id,idempotency_key,state,attestation_hash,request_record,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [record.requestId, record.serviceAccountRef, record.checkId, record.idempotencyKey, record.state, record.attestationHash ?? null, record, record.createdAtIso, record.updatedAtIso],
    );
  }

  public async get(requestId: string): Promise<DirectIssuerRequestRecord | undefined> {
    const result = await this.db.query<{ request_record: DirectIssuerRequestRecord }>(
      'SELECT request_record FROM unet_attestation_requests_v2 WHERE request_id=$1',
      [requestId],
    );
    return result.rows[0]?.request_record;
  }

  public async findByIdempotency(serviceAccountRef: string, idempotencyKey: string): Promise<DirectIssuerRequestRecord | undefined> {
    const result = await this.db.query<{ request_record: DirectIssuerRequestRecord }>(
      'SELECT request_record FROM unet_attestation_requests_v2 WHERE service_account_ref=$1 AND idempotency_key=$2',
      [serviceAccountRef, idempotencyKey],
    );
    return result.rows[0]?.request_record;
  }

  public async findActive(serviceAccountRef: string, checkId: string): Promise<DirectIssuerRequestRecord[]> {
    const result = await this.db.query<{ request_record: DirectIssuerRequestRecord }>(
      `SELECT request_record FROM unet_attestation_requests_v2
       WHERE service_account_ref=$1 AND check_id=$2 AND state IN ('ready','delivered')
       ORDER BY created_at DESC`,
      [serviceAccountRef, checkId],
    );
    return result.rows.map((row) => row.request_record);
  }

  public async findByAttestationHash(attestationHash: string): Promise<DirectIssuerRequestRecord | undefined> {
    const result = await this.db.query<{ request_record: DirectIssuerRequestRecord }>(
      'SELECT request_record FROM unet_attestation_requests_v2 WHERE attestation_hash=$1 LIMIT 1',
      [attestationHash],
    );
    return result.rows[0]?.request_record;
  }

  public async list(input: { state?: DirectIssuerRequestRecord['state']; serviceAccountRef?: string; limit?: number } = {}): Promise<DirectIssuerRequestRecord[]> {
    const limit = Math.min(500, Math.max(1, input.limit ?? 100));
    const result = await this.db.query<{ request_record: DirectIssuerRequestRecord }>(
      `SELECT request_record FROM unet_attestation_requests_v2
       WHERE ($1::text IS NULL OR state=$1) AND ($2::text IS NULL OR service_account_ref=$2)
       ORDER BY created_at DESC LIMIT $3`,
      [input.state ?? null, input.serviceAccountRef ?? null, limit],
    );
    return result.rows.map((row) => row.request_record);
  }

  public async update(record: DirectIssuerRequestRecord): Promise<void> {
    const result = await this.db.query(
      `UPDATE unet_attestation_requests_v2
       SET state=$2,attestation_hash=$3,request_record=$4,updated_at=$5
       WHERE request_id=$1`,
      [record.requestId, record.state, record.attestationHash ?? null, record, record.updatedAtIso],
    );
    if (result.rowCount === 0) throw new Error('issuer_request_not_found');
  }
}
