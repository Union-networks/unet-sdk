import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';

/** @public */
export const DIRECT_LOGIN_PROTOCOL_VERSION = 2 as const;

/** @public */
export interface DirectLoginChallenge {
  protocolVersion: 2;
  requestRef: string;
  serviceId: string;
  origin: string;
  challenge: string;
  challengeUrl: string;
  approvalUrl: string;
  expiresAtIso: string;
}

/** @public */
export interface DirectLoginApproval {
  protocolVersion: 2;
  requestRef: string;
  serviceId: string;
  origin: string;
  scopedUserId: string;
  accountPublicKeyPem: string;
  signedAtIso: string;
  signature: string;
}

/** @public */
export interface DirectLoginSession {
  sessionId: string;
  requestRef: string;
  scopedUserId: string;
  expiresAtIso: string;
}

/** @public */
export interface DirectLoginChallengeRecord extends DirectLoginChallenge {
  challengeHash: string;
  redemptionChallenge: string;
  exchangeAttempts: number;
  state: 'pending' | 'approved' | 'consumed' | 'expired';
  approvedAccount?: { scopedUserId: string; accountPublicKeyPem: string };
  session?: DirectLoginSession;
}

/** @public */
export interface DirectLoginChallengeStore {
  create(record: DirectLoginChallengeRecord): Promise<void>;
  get(requestRef: string): Promise<DirectLoginChallengeRecord | undefined>;
  /** Atomically bind the account key and transition exactly one pending challenge. */
  approve(record: DirectLoginChallengeRecord, nowIso: string): Promise<void>;
  /** Atomically authenticate, bound attempts, and optionally consume an approval. */
  browserAccess(requestRef: string, redemptionChallenge: string, nowIso: string, consume: boolean): Promise<DirectLoginBrowserResult>;
}

/** @public */
export type DirectLoginBrowserResult =
  | { error: 'direct_login_browser_unauthorized' | 'direct_login_not_approved' | 'protocol_upgrade_required' }
  | { state: DirectLoginChallengeRecord['state']; session?: DirectLoginSession };

/** @public */
export interface DirectLoginRetirementStore extends DirectLoginAccountStore {
  getRetirementPublicKey(scopedUserId: string): Promise<string | undefined>;
  /** Retirement and the cleanup job must commit in one transaction. */
  retireWithCleanup(retirement: ServiceAccountRetirement): Promise<void>;
  pendingRetirements(limit: number): Promise<Array<{ operationId: string; scopedUserId: string }>>;
  claimRetirements(limit: number): Promise<Array<{ operationId: string; scopedUserId: string; leaseToken: string }>>;
  completeRetirementCleanup(operationId: string, leaseToken: string): Promise<void>;
  failRetirementCleanup(operationId: string, leaseToken: string): Promise<void>;
}

/** @public */
export interface DirectLoginAccountStore {
  getPublicKey(scopedUserId: string): Promise<string | undefined>;
  bindPublicKey(scopedUserId: string, publicKeyPem: string): Promise<'created' | 'existing'>;
  retire(scopedUserId: string): Promise<void>;
}

/** @public */
export interface DirectLoginServiceOptions {
  serviceId: string;
  origin: string;
  challengeStore: DirectLoginChallengeStore;
  accountStore: DirectLoginRetirementStore;
  challengeTtlSeconds?: number;
  sessionTtlSeconds?: number;
  onAccountRetired?: (scopedUserId: string, operationId: string, signal: AbortSignal) => Promise<void>;
  now?: () => Date;
}

/** @public */
export interface ServiceAccountRetirement {
  protocolVersion: 2;
  serviceId: string;
  origin: string;
  scopedUserId: string;
  operationId: string;
  signedAtIso: string;
  signature: string;
}

const normalizeOrigin = (value: string) => new URL(value).origin;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const randomId = (prefix: string) => `${prefix}_${randomBytes(18).toString('base64url')}`;

