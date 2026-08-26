import { createHash, randomBytes, verify } from 'node:crypto';

export const DIRECT_LOGIN_PROTOCOL_VERSION = 2 as const;

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

export interface DirectLoginSession {
  sessionId: string;
  requestRef: string;
  scopedUserId: string;
  expiresAtIso: string;
}

export interface DirectLoginChallengeRecord extends DirectLoginChallenge {
  challengeHash: string;
  state: 'pending' | 'approved' | 'consumed' | 'expired';
  approvedAccount?: { scopedUserId: string; accountPublicKeyPem: string };
  session?: DirectLoginSession;
}

export interface DirectLoginChallengeStore {
  create(record: DirectLoginChallengeRecord): Promise<void>;
  get(requestRef: string): Promise<DirectLoginChallengeRecord | undefined>;
  getBySessionId(sessionId: string): Promise<DirectLoginChallengeRecord | undefined>;
  update(record: DirectLoginChallengeRecord): Promise<void>;
  consume(requestRef: string): Promise<boolean>;
}

export interface DirectLoginAccountStore {
  getPublicKey(scopedUserId: string): Promise<string | undefined>;
  bindPublicKey(scopedUserId: string, publicKeyPem: string): Promise<'created' | 'existing'>;
  retire(scopedUserId: string): Promise<void>;
}

export interface DirectLoginServiceOptions {
  serviceId: string;
  origin: string;
  challengeStore: DirectLoginChallengeStore;
  accountStore: DirectLoginAccountStore;
  challengeTtlSeconds?: number;
  sessionTtlSeconds?: number;
  onAccountRetired?: (scopedUserId: string) => Promise<void>;
  now?: () => Date;
}

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

