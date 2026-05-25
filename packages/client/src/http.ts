import { UnetApiError, UnetContractError } from './errors.js';
import type { CheckoutVerificationResponse, CreateCheckoutVerificationInput, CreateServiceSessionInput, CreateVerificationSessionInput, CreateWebLoginSessionInput, ListMiniProgramsOptions, ListVerificationChecksOptions, MiniProgramCatalogResponse, ResolveWebLoginServiceInput, ServiceSessionResponse, UnetClientOptions, VerificationCheckCatalogResponse, VerificationSession, VerificationSessionStatus, WebLoginServiceResolveResponse, WebLoginSession } from './types.js';

const DEFAULT_ISSUER = 'https://issuer.egress.live';
const DEFAULT_VERIFIER = 'https://verifier.egress.live';

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
  private readonly issuerBaseUrl: string;
  private readonly verifierBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  public constructor(options: UnetClientOptions = {}) {
    this.issuerBaseUrl = (options.issuerBaseUrl ?? DEFAULT_ISSUER).replace(/\/+$/, '');
    this.verifierBaseUrl = (options.verifierBaseUrl ?? options.issuerBaseUrl ?? DEFAULT_VERIFIER).replace(/\/+$/, '');
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.fetchImpl = ((input, init) => fetchImpl.call(globalThis, input, init)) as typeof fetch;
  }
  public async createLoginSession(input: CreateWebLoginSessionInput): Promise<WebLoginSession> {
    const payload = await this.request(this.issuerBaseUrl, '/v1/web-login/sessions', { method: 'POST', body: input });
    return this.assertWebLoginSession(payload);
  }
  public async getLoginSession(sessionId: string): Promise<WebLoginSession> {
    const payload = await this.request(this.issuerBaseUrl, `/v1/web-login/sessions/${encodeURIComponent(sessionId)}`);
    return this.assertWebLoginSession(payload);
  }
  public async resolveWebLoginService(input: ResolveWebLoginServiceInput): Promise<WebLoginServiceResolveResponse> {
    const payload = await this.request(this.issuerBaseUrl, withQuery('/v1/web-login/services/resolve', input));
    if (!isObject(payload) || !isObject(payload.service)) throw new UnetContractError('Invalid web login service resolve response', payload);
    requireString(payload.service, 'serviceId'); requireString(payload.service, 'origin');
    return payload as unknown as WebLoginServiceResolveResponse;
  }
  public async createServiceSession(input: CreateServiceSessionInput): Promise<ServiceSessionResponse> {
    const payload = await this.request(this.issuerBaseUrl, '/v1/web-login/service-session', { method: 'POST', body: input });
    if (!isObject(payload)) throw new UnetContractError('Invalid service session response', payload);
    requireString(payload, 'serviceId'); requireString(payload, 'scopedUserId'); requireString(payload, 'sessionId'); requireString(payload, 'assertionJws');
    return payload as unknown as ServiceSessionResponse;
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
    const payload = await this.request(this.issuerBaseUrl, withQuery('/v1/mini-programs', options));
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
  public async createCheckoutVerification(input: CreateCheckoutVerificationInput): Promise<CheckoutVerificationResponse> {
    const { assertionJws, ...body } = input;
    const payload = await this.request(this.issuerBaseUrl, '/v1/checkout-verifications', { method: 'POST', body, token: assertionJws });
    return this.assertCheckoutVerification(payload);
  }
  public async getCheckoutVerification(input: { checkoutId: string; serviceId?: string; assertionJws: string }): Promise<CheckoutVerificationResponse> {
    const serviceQuery = input.serviceId ? `?serviceId=${encodeURIComponent(input.serviceId)}` : '';
    const payload = await this.request(this.issuerBaseUrl, `/v1/checkout-verifications/${encodeURIComponent(input.checkoutId)}${serviceQuery}`, { token: input.assertionJws });
    return this.assertCheckoutVerification(payload);
  }
  private async request(baseUrl: string, path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<unknown> {
    const response = await this.fetchImpl(`${baseUrl}${path}`, { method: options.method ?? 'GET', headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined });
    const text = await response.text();
    const payload = text ? JSON.parse(text) as unknown : undefined;
    if (!response.ok) {
      const obj = isObject(payload) ? payload : {};
      throw new UnetApiError(typeof obj.message === 'string' ? obj.message : `U-net API error ${response.status}`, response.status, typeof obj.errorCode === 'string' ? obj.errorCode : undefined, payload);
    }
    return payload;
  }
  private assertWebLoginSession(payload: unknown): WebLoginSession {
    if (!isObject(payload)) throw new UnetContractError('Invalid web login session response', payload);
    requireString(payload, 'sessionId'); requireString(payload, 'requestRef'); requireString(payload, 'serviceId'); requireString(payload, 'origin'); requireString(payload, 'status');
    return payload as unknown as WebLoginSession;
  }
  private assertCheckoutVerification(payload: unknown): CheckoutVerificationResponse {
    if (!isObject(payload) || !isObject(payload.checkout)) throw new UnetContractError('Invalid checkout verification response', payload);
    requireString(payload.checkout, 'checkoutId'); requireString(payload.checkout, 'status');
    return payload as unknown as CheckoutVerificationResponse;
  }
}

export const createUnetClient = (options?: UnetClientOptions): UnetClient => new UnetClient(options);