/** @public */
export const directLoginRedemptionChallenge = (secret: string): string => {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret)) throw new Error('direct_login_browser_unauthorized');
  return createHash('sha256').update(secret).digest('base64url');
};

/** Shared by transactional stores; never return the internal record to HTTP clients.
 * @public
 */
export function authorizeDirectLoginBrowser(record: DirectLoginChallengeRecord | undefined, challenge: string, nowIso: string, consume: boolean): DirectLoginBrowserResult {
  if (!record) return { error: 'direct_login_browser_unauthorized' };
  if (!record.redemptionChallenge) return { error: 'protocol_upgrade_required' };
  const expected = Buffer.from(record.redemptionChallenge);
  const supplied = Buffer.from(challenge);
  if ((record.exchangeAttempts ?? 0) >= 8 || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    if (consume) record.exchangeAttempts = Math.min(8, (record.exchangeAttempts ?? 0) + 1);
    return { error: 'direct_login_browser_unauthorized' };
  }
  if (Date.parse(record.expiresAtIso) <= Date.parse(nowIso) && record.state !== 'consumed') record.state = 'expired';
  if (!consume) return { state: record.state };
  if (record.state !== 'approved' || !record.session || Date.parse(record.session.expiresAtIso) <= Date.parse(nowIso)) return { error: 'direct_login_not_approved' };
  record.state = 'consumed';
  return { state: 'consumed', session: record.session };
}

const canonicalLoginMessage = (challenge: DirectLoginChallenge, approval: Omit<DirectLoginApproval, 'signature'>): string => [
  'unet-direct-login-v2',
  challenge.serviceId,
  challenge.origin,
  challenge.requestRef,
  challenge.challenge,
  challenge.expiresAtIso,
  approval.scopedUserId,
  approval.accountPublicKeyPem,
  approval.signedAtIso,
].join('\n');

const canonicalRetirementMessage = (retirement: Omit<ServiceAccountRetirement, 'signature'>): string => [
  'unet-service-account-retirement-v2',
  retirement.serviceId,
  retirement.origin,
  retirement.scopedUserId,
  retirement.operationId,
  retirement.signedAtIso,
].join('\n');

/** @public */
export function directLoginQrPayload(challenge: DirectLoginChallenge): string {
  return `unet://service-login?payload=${encodeURIComponent(JSON.stringify({
    kind: 'unet_service_login',
    version: 2,
    serviceId: challenge.serviceId,
    origin: challenge.origin,
    requestRef: challenge.requestRef,
    challengeUrl: challenge.challengeUrl,
    expiresAtIso: challenge.expiresAtIso,
  }))}`;
}

