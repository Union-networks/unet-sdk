import { randomBytes } from 'node:crypto';
import type {
  DirectLoginRetirementStore,
  DirectLoginBrowserResult,
  ServiceAccountRetirement,
  DirectLoginChallengeRecord,
  DirectLoginChallengeStore,
} from './directLogin.js';
import { authorizeDirectLoginBrowser } from './directLogin.js';

/** @public */
export interface SqlClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

/** @public */
export interface DirectLoginSqlPool extends SqlClient {
  connect(): Promise<SqlClient & { release(): void }>;
}

async function transaction<T>(pool: DirectLoginSqlPool, work: (db: SqlClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { db.release(); }
}

/** @public */
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
    CREATE TABLE IF NOT EXISTS unet_account_retirement_jobs_v2 (
      operation_id TEXT PRIMARY KEY,
      scoped_user_id TEXT NOT NULL REFERENCES unet_service_accounts_v2(scoped_user_id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','complete')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ
    );
    ALTER TABLE unet_account_retirement_jobs_v2 ADD COLUMN IF NOT EXISTS lease_token TEXT;
    ALTER TABLE unet_account_retirement_jobs_v2 ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;
    ALTER TABLE unet_account_retirement_jobs_v2 ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE unet_account_retirement_jobs_v2 ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();
    CREATE INDEX IF NOT EXISTS unet_retirement_ready_idx ON unet_account_retirement_jobs_v2(next_attempt_at,created_at) WHERE status='pending';
  `);
}

/** @public */
export class PostgresDirectLoginChallengeStore implements DirectLoginChallengeStore {
  public constructor(private readonly db: DirectLoginSqlPool) {}

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

  public async approve(record: DirectLoginChallengeRecord, _nowIso: string): Promise<void> {
    await transaction(this.db, async (db) => {
      const result = await db.query<{ record: DirectLoginChallengeRecord }>(
        'SELECT record FROM unet_direct_login_challenges_v2 WHERE request_ref=$1 AND expires_at>clock_timestamp() FOR UPDATE', [record.requestRef],
      );
      const previous = result.rows[0]?.record;
      if (!previous || previous.state !== 'pending' || !previous.redemptionChallenge) throw new Error('direct_login_not_pending');
      if (!record.approvedAccount || !record.session) throw new Error('direct_login_approval_invalid');
      const { scopedUserId, accountPublicKeyPem } = record.approvedAccount;
      await db.query("INSERT INTO unet_service_accounts_v2(scoped_user_id,account_public_key_pem,status) VALUES($1,$2,'active') ON CONFLICT(scoped_user_id) DO NOTHING", [scopedUserId, accountPublicKeyPem]);
      const account = await db.query<{ status: string; account_public_key_pem: string }>(
        'SELECT status,account_public_key_pem FROM unet_service_accounts_v2 WHERE scoped_user_id=$1 FOR UPDATE', [scopedUserId],
      );
      if (account.rows[0]?.status !== 'active') throw new Error('service_account_retired');
      if (account.rows[0]?.account_public_key_pem !== accountPublicKeyPem) throw new Error('direct_login_account_key_mismatch');
      const clock = await db.query<{ now: Date }>('SELECT clock_timestamp() AS now');
      if (Date.parse(previous.expiresAtIso) <= new Date(clock.rows[0]!.now).getTime()
        || Date.parse(record.session.expiresAtIso) <= new Date(clock.rows[0]!.now).getTime()) throw new Error('direct_login_not_pending');
      const approved = { ...previous, state: 'approved', approvedAccount: record.approvedAccount, session: record.session };
      await db.query("UPDATE unet_direct_login_challenges_v2 SET record=$2,state='approved',updated_at=now() WHERE request_ref=$1", [record.requestRef, approved]);
    });
  }

  public async browserAccess(requestRef: string, challenge: string, _nowIso: string, consume: boolean): Promise<DirectLoginBrowserResult> {
    return transaction(this.db, async (db) => {
      const result = await db.query<{ record: DirectLoginChallengeRecord }>(
        'SELECT record FROM unet_direct_login_challenges_v2 WHERE request_ref=$1 FOR UPDATE', [requestRef],
      );
      const record = result.rows[0]?.record;
      // Sample database time after all locks, not before waiting on another request.
      if (record?.approvedAccount) {
        const account = await db.query<{ status: string }>('SELECT status FROM unet_service_accounts_v2 WHERE scoped_user_id=$1 FOR SHARE', [record.approvedAccount.scopedUserId]);
        if (account.rows[0]?.status !== 'active') return { error: 'direct_login_not_approved' };
      }
      const clock = await db.query<{ now: Date }>('SELECT clock_timestamp() AS now');
      const outcome = authorizeDirectLoginBrowser(record, challenge, new Date(clock.rows[0]!.now).toISOString(), consume);
      if (record) {
        await db.query('UPDATE unet_direct_login_challenges_v2 SET record=$2,state=$3,updated_at=now() WHERE request_ref=$1', [requestRef, record, record.state]);
      }
      // Commit failed-attempt accounting too; throw only outside the transaction.
      return outcome;
    });
  }
}

/** @public */
export class PostgresDirectLoginAccountStore implements DirectLoginRetirementStore {
  public constructor(private readonly db: DirectLoginSqlPool) {}

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

  public async getRetirementPublicKey(scopedUserId: string): Promise<string | undefined> {
    const result = await this.db.query<{ account_public_key_pem: string }>('SELECT account_public_key_pem FROM unet_service_accounts_v2 WHERE scoped_user_id=$1', [scopedUserId]);
    return result.rows[0]?.account_public_key_pem;
  }

  public async retireWithCleanup(retirement: ServiceAccountRetirement): Promise<void> {
    await transaction(this.db, async (db) => {
      const result = await db.query("UPDATE unet_service_accounts_v2 SET status='retired',retired_at=COALESCE(retired_at,now()) WHERE scoped_user_id=$1 RETURNING scoped_user_id", [retirement.scopedUserId]);
      if (!result.rowCount) throw new Error('service_account_retirement_unknown');
      await db.query('INSERT INTO unet_account_retirement_jobs_v2(operation_id,scoped_user_id) VALUES($1,$2) ON CONFLICT(operation_id) DO NOTHING', [retirement.operationId, retirement.scopedUserId]);
      const job = await db.query<{ scoped_user_id: string }>('SELECT scoped_user_id FROM unet_account_retirement_jobs_v2 WHERE operation_id=$1', [retirement.operationId]);
      if (job.rows[0]?.scoped_user_id !== retirement.scopedUserId) throw new Error('service_account_retirement_mismatch');
    });
  }

  public async pendingRetirements(limit: number): Promise<Array<{ operationId: string; scopedUserId: string }>> {
    const jobs = await this.db.query<{ operation_id: string; scoped_user_id: string }>("SELECT operation_id,scoped_user_id FROM unet_account_retirement_jobs_v2 WHERE status='pending' ORDER BY created_at,operation_id LIMIT $1", [Math.max(1, Math.min(100, limit))]);
    return jobs.rows.map((job) => ({ operationId: job.operation_id, scopedUserId: job.scoped_user_id }));
  }

  public async claimRetirements(limit: number): Promise<Array<{ operationId: string; scopedUserId: string; leaseToken: string }>> {
    const leaseToken = randomBytes(24).toString('base64url');
    const result = await this.db.query<{ operation_id: string; scoped_user_id: string }>(`
      WITH ready AS (
        SELECT operation_id FROM unet_account_retirement_jobs_v2
        WHERE status='pending' AND next_attempt_at<=clock_timestamp()
          AND (lease_until IS NULL OR lease_until<=clock_timestamp())
        ORDER BY next_attempt_at,created_at,operation_id LIMIT $1 FOR UPDATE SKIP LOCKED
      )
      UPDATE unet_account_retirement_jobs_v2 job
      SET lease_token=$2,lease_until=clock_timestamp()+interval '120 seconds',attempts=attempts+1
      FROM ready WHERE job.operation_id=ready.operation_id
      RETURNING job.operation_id,job.scoped_user_id
    `, [Math.max(1, Math.min(100, limit)), leaseToken]);
    return result.rows.map((row) => ({ operationId: row.operation_id, scopedUserId: row.scoped_user_id, leaseToken }));
  }

  public async completeRetirementCleanup(operationId: string, leaseToken: string): Promise<void> {
    const result = await this.db.query("UPDATE unet_account_retirement_jobs_v2 SET status='complete',completed_at=now(),lease_token=NULL,lease_until=NULL WHERE operation_id=$1 AND status='pending' AND lease_token=$2 AND lease_until>clock_timestamp()", [operationId, leaseToken]);
    if (!result.rowCount) throw new Error('retirement_cleanup_lease_lost');
  }

  public async failRetirementCleanup(operationId: string, leaseToken: string): Promise<void> {
    await this.db.query(`UPDATE unet_account_retirement_jobs_v2
      SET lease_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+make_interval(secs=>LEAST(3600,5*power(2,LEAST(10,attempts-1))))
      WHERE operation_id=$1 AND status='pending' AND lease_token=$2`, [operationId, leaseToken]);
  }
}
