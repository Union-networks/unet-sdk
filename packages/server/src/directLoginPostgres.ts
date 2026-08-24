import type {
  DirectLoginAccountStore,
  DirectLoginChallengeRecord,
  DirectLoginChallengeStore,
} from './directLogin.js';

export interface SqlClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export async function ensureDirectLoginSchema(db: SqlClient): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS unet_service_accounts_v2 (
      scoped_user_id TEXT PRIMARY KEY,
      account_public_key_pem TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','retired')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      retired_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS unet_direct_login_challenges_v2 (
      request_ref TEXT PRIMARY KEY,
      record JSONB NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','approved','consumed','expired')),
      expires_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS unet_direct_login_expiry_idx ON unet_direct_login_challenges_v2(expires_at);
  `);
}

export class PostgresDirectLoginChallengeStore implements DirectLoginChallengeStore {
  public constructor(private readonly db: SqlClient) {}

  public async create(record: DirectLoginChallengeRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO unet_direct_login_challenges_v2(request_ref,record,state,expires_at)
       VALUES($1,$2,$3,$4)`,
      [record.requestRef, record, record.state, record.expiresAtIso],
    );
  }

  public async get(requestRef: string): Promise<DirectLoginChallengeRecord | undefined> {
    const result = await this.db.query<{ record: DirectLoginChallengeRecord }>(
      'SELECT record FROM unet_direct_login_challenges_v2 WHERE request_ref=$1',
      [requestRef],
    );
    return result.rows[0]?.record;
  }

  public async getBySessionId(sessionId: string): Promise<DirectLoginChallengeRecord | undefined> {
    const result = await this.db.query<{ record: DirectLoginChallengeRecord }>(
      "SELECT record FROM unet_direct_login_challenges_v2 WHERE record->'session'->>'sessionId'=$1",
      [sessionId],
    );
    return result.rows[0]?.record;
  }

  public async update(record: DirectLoginChallengeRecord): Promise<void> {
    const result = await this.db.query(
      `UPDATE unet_direct_login_challenges_v2
       SET record=$2,state=$3,expires_at=$4,updated_at=now()
       WHERE request_ref=$1`,
      [record.requestRef, record, record.state, record.expiresAtIso],
    );
    if (result.rowCount === 0) throw new Error('direct_login_not_found');
  }

  public async consume(requestRef: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE unet_direct_login_challenges_v2
       SET state='consumed',record=jsonb_set(record,'{state}','"consumed"'::jsonb),updated_at=now()
       WHERE request_ref=$1 AND state='approved' AND expires_at>now()`,
      [requestRef],
    );
    return (result.rowCount ?? 0) === 1;
  }
}

export class PostgresDirectLoginAccountStore implements DirectLoginAccountStore {
  public constructor(private readonly db: SqlClient) {}

  public async getPublicKey(scopedUserId: string): Promise<string | undefined> {
    const result = await this.db.query<{ account_public_key_pem: string }>(
      "SELECT account_public_key_pem FROM unet_service_accounts_v2 WHERE scoped_user_id=$1 AND status='active'",
      [scopedUserId],
    );
    return result.rows[0]?.account_public_key_pem;
  }

  public async bindPublicKey(scopedUserId: string, publicKeyPem: string): Promise<'created' | 'existing'> {
    const inserted = await this.db.query<{ account_public_key_pem: string }>(
      `INSERT INTO unet_service_accounts_v2(scoped_user_id,account_public_key_pem,status)
       VALUES($1,$2,'active') ON CONFLICT(scoped_user_id) DO NOTHING
       RETURNING account_public_key_pem`,
      [scopedUserId, publicKeyPem],
    );
    if (inserted.rows[0]) return 'created';
    const existing = await this.db.query<{ account_public_key_pem: string; status: string }>(
      'SELECT account_public_key_pem,status FROM unet_service_accounts_v2 WHERE scoped_user_id=$1',
      [scopedUserId],
    );
    if (existing.rows[0]?.status !== 'active') throw new Error('service_account_retired');
    if (existing.rows[0]?.account_public_key_pem !== publicKeyPem) throw new Error('direct_login_account_key_mismatch');
    return 'existing';
  }

  public async retire(scopedUserId: string): Promise<void> {
    await this.db.query(
      "UPDATE unet_service_accounts_v2 SET status='retired',retired_at=COALESCE(retired_at,now()) WHERE scoped_user_id=$1",
      [scopedUserId],
    );
  }
}