/** @public */
export function verifyDirectLoginApprovalSignature(challenge: DirectLoginChallenge, approval: DirectLoginApproval): boolean {
  const { signature, ...unsigned } = approval;
  try {
    const key = createPublicKey(approval.accountPublicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return false;
    return verify(
      null,
      Buffer.from(canonicalLoginMessage(challenge, unsigned), 'utf8'),
      key,
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

/** @public */
export function createDirectLoginService(options: DirectLoginServiceOptions) {
  const origin = normalizeOrigin(options.origin);
  const now = options.now ?? (() => new Date());
  const challengeTtlSeconds = options.challengeTtlSeconds ?? 120;
  const sessionTtlSeconds = options.sessionTtlSeconds ?? 900;
  if (!origin.startsWith('https://')) throw new Error('direct_login_origin_mismatch');
  if (!Number.isInteger(challengeTtlSeconds) || challengeTtlSeconds < 30 || challengeTtlSeconds > 600
    || !Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds < 30 || sessionTtlSeconds > 900) throw new Error('direct_login_ttl_invalid');

  return {
    async createChallenge(input: { challengeUrl: string; approvalUrl: string; redemptionSecret: string }): Promise<DirectLoginChallenge> {
      const redemptionChallenge = directLoginRedemptionChallenge(input.redemptionSecret);
      const challengeUrl = new URL(input.challengeUrl, origin);
      const approvalUrl = new URL(input.approvalUrl, origin);
      if (challengeUrl.origin !== origin || approvalUrl.origin !== origin) throw new Error('direct_login_origin_mismatch');
      const createdAt = now();
      const challenge: DirectLoginChallenge = {
        protocolVersion: 2,
        requestRef: randomId('login'),
        serviceId: options.serviceId,
        origin,
        challenge: randomBytes(32).toString('base64url'),
        challengeUrl: challengeUrl.toString(),
        approvalUrl: approvalUrl.toString(),
        expiresAtIso: new Date(createdAt.getTime() + challengeTtlSeconds * 1_000).toISOString(),
      };
      await options.challengeStore.create({ ...challenge, challengeHash: hash(challenge.challenge), redemptionChallenge, exchangeAttempts: 0, state: 'pending' });
      return challenge;
    },

    async getChallenge(requestRef: string): Promise<DirectLoginChallenge> {
      const record = await options.challengeStore.get(requestRef);
      if (!record) throw new Error('direct_login_not_found');
      if (Date.parse(record.expiresAtIso) <= now().getTime()) {
        throw new Error('direct_login_expired');
      }
      if (!record.redemptionChallenge) throw new Error('protocol_upgrade_required');
      return {
        protocolVersion: record.protocolVersion, requestRef: record.requestRef,
        serviceId: record.serviceId, origin: record.origin, challenge: record.challenge,
        challengeUrl: record.challengeUrl, approvalUrl: record.approvalUrl, expiresAtIso: record.expiresAtIso,
      };
    },

    async approve(approval: DirectLoginApproval): Promise<void> {
      const record = await options.challengeStore.get(approval.requestRef);
      if (!record || record.state !== 'pending') throw new Error('direct_login_not_pending');
      if (!record.redemptionChallenge) throw new Error('protocol_upgrade_required');
      if (approval.protocolVersion !== 2 || !/^[A-Za-z0-9:_-]{1,256}$/.test(approval.scopedUserId)) throw new Error('direct_login_approval_invalid');
      if (record.serviceId !== approval.serviceId || record.origin !== normalizeOrigin(approval.origin)) throw new Error('direct_login_service_mismatch');
      if (Date.parse(record.expiresAtIso) <= now().getTime()) throw new Error('direct_login_expired');
      const signedAt = Date.parse(approval.signedAtIso);
      if (!Number.isFinite(signedAt) || Math.abs(now().getTime() - signedAt) > 60_000) throw new Error('direct_login_signature_stale');
      if (!verifyDirectLoginApprovalSignature(record, approval)) throw new Error('direct_login_bad_signature');
      const session = {
        sessionId: randomId('session'),
        requestRef: record.requestRef,
        scopedUserId: approval.scopedUserId,
        expiresAtIso: new Date(now().getTime() + sessionTtlSeconds * 1_000).toISOString(),
      };
      await options.challengeStore.approve({
        ...record,
        state: 'approved',
        approvedAccount: { scopedUserId: approval.scopedUserId, accountPublicKeyPem: approval.accountPublicKeyPem },
        session,
      }, now().toISOString());
    },

    async poll(requestRef: string, redemptionSecret: string): Promise<{ state: DirectLoginChallengeRecord['state'] }> {
      const result = await options.challengeStore.browserAccess(requestRef, directLoginRedemptionChallenge(redemptionSecret), now().toISOString(), false);
      if ('error' in result) throw new Error(result.error);
      return { state: result.state };
    },

    async exchangeSession(requestRef: string, redemptionSecret: string): Promise<DirectLoginSession> {
      const result = await options.challengeStore.browserAccess(requestRef, directLoginRedemptionChallenge(redemptionSecret), now().toISOString(), true);
      if ('error' in result) throw new Error(result.error);
      if (!result.session) throw new Error('direct_login_not_approved');
      return result.session;
    },

    async retire(retirement: ServiceAccountRetirement): Promise<void> {
      if (retirement.protocolVersion !== 2 || retirement.serviceId !== options.serviceId || normalizeOrigin(retirement.origin) !== origin) {
        throw new Error('service_account_retirement_mismatch');
      }
      const signedAt = Date.parse(retirement.signedAtIso);
      if (!Number.isFinite(signedAt) || signedAt > now().getTime() + 60_000) throw new Error('service_account_retirement_stale');
      if (!/^[A-Za-z0-9:_-]{16,256}$/.test(retirement.operationId)) throw new Error('service_account_retirement_invalid');
      const publicKey = await options.accountStore.getRetirementPublicKey(retirement.scopedUserId);
      if (!publicKey) throw new Error('service_account_retirement_unknown');
      const { signature, ...unsigned } = retirement;
      const key = createPublicKey(publicKey);
      if (key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(canonicalRetirementMessage(unsigned), 'utf8'), key, Buffer.from(signature, 'base64url'))) {
        throw new Error('service_account_retirement_bad_signature');
      }
      await options.accountStore.retireWithCleanup(retirement);
    },

    /** Run durably from a provider worker/cron; callbacks must be idempotent. */
    async retryRetirementCleanup(): Promise<{ completed: number; pending: number }> {
      const jobs = await options.accountStore.claimRetirements(1);
      let completed = 0;
      for (const job of jobs) {
        try {
          const controller = new AbortController();
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              Promise.resolve().then(() => options.onAccountRetired?.(job.scopedUserId, job.operationId, controller.signal)),
              new Promise<never>((_, reject) => { timeout = setTimeout(() => {
                controller.abort();
                reject(new Error('retirement_cleanup_timeout'));
              }, 30_000); }),
            ]);
          } finally { clearTimeout(timeout); }
          await options.accountStore.completeRetirementCleanup(job.operationId, job.leaseToken);
          completed += 1;
        } catch {
          await options.accountStore.failRetirementCleanup(job.operationId, job.leaseToken);
        }
      }
      return { completed, pending: jobs.length - completed };
    },
  };
}

