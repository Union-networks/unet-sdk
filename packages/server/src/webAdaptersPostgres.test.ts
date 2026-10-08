import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDirectLoginService, type DirectLoginChallenge } from './directLogin.js';
import { ensureDirectLoginSchema, PostgresDirectLoginAccountStore, PostgresDirectLoginChallengeStore, type DirectLoginSqlPool } from './directLoginPostgres.js';
import { createDirectLoginWebHandlers } from './webAdapters.js';

const url = process.env.UNET_SECURITY_TEST_POSTGRES_URL;
describe.skipIf(!url)('web adapter boundaries with real PostgreSQL', { timeout: 30_000 }, () => {
  const origin = 'https://shop.test';
  const schema = `unet_security_test_${randomBytes(8).toString('hex')}`;
  let db: DirectLoginSqlPool & { end(): Promise<void> };
  let admin: DirectLoginSqlPool & { end(): Promise<void> };
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

  function fixture() {
    const accountStore = new PostgresDirectLoginAccountStore(db);
    const challengeStore = new PostgresDirectLoginChallengeStore(db);
    const service = createDirectLoginService({ serviceId: 'shop', origin, accountStore, challengeStore });
    let exchanges = 0;
    const handlers = createDirectLoginWebHandlers({ serviceId: 'shop', origin, service, accountStore,
      exchange: async () => { exchanges++; return { success: true }; } });
    const post = (path: string, body: unknown, cookie?: string, suppliedOrigin = origin) => new Request(`${origin}/api/unet/login/${path}`, {
      method: 'POST', headers: { origin: suppliedOrigin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
    });
    async function challenge() {
      const response = await handlers.challenge(post('challenge', {}));
      expect(response.status).toBe(200);
      const body = await response.json() as { challenge: DirectLoginChallenge };
      const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
      const secret = cookie.slice(cookie.indexOf('=') + 1);
      expect(JSON.stringify(body)).not.toContain(secret);
      expect(JSON.stringify(await challengeStore.get(body.challenge.requestRef))).not.toContain(secret);
      return { challenge: body.challenge, cookie };
    }
    async function approve(challenge: DirectLoginChallenge) {
      const keys = generateKeyPairSync('ed25519');
      const scopedUserId = `synthetic_${randomBytes(8).toString('hex')}`;
      const accountPublicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
      const signedAtIso = new Date().toISOString();
      const message = ['unet-direct-login-v2', 'shop', origin, challenge.requestRef, challenge.challenge, challenge.expiresAtIso, scopedUserId, accountPublicKeyPem, signedAtIso].join('\n');
      const response = await handlers.approve(post('approval', { protocolVersion: 2, serviceId: 'shop', origin, requestRef: challenge.requestRef,
        scopedUserId, accountPublicKeyPem, signedAtIso, signature: sign(null, Buffer.from(message), keys.privateKey).toString('base64url') }));
      expect(response.status).toBe(200);
      return { keys, scopedUserId };
    }
    return { accountStore, service, handlers, post, challenge, approve, exchanges: () => exchanges };
  }

  it('isolates browser cookies and permits simultaneous tabs without exposing approval results', async () => {
    const f = fixture();
    const a = await f.challenge();
    const b = await f.challenge();
    await f.approve(a.challenge);
    await f.approve(b.challenge);
    const status = (requestRef: string, cookie?: string) => f.handlers.challengeStatus(new Request(`${origin}/api/unet/login/status?requestRef=${requestRef}`, { headers: cookie ? { cookie } : {} }));
    expect((await status(a.challenge.requestRef)).status).toBe(403);
    expect((await status(a.challenge.requestRef, b.cookie)).status).toBe(403);
    expect((await f.handlers.exchange(f.post('exchange', { requestRef: a.challenge.requestRef }, b.cookie))).status).toBe(403);
    expect((await f.handlers.exchange(f.post('exchange', { requestRef: a.challenge.requestRef }, a.cookie, 'https://observer.test'))).status).toBe(403);
    const sharedBrowserCookies = `${a.cookie}; ${b.cookie}`;
    expect(await (await status(a.challenge.requestRef, sharedBrowserCookies)).json()).toEqual({ success: true, state: 'approved' });
    expect(await (await status(b.challenge.requestRef, sharedBrowserCookies)).json()).toEqual({ success: true, state: 'approved' });
    const results = await Promise.all(Array.from({ length: 8 }, () => f.handlers.exchange(f.post('exchange', { requestRef: a.challenge.requestRef }, sharedBrowserCookies))));
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect((await f.handlers.exchange(f.post('exchange', { requestRef: b.challenge.requestRef }, sharedBrowserCookies))).status).toBe(200);
    expect(f.exchanges()).toBe(2);
  });

  it.each([6 * 60_000, 3 * 24 * 60 * 60_000])('accepts signed retirement delayed %i ms and durably queues cleanup once', async (delay) => {
    const f = fixture();
    const browser = await f.challenge();
    const account = await f.approve(browser.challenge);
    const operationId = `retirement_${randomBytes(12).toString('hex')}`;
    const signedAtIso = new Date(Date.now() - delay).toISOString();
    const message = ['unet-service-account-retirement-v2', 'shop', origin, account.scopedUserId, operationId, signedAtIso].join('\n');
    const retirement = { protocolVersion: 2 as const, serviceId: 'shop', origin, scopedUserId: account.scopedUserId,
      operationId, signedAtIso, signature: sign(null, Buffer.from(message), account.keys.privateKey).toString('base64url') };
    await Promise.all(Array.from({ length: 8 }, () => f.service.retire(retirement)));
    expect(await f.accountStore.getPublicKey(account.scopedUserId)).toBeUndefined();
    expect((await f.handlers.exchange(f.post('exchange', { requestRef: browser.challenge.requestRef }, browser.cookie))).status).not.toBe(200);
    const jobs = await db.query('SELECT count(*)::int AS count FROM unet_account_retirement_jobs_v2 WHERE operation_id=$1', [operationId]);
    expect(jobs.rows[0]?.count).toBe(1);
    const job = (await f.accountStore.claimRetirements(100)).find(j => j.operationId === operationId)!;
    expect(job).toBeDefined();
    await f.accountStore.completeRetirementCleanup(job.operationId, job.leaseToken);
    await f.service.retire(retirement);
    const recorded = await db.query('SELECT status FROM unet_account_retirement_jobs_v2 WHERE operation_id=$1', [operationId]);
    expect(recorded.rows[0]?.status).toBe('complete');
    await expect(f.service.retire({ ...retirement, operationId: `${operationId}_tampered` })).rejects.toThrow('bad_signature');
  });
});
