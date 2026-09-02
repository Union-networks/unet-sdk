import { UnetApiError, UnetContractError } from './errors.js';
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
  private async request(baseUrl: string, path: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.defaultTimeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${baseUrl}${path}`, { method: options.method ?? 'GET', headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    const text = await response.text();
    const payload = text ? JSON.parse(text) as unknown : undefined;
    if (!response.ok) {
      const obj = isObject(payload) ? payload : {};
      throw new UnetApiError(typeof obj.message === 'string' ? obj.message : `U-net API error ${response.status}`, response.status, typeof obj.errorCode === 'string' ? obj.errorCode : undefined, payload);
    }
    return payload;
  }
}

export const createUnetClient = (options?: UnetClientOptions): UnetClient => new UnetClient(options);