export function verifyDirectLoginApprovalSignature(challenge: DirectLoginChallenge, approval: DirectLoginApproval): boolean {
  const { signature, ...unsigned } = approval;
  try {
    return verify(
      null,
      Buffer.from(canonicalLoginMessage(challenge, unsigned), 'utf8'),
      approval.accountPublicKeyPem,
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

export function createDirectLoginService(options: DirectLoginServiceOptions) {
  const origin = normalizeOrigin(options.origin);
  const now = options.now ?? (() => new Date());
  const challengeTtlSeconds = options.challengeTtlSeconds ?? 120;
  const sessionTtlSeconds = options.sessionTtlSeconds ?? 900;

  return {
    async createChallenge(input: { challengeUrl: string; approvalUrl: string }): Promise<DirectLoginChallenge> {
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
      await options.challengeStore.create({ ...challenge, challengeHash: hash(challenge.challenge), state: 'pending' });
      return challenge;
    },

    async getChallenge(requestRef: string): Promise<DirectLoginChallenge> {
      const record = await options.challengeStore.get(requestRef);
      if (!record) throw new Error('direct_login_not_found');
      if (Date.parse(record.expiresAtIso) <= now().getTime()) {
        await options.challengeStore.update({ ...record, state: 'expired' });
        throw new Error('direct_login_expired');
      }
      const { challengeHash: _challengeHash, state: _state, approvedAccount: _approvedAccount, session: _session, ...challenge } = record;
      return challenge;
    },

    async approve(approval: DirectLoginApproval): Promise<void> {
      const record = await options.challengeStore.get(approval.requestRef);
      if (!record || record.state !== 'pending') throw new Error('direct_login_not_pending');
      if (record.serviceId !== approval.serviceId || record.origin !== normalizeOrigin(approval.origin)) throw new Error('direct_login_service_mismatch');
      if (Date.parse(record.expiresAtIso) <= now().getTime()) throw new Error('direct_login_expired');
      const signedAt = Date.parse(approval.signedAtIso);
      if (!Number.isFinite(signedAt) || Math.abs(now().getTime() - signedAt) > 60_000) throw new Error('direct_login_signature_stale');
      if (!verifyDirectLoginApprovalSignature(record, approval)) throw new Error('direct_login_bad_signature');
      const boundKey = await options.accountStore.getPublicKey(approval.scopedUserId);
      if (boundKey && boundKey !== approval.accountPublicKeyPem) throw new Error('direct_login_account_key_mismatch');
      await options.accountStore.bindPublicKey(approval.scopedUserId, approval.accountPublicKeyPem);
      const session = {
        sessionId: randomId('session'),
        requestRef: record.requestRef,
        scopedUserId: approval.scopedUserId,
        expiresAtIso: new Date(now().getTime() + sessionTtlSeconds * 1_000).toISOString(),
      };
      await options.challengeStore.update({
        ...record,
        state: 'approved',
        approvedAccount: { scopedUserId: approval.scopedUserId, accountPublicKeyPem: approval.accountPublicKeyPem },
        session,
      });
    },

    async poll(requestRef: string): Promise<{ state: DirectLoginChallengeRecord['state']; session?: DirectLoginSession }> {
      const record = await options.challengeStore.get(requestRef);
      if (!record) throw new Error('direct_login_not_found');
      if (Date.parse(record.expiresAtIso) <= now().getTime() && record.state === 'pending') {
        await options.challengeStore.update({ ...record, state: 'expired' });
        return { state: 'expired' };
      }
      if (record.state !== 'approved' || !record.session) return { state: record.state };
      return { state: 'approved', session: record.session };
    },

    async prepareSessionExchange(sessionId: string): Promise<DirectLoginSession> {
      const record = await options.challengeStore.getBySessionId(sessionId);
      if (!record || record.state !== 'approved' || !record.session || record.session.sessionId !== sessionId) {
        throw new Error('direct_login_session_invalid');
      }
      if (Date.parse(record.session.expiresAtIso) <= now().getTime()) throw new Error('direct_login_session_expired');
      return record.session;
    },

    async completeSessionExchange(sessionId: string): Promise<void> {
      const record = await options.challengeStore.getBySessionId(sessionId);
      if (!record || record.state !== 'approved' || !record.session || record.session.sessionId !== sessionId) {
        throw new Error('direct_login_session_invalid');
      }
      if (Date.parse(record.session.expiresAtIso) <= now().getTime()) throw new Error('direct_login_session_expired');
      if (!(await options.challengeStore.consume(record.requestRef))) throw new Error('direct_login_session_already_exchanged');
    },

    async exchangeSession(sessionId: string): Promise<DirectLoginSession> {
      const session = await this.prepareSessionExchange(sessionId);
      await this.completeSessionExchange(sessionId);
      return session;
    },

    async retire(retirement: ServiceAccountRetirement): Promise<void> {
      if (retirement.protocolVersion !== 2 || retirement.serviceId !== options.serviceId || normalizeOrigin(retirement.origin) !== origin) {
        throw new Error('service_account_retirement_mismatch');
      }
      const signedAt = Date.parse(retirement.signedAtIso);
      if (!Number.isFinite(signedAt) || Math.abs(now().getTime() - signedAt) > 5 * 60_000) throw new Error('service_account_retirement_stale');
      const publicKey = await options.accountStore.getPublicKey(retirement.scopedUserId);
      if (!publicKey) return;
      const { signature, ...unsigned } = retirement;
      if (!verify(null, Buffer.from(canonicalRetirementMessage(unsigned), 'utf8'), publicKey, Buffer.from(signature, 'base64url'))) {
        throw new Error('service_account_retirement_bad_signature');
      }
      await options.accountStore.retire(retirement.scopedUserId);
      await options.onAccountRetired?.(retirement.scopedUserId);
    },
  };
}

export type DirectLoginService = ReturnType<typeof createDirectLoginService>;

export class InMemoryDirectLoginChallengeStore implements DirectLoginChallengeStore {
  private readonly records = new Map<string, DirectLoginChallengeRecord>();

  public async create(record: DirectLoginChallengeRecord): Promise<void> {
    if (this.records.has(record.requestRef)) throw new Error('direct_login_duplicate_request');
    this.records.set(record.requestRef, structuredClone(record));
  }

  public async get(requestRef: string): Promise<DirectLoginChallengeRecord | undefined> {
    const record = this.records.get(requestRef);
    return record ? structuredClone(record) : undefined;
  }

  public async getBySessionId(sessionId: string): Promise<DirectLoginChallengeRecord | undefined> {
    const value = [...this.records.values()].find((record) => record.session?.sessionId === sessionId);
    return value ? structuredClone(value) : undefined;
  }

  public async update(record: DirectLoginChallengeRecord): Promise<void> {
    this.records.set(record.requestRef, structuredClone(record));
  }

  public async consume(requestRef: string): Promise<boolean> {
    const record = this.records.get(requestRef);
    if (!record || record.state !== 'approved') return false;
    this.records.set(requestRef, { ...record, state: 'consumed' });
    return true;
  }
}

export class InMemoryDirectLoginAccountStore implements DirectLoginAccountStore {
  private readonly accounts = new Map<string, { publicKeyPem: string; status: 'active' | 'retired' }>();

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
}
