import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDirectLoginService, type DirectLoginChallenge } from './directLogin.js';
import { ensureDirectLoginSchema, PostgresDirectLoginAccountStore, PostgresDirectLoginChallengeStore, type DirectLoginSqlPool } from './directLoginPostgres.js';

// Explicit opt-in: never use a provider's normal DATABASE_URL for destructive fixtures.
const url = process.env.UNET_SECURITY_TEST_POSTGRES_URL;
describe.skipIf(!url)('real PostgreSQL login transactions', { timeout: 30_000 }, () => {
  let db: DirectLoginSqlPool & { end(): Promise<void> };
  let admin: DirectLoginSqlPool & { end(): Promise<void> };
  const schema = `unet_security_test_${randomBytes(8).toString('hex')}`;
  beforeAll(async () => {
    if (new URL(url!).pathname !== '/unet_security_test') throw new Error('dedicated_test_database_required');
    const pg = await import('pg');
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    db = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 12 });
    await ensureDirectLoginSchema(db);
  });
  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  function setup() {
    const accountStore = new PostgresDirectLoginAccountStore(db);
    const challengeStore = new PostgresDirectLoginChallengeStore(db);
    const service = createDirectLoginService({ serviceId: 'test-shop', origin: 'https://shop.test', accountStore, challengeStore });
    const secret = randomBytes(32).toString('base64url');
    return { service, accountStore, challengeStore, secret, create: () => service.createChallenge({ challengeUrl: '/challenge', approvalUrl: '/approve', redemptionSecret: secret }) };
  }
  function approval(challenge: DirectLoginChallenge, scopedUserId: string) {
    const keys = generateKeyPairSync('ed25519');
    const publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const signedAtIso = new Date().toISOString();
    const message = ['unet-direct-login-v2', challenge.serviceId, challenge.origin, challenge.requestRef, challenge.challenge, challenge.expiresAtIso, scopedUserId, publicKey, signedAtIso].join('\n');
    return { protocolVersion: 2 as const, serviceId: challenge.serviceId, origin: challenge.origin, requestRef: challenge.requestRef, scopedUserId, accountPublicKeyPem: publicKey, signedAtIso, signature: sign(null, Buffer.from(message), keys.privateKey).toString('base64url') };
  }

  it('does not bind the losing account in concurrent approvals and consumes once', async () => {
    const { service, create, secret } = setup();
    const challenge = await create();
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => service.approve(approval(challenge, `race_account_${i}`))));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const accounts = await db.query("SELECT count(*)::int AS count FROM unet_service_accounts_v2 WHERE scoped_user_id LIKE 'race_account_%'");
    expect(accounts.rows[0]?.count).toBe(1);
    const exchanges = await Promise.allSettled(Array.from({ length: 8 }, () => service.exchangeSession(challenge.requestRef, secret)));
    expect(exchanges.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('rolls back account retirement when durable cleanup insertion fails', async () => {
    const { accountStore } = setup();
    await accountStore.bindPublicKey('rollback_account', 'public_test_key');
    await db.query("CREATE FUNCTION reject_test_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic storage failure'; END; $$");
    await db.query('CREATE TRIGGER reject_job BEFORE INSERT ON unet_account_retirement_jobs_v2 FOR EACH ROW EXECUTE FUNCTION reject_test_job()');
    const retirement = { protocolVersion: 2 as const, serviceId: 'test-shop', origin: 'https://shop.test', scopedUserId: 'rollback_account', operationId: 'rollback_operation_1', signedAtIso: new Date().toISOString(), signature: 'store_already_verified' };
    try {
      await expect(accountStore.retireWithCleanup(retirement)).rejects.toThrow('synthetic storage failure');
      expect(await accountStore.getPublicKey('rollback_account')).toBe('public_test_key');
    } finally { await db.query('DROP TRIGGER reject_job ON unet_account_retirement_jobs_v2'); }
    await accountStore.retireWithCleanup(retirement);
    await accountStore.retireWithCleanup(retirement);
    expect(await accountStore.getPublicKey('rollback_account')).toBeUndefined();
    const jobs = (await accountStore.claimRetirements(20)).filter((job) => job.operationId === retirement.operationId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.leaseToken).toBeTruthy();
  });

  it('prevents exchange after retirement and rejects replacement account keys', async () => {
    const { service, create, secret, accountStore } = setup();
    const challenge = await create();
    const signed = approval(challenge, 'retired_before_exchange');
    await service.approve(signed);
    await accountStore.retireWithCleanup({ protocolVersion: 2, serviceId: 'test-shop', origin: 'https://shop.test', scopedUserId: signed.scopedUserId, operationId: 'retirement_before_exchange', signedAtIso: new Date().toISOString(), signature: 'store_already_verified' });
    await expect(service.exchangeSession(challenge.requestRef, secret)).rejects.toThrow('not_approved');
    const next = await create();
    await expect(service.approve(approval(next, signed.scopedUserId))).rejects.toThrow('retired');
  });

  it('checks exchange expiration after waiting for account locks', async () => {
    const { service, create, secret } = setup();
    const challenge = await create();
    await service.approve(approval(challenge, 'expiry_lock_account'));
    const blocker = await db.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query("SELECT * FROM unet_service_accounts_v2 WHERE scoped_user_id='expiry_lock_account' FOR UPDATE");
      await db.query(`UPDATE unet_direct_login_challenges_v2
        SET record=jsonb_set(record,'{expiresAtIso}',to_jsonb((clock_timestamp()+interval '0.2 seconds')::text)) WHERE request_ref=$1`, [challenge.requestRef]);
      const exchange = service.exchangeSession(challenge.requestRef, secret);
      const rejected = expect(exchange).rejects.toThrow('not_approved');
      await blocker.query('SELECT pg_sleep(0.35)');
      await blocker.query('COMMIT');
      await rejected;
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  });

  it('leases cleanup once, retries after a crash, and fences obsolete workers', async () => {
    const { accountStore } = setup();
    await accountStore.bindPublicKey('lease_account', 'test_key');
    await accountStore.retireWithCleanup({ protocolVersion: 2, serviceId: 'test-shop', origin: 'https://shop.test', scopedUserId: 'lease_account', operationId: 'lease_operation_1', signedAtIso: new Date().toISOString(), signature: 'store_already_verified' });
    const claims = (await Promise.all(Array.from({ length: 8 }, () => accountStore.claimRetirements(100)))).flat().filter((job) => job.operationId === 'lease_operation_1');
    expect(claims).toHaveLength(1);
    const original = claims[0]!;
    await db.query("UPDATE unet_account_retirement_jobs_v2 SET lease_until=clock_timestamp()-interval '1 second' WHERE operation_id=$1", [original.operationId]);
    const replacement = (await accountStore.claimRetirements(100)).find((job) => job.operationId === original.operationId)!;
    expect(replacement.leaseToken).not.toBe(original.leaseToken);
    await expect(accountStore.completeRetirementCleanup(original.operationId, original.leaseToken)).rejects.toThrow('lease_lost');
    await accountStore.failRetirementCleanup(replacement.operationId, replacement.leaseToken);
    expect((await accountStore.claimRetirements(100)).some((job) => job.operationId === original.operationId)).toBe(false);
    await db.query("UPDATE unet_account_retirement_jobs_v2 SET next_attempt_at=clock_timestamp() WHERE operation_id=$1", [original.operationId]);
    const retry = (await accountStore.claimRetirements(100)).find((job) => job.operationId === original.operationId)!;
    await accountStore.completeRetirementCleanup(retry.operationId, retry.leaseToken);
    expect((await accountStore.pendingRetirements(100)).some((job) => job.operationId === original.operationId)).toBe(false);
  });
});
