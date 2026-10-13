import { UnetApiError, UnetContractError, UnetTimeoutError } from './errors.js';
import { isVerificationV2Capability, isVerificationV2Reference, validateV2Challenge, validateV2CreateInput, validateV2Jwks, validateV2Status, validateV2Submission } from './verificationV2Validation.js';
import { verificationV2RequestedChecksDigest } from './verificationV2Json.js';
import type { CreateVerificationV2SessionInput, GetVerificationV2StatusInput, VerificationV2Challenge, VerificationV2Jwks, VerificationV2RequestOptions, VerificationV2Session, VerificationV2Status, VerificationV2Submission } from './verificationV2Types.js';
import type { CreateVerificationSessionInput, ListMiniProgramsOptions, ListVerificationChecksOptions, MiniProgramCatalogResponse, ResolveServiceInput, ServiceResolution, UnetClientOptions, VerificationCheckCatalogResponse, VerificationSession, VerificationSessionStatus } from './types.js';

const DEFAULT_CONTROL_PLANE = 'https://issuer.egress.live';
const DEFAULT_VERIFIER = 'https://verifier.egress.live';
const DEFAULT_TIMEOUT_MS = 15_000;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const requireString = (payload: Record<string, unknown>, key: string): string => {
  const value = payload[key];
  if (typeof value !== 'string' || !value) throw new UnetContractError(`U-net response missing ${key}`, payload);
  return value;
};

const withQuery = (path: string, params: object): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, string | number | undefined>)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
};