/** @public */
export type DirectLoginService = ReturnType<typeof createDirectLoginService>;

/** @public */
export class InMemoryDirectLoginChallengeStore implements DirectLoginChallengeStore {
  private readonly records = new Map<string, DirectLoginChallengeRecord>();
  private serial: Promise<unknown> = Promise.resolve();
  public constructor(private readonly accounts: InMemoryDirectLoginAccountStore) {}

  public async create(record: DirectLoginChallengeRecord): Promise<void> {
    if (this.records.has(record.requestRef)) throw new Error('direct_login_duplicate_request');
    this.records.set(record.requestRef, structuredClone(record));
  }

  public async get(requestRef: string): Promise<DirectLoginChallengeRecord | undefined> {
    const record = this.records.get(requestRef);
    return record ? structuredClone(record) : undefined;
  }

  public approve(record: DirectLoginChallengeRecord, nowIso: string): Promise<void> {
    const task = this.serial.then(async () => {
      const previous = this.records.get(record.requestRef);
      if (!previous || previous.state !== 'pending' || Date.parse(previous.expiresAtIso) <= Date.parse(nowIso)) throw new Error('direct_login_not_pending');
      if (!record.approvedAccount) throw new Error('direct_login_approval_invalid');
      await this.accounts.bindPublicKey(record.approvedAccount.scopedUserId, record.approvedAccount.accountPublicKeyPem);
      this.records.set(record.requestRef, structuredClone({ ...previous, state: 'approved', approvedAccount: record.approvedAccount, session: record.session }));
    });
    this.serial = task.catch(() => undefined);
    return task;
  }

  public async browserAccess(requestRef: string, challenge: string, nowIso: string, consume: boolean): Promise<DirectLoginBrowserResult> {
    await this.serial;
    const record = this.records.get(requestRef);
    if (record?.approvedAccount && !(await this.accounts.getPublicKey(record.approvedAccount.scopedUserId))) return { error: 'direct_login_not_approved' };
    return structuredClone(authorizeDirectLoginBrowser(record, challenge, nowIso, consume));
  }
}

/** @public */
export class InMemoryDirectLoginAccountStore implements DirectLoginRetirementStore {
  private readonly accounts = new Map<string, { publicKeyPem: string; status: 'active' | 'retired' }>();
  private readonly retirements = new Map<string, { scopedUserId: string; complete: boolean; leaseToken?: string; leaseUntil?: number; attempts?: number; nextAttempt?: number }>();

  public async getPublicKey(scopedUserId: string): Promise<string | undefined> {
    const account = this.accounts.get(scopedUserId);
    return account?.status === 'active' ? account.publicKeyPem : undefined;
  }

  public async bindPublicKey(scopedUserId: string, publicKeyPem: string): Promise<'created' | 'existing'> {
    const existing = this.accounts.get(scopedUserId);
    if (!existing) {
      this.accounts.set(scopedUserId, { publicKeyPem, status: 'active' });
      return 'created';
    }
    if (existing.status === 'retired') throw new Error('service_account_retired');
    if (existing.publicKeyPem !== publicKeyPem) throw new Error('direct_login_account_key_mismatch');
    return 'existing';
  }

  public async retire(scopedUserId: string): Promise<void> {
    const existing = this.accounts.get(scopedUserId);
    if (existing) this.accounts.set(scopedUserId, { ...existing, status: 'retired' });
  }

  public async getRetirementPublicKey(scopedUserId: string): Promise<string | undefined> {
    return this.accounts.get(scopedUserId)?.publicKeyPem;
  }

  public async retireWithCleanup(retirement: ServiceAccountRetirement): Promise<void> {
    const previous = this.retirements.get(retirement.operationId);
    if (previous && previous.scopedUserId !== retirement.scopedUserId) throw new Error('service_account_retirement_mismatch');
    if (previous) return;
    const account = this.accounts.get(retirement.scopedUserId);
    if (!account) throw new Error('service_account_retirement_unknown');
    this.accounts.set(retirement.scopedUserId, { ...account, status: 'retired' });
    this.retirements.set(retirement.operationId, { scopedUserId: retirement.scopedUserId, complete: false });
  }

  public async pendingRetirements(limit: number): Promise<Array<{ operationId: string; scopedUserId: string }>> {
    return [...this.retirements].filter(([, job]) => !job.complete).slice(0, limit).map(([operationId, job]) => ({ operationId, scopedUserId: job.scopedUserId }));
  }

  public async claimRetirements(limit: number): Promise<Array<{ operationId: string; scopedUserId: string; leaseToken: string }>> {
    const jobs = [...this.retirements].filter(([, job]) => !job.complete && (job.leaseUntil ?? 0) <= Date.now() && (job.nextAttempt ?? 0) <= Date.now()).slice(0, Math.max(1, Math.min(100, limit)));
    return jobs.map(([operationId, job]) => {
      job.leaseToken = randomId('lease');
      job.leaseUntil = Date.now() + 120_000;
      job.attempts = (job.attempts ?? 0) + 1;
      return { operationId, scopedUserId: job.scopedUserId, leaseToken: job.leaseToken };
    });
  }

  public async completeRetirementCleanup(operationId: string, leaseToken: string): Promise<void> {
    const job = this.retirements.get(operationId);
    if (!job || job.leaseToken !== leaseToken || (job.leaseUntil ?? 0) <= Date.now()) throw new Error('retirement_cleanup_lease_lost');
    job.complete = true;
  }

  public async failRetirementCleanup(operationId: string, leaseToken: string): Promise<void> {
    const job = this.retirements.get(operationId);
    if (!job || job.complete || job.leaseToken !== leaseToken) return;
    job.nextAttempt = Date.now() + Math.min(3_600_000, 5_000 * 2 ** Math.min(10, (job.attempts ?? 1) - 1));
    job.leaseUntil = 0;
    job.leaseToken = undefined;
  }
}