/** @public */
export class UnetClient {
  private readonly controlPlaneUrl: string;
  private readonly verifierBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultTimeoutMs: number;
  public constructor(options: UnetClientOptions = {}) {
    this.controlPlaneUrl = (options.controlPlaneUrl ?? DEFAULT_CONTROL_PLANE).replace(/\/+$/, '');
    this.verifierBaseUrl = (options.verifierBaseUrl ?? DEFAULT_VERIFIER).replace(/\/+$/, '');
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.fetchImpl = ((input, init) => fetchImpl.call(globalThis, input, init)) as typeof fetch;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }
  /** Resolve a verified service without entering the provider login data path. */
  public async resolveService(input: ResolveServiceInput): Promise<ServiceResolution> {
    const payload = await this.request(this.controlPlaneUrl, withQuery('/v2/services/resolve', input));
    if (!isObject(payload) || !isObject(payload.service)) throw new UnetContractError('Invalid web login service resolve response', payload);
    requireString(payload.service, 'serviceId'); requireString(payload.service, 'origin');
    requireString(payload, 'registryRevision');
    return payload as unknown as ServiceResolution;
  }
  public async listVerificationChecks(options: ListVerificationChecksOptions = {}): Promise<VerificationCheckCatalogResponse> {
    const payload = await this.request(this.verifierBaseUrl, withQuery('/v1/verification-checks', options));
    if (!isObject(payload) || !Array.isArray(payload.checks)) throw new UnetContractError('Invalid verification check catalog response', payload);
    return payload as unknown as VerificationCheckCatalogResponse;
  }
  public async *iterateVerificationChecks(options: ListVerificationChecksOptions = {}): AsyncGenerator<VerificationCheckCatalogResponse['checks'][number], void, void> {
    let cursor = options.cursor;
    do {
      const page = await this.listVerificationChecks({ ...options, cursor });
      for (const check of page.checks) yield check;
      cursor = page.pageInfo?.hasNextPage ? page.pageInfo.nextCursor : undefined;
    } while (cursor);
  }
  public async listMiniPrograms(options: ListMiniProgramsOptions = {}): Promise<MiniProgramCatalogResponse> {
    const payload = await this.request(this.controlPlaneUrl, withQuery('/v1/mini-programs', options));
    if (!isObject(payload) || !Array.isArray(payload.programs)) throw new UnetContractError('Invalid mini-program catalog response', payload);
    return payload as unknown as MiniProgramCatalogResponse;
  }
  public async createVerificationSession(input: CreateVerificationSessionInput): Promise<VerificationSession> {
    const payload = await this.request(this.verifierBaseUrl, '/v1/verification-sessions', { method: 'POST', body: input });
    if (!isObject(payload)) throw new UnetContractError('Invalid verification session response', payload);
    requireString(payload, 'sessionId'); requireString(payload, 'sessionRef'); requireString(payload, 'status'); requireString(payload, 'qrPayload');
    return payload as unknown as VerificationSession;
  }
  public async getVerificationSession(sessionId: string): Promise<VerificationSessionStatus> {
    const payload = await this.request(this.verifierBaseUrl, `/v1/verification-sessions/${encodeURIComponent(sessionId)}`);
    if (!isObject(payload)) throw new UnetContractError('Invalid verification status response', payload);
    requireString(payload, 'sessionId'); requireString(payload, 'status');
    return payload as unknown as VerificationSessionStatus;
  }
  /** Create a V2 session; share its QR, never its private result-read capability. */
  public async createVerificationV2Session(input: CreateVerificationV2SessionInput, options: VerificationV2RequestOptions = {}): Promise<VerificationV2Session> {
    validateV2CreateInput(input);
    const result = await this.verificationRequest('/v2/verification-sessions', { ...options, method: 'POST', body: input });
    validateV2Challenge(result, true);
    if (await verificationV2RequestedChecksDigest((result as VerificationV2Session).requestedChecks) !== (result as VerificationV2Session).requestedChecksDigest) throw new UnetContractError('verification_v2_checks_digest_mismatch');
    const actualTypes = (result as VerificationV2Session).requestedChecks.map(check => check.requestType);
    if (actualTypes.length !== input.requestTypes.length || actualTypes.some((t, index) => t !== input.requestTypes[index]) || (result as VerificationV2Session).audience !== this.verifierBaseUrl) throw new UnetContractError('verification_v2_request_mismatch');
    return result as VerificationV2Session;
  }
  /** Retrieve only the public immutable challenge, without polling authority. */
  public async getVerificationV2Challenge(requestRef: string, options: VerificationV2RequestOptions = {}): Promise<VerificationV2Challenge> {
    const result = await this.verificationRequest(`/v2/verification-requests/${this.verificationReference(requestRef)}`, options);
    validateV2Challenge(result);
    if (await verificationV2RequestedChecksDigest((result as VerificationV2Challenge).requestedChecks) !== (result as VerificationV2Challenge).requestedChecksDigest) throw new UnetContractError('verification_v2_checks_digest_mismatch');
    if ((result as VerificationV2Challenge).requestRef !== requestRef || (result as VerificationV2Challenge).audience !== this.verifierBaseUrl) throw new UnetContractError('verification_v2_request_mismatch');
    return result as VerificationV2Challenge;
  }
  /** Submit native V2 proofs without holder registration; never retry automatically. */
  public async submitVerificationV2Response(requestRef: string, submission: VerificationV2Submission, options: VerificationV2RequestOptions = {}): Promise<VerificationV2Status> {
    validateV2Submission(submission);
    const result = await this.verificationRequest(`/v2/verification-requests/${this.verificationReference(requestRef)}/responses`, { ...options, method: 'POST', body: submission, timeoutMs: 65_000, allowUnavailableStatus: true });
    validateV2Status(result);
    if ((result as VerificationV2Status).sessionId !== submission.sessionId) throw new UnetContractError('verification_v2_session_mismatch');
    return result as VerificationV2Status;
  }
  /** Poll private lifecycle state using a capability in an authorization header only. */
  public async getVerificationV2Status(input: GetVerificationV2StatusInput, options: VerificationV2RequestOptions = {}): Promise<VerificationV2Status> {
    if (!isVerificationV2Capability(input.resultReadCapability)
      || Object.keys(input).some(k => !['sessionId', 'resultReadCapability'].includes(k))) throw new UnetContractError('verification_v2_poll_authority_invalid');
    const result = await this.verificationRequest(`/v2/verification-sessions/${this.verificationReference(input.sessionId)}`, { ...options, headers: { authorization: `Bearer ${input.resultReadCapability}` }, allowUnavailableStatus: true });
    validateV2Status(result);
    if ((result as VerificationV2Status).sessionId !== input.sessionId) throw new UnetContractError('verification_v2_session_mismatch');
    return result as VerificationV2Status;
  }
  /** Fetch keys only from the explicitly configured verifier origin. */
  public async getVerificationV2Jwks(options: VerificationV2RequestOptions = {}): Promise<VerificationV2Jwks> {
    const result = await this.verificationRequest('/.well-known/unet-verifier-jwks.json', options);
    validateV2Jwks(result);
    return result as VerificationV2Jwks;
  }
  private verificationReference(value: string): string {
    if (!isVerificationV2Reference(value)) throw new UnetContractError('verification_v2_reference_invalid');
    return encodeURIComponent(value);
  }
  private verificationRequest(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string>; timeoutMs?: number; allowUnavailableStatus?: boolean } = {}): Promise<unknown> {
    let origin: URL;
    try { origin = new URL(this.verifierBaseUrl); } catch { throw new UnetContractError('verification_v2_origin_invalid'); }
    if (origin.protocol !== 'https:' || origin.origin !== this.verifierBaseUrl || origin.username || origin.password) throw new UnetContractError('verification_v2_origin_invalid');
    return this.request(origin.origin, path, { ...options, timeoutMs: options.timeoutMs ?? 10_000, sanitized: true });
  }
  private async request(baseUrl: string, path: string, options: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal; sanitized?: boolean; allowUnavailableStatus?: boolean } = {}): Promise<unknown> {
    const controller = new AbortController();
    let rejectDeadline!: (error: UnetTimeoutError) => void;
    const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
    const abort = () => { controller.abort(); rejectDeadline(new UnetTimeoutError()); };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, options.timeoutMs ?? this.defaultTimeoutMs);
    try {
      if (controller.signal.aborted) throw new UnetTimeoutError();
      const response = await Promise.race([this.fetchImpl(`${baseUrl}${path}`, { method: options.method ?? 'GET', headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers }, body: options.body ? JSON.stringify(options.body) : undefined, signal: controller.signal,
        ...(options.sanitized ? { cache: 'no-store', credentials: 'omit', redirect: 'error' } as const : {}) }), deadline]);
      const text = await Promise.race([response.text(), deadline]);
      let payload: unknown;
      try { payload = text ? JSON.parse(text) as unknown : undefined; }
      catch (error) { if (options.sanitized) throw new UnetContractError('verification_response_invalid'); throw error; }
      if (!response.ok) {
        if (options.allowUnavailableStatus && response.status === 503 && isObject(payload) && ['protocolVersion', 'status', 'sessionId'].some(k => Object.hasOwn(payload, k))) {
          validateV2Status(payload);
          if (payload.status !== 'unavailable' || payload.retryable !== true) throw new UnetContractError('verification_v2_contract_invalid');
          return payload;
        }
        const obj = isObject(payload) ? payload : {};
        const code = typeof obj.errorCode === 'string' ? obj.errorCode : typeof obj.error === 'string' ? obj.error : undefined;
        if (options.sanitized) {
          const allowed = ['verification_temporarily_unavailable', 'verification_not_found', 'verification_expired', 'verification_conflict', 'verification_busy', 'verification_lease_lost', 'verification_invalid_request', 'verification_freshness_elapsed', 'verification_attempt_limit', 'verification_authorization_required', 'protocol_upgrade_required', 'rate_limited'];
          throw new UnetApiError('verification_v2_request_failed', response.status, code && allowed.includes(code) ? code : undefined);
        }
        throw new UnetApiError(typeof obj.message === 'string' ? obj.message : `U-net API error ${response.status}`, response.status, typeof obj.errorCode === 'string' ? obj.errorCode : undefined, payload);
      }
      return payload;
    } catch (error) {
      if (controller.signal.aborted) throw new UnetTimeoutError();
      if (options.sanitized && !(error instanceof UnetApiError) && !(error instanceof UnetContractError)) throw new UnetApiError('verification_v2_transport_unavailable', 0);
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    }
  }
}

/** @public */
export const createUnetClient = (options?: UnetClientOptions): UnetClient => new UnetClient(options);
