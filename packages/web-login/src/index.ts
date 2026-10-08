import { pollUntil, UnetApiError } from '@u-net/client';
import type { PollOptions, ResolveServiceInput, ServiceResolution, UnetClientOptions } from '@u-net/client';

/** A short-lived challenge created and stored by the provider.
 * @public
 */
export interface DirectProviderLoginChallenge {
  protocolVersion: 2;
  requestRef: string;
  serviceId: string;
  origin: string;
  challenge: string;
  challengeUrl: string;
  approvalUrl: string;
  expiresAtIso: string;
}

/** Browser-cookie authenticated lifecycle state; never contains bearer session data.
 * @public
 */
export interface DirectProviderLoginPollResult {
  state: 'pending' | 'approved' | 'consumed' | 'expired';
}

/** @public */
export interface DirectProviderLoginOptions {
  challengePath?: string;
  statusPath?: string;
  exchangePath?: string;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
}

const providerRequest = async <T>(origin: string, path: string, init: RequestInit | undefined, options: DirectProviderLoginOptions): Promise<T> => {
  const normalizedOrigin = new URL(origin).origin;
  const url = new URL(path, normalizedOrigin);
  if (url.protocol !== 'https:' || url.origin !== normalizedOrigin) throw new Error('direct_login_origin_mismatch');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await (options.fetchImpl ?? globalThis.fetch)(url, { ...init, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new UnetApiError(String(payload.message ?? payload.error ?? `direct_login_http_${response.status}`), response.status, typeof payload.errorCode === 'string' ? payload.errorCode : undefined, payload);
    return payload as T;
  } finally {
    clearTimeout(timeout);
  }
};

/** Create a provider-owned Direct Login V2 challenge.
 * @public
 */
export const createDirectProviderLogin = async (
  origin: string,
  options: DirectProviderLoginOptions = {},
): Promise<DirectProviderLoginChallenge> => {
  const result = await providerRequest<{ success: boolean; challenge: DirectProviderLoginChallenge }>(origin, options.challengePath ?? '/api/unet/login/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, options);
  if (!result.success || result.challenge?.protocolVersion !== 2 || result.challenge.origin !== new URL(origin).origin) throw new Error('direct_login_challenge_invalid');
  return result.challenge;
};

/** Redeem only from the initiating browser/WebView. The server sets its session cookie.
 * @public
 */
export const exchangeDirectProviderLogin = (
  origin: string,
  requestRef: string,
  options: DirectProviderLoginOptions = {},
): Promise<{ success: boolean }> => providerRequest(origin, options.exchangePath ?? '/api/unet/login/exchange', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestRef }),
}, options);

/** Read a provider-owned Direct Login V2 challenge.
 * @public
 */
export const getDirectProviderLogin = (
  origin: string,
  requestRef: string,
  options: DirectProviderLoginOptions = {},
): Promise<DirectProviderLoginPollResult> => providerRequest(origin, `${options.statusPath ?? '/api/unet/login/status'}?requestRef=${encodeURIComponent(requestRef)}`, undefined, options);

/** Poll a provider-owned challenge until it leaves the pending state.
 * @public
 */
export const waitForDirectProviderLogin = (
  origin: string,
  requestRef: string,
  options: DirectProviderLoginOptions & PollOptions = {},
): Promise<DirectProviderLoginPollResult> => pollUntil(
  () => getDirectProviderLogin(origin, requestRef, options),
  (result) => result.state !== 'pending',
  options,
);

/** Encode a provider challenge for the U-net wallet scanner.
 * @public
 */
export const renderDirectLoginQrPayload = (challenge: DirectProviderLoginChallenge): string =>
  `unet://service-login?payload=${encodeURIComponent(JSON.stringify({
    kind: 'unet_service_login',
    version: 2,
    serviceId: challenge.serviceId,
    origin: challenge.origin,
    requestRef: challenge.requestRef,
    challengeUrl: challenge.challengeUrl,
    expiresAtIso: challenge.expiresAtIso,
  }))}`;

/** Return true only when the provider reports an exchangeable session.
 * @public
 */
export const isDirectProviderLoginApproved = (result: DirectProviderLoginPollResult): boolean =>
  result.state === 'approved';

/** Resolve public metadata for a verified Direct Login V2 service.
 * @public
 */
export const resolveDirectLoginService = (input: ResolveServiceInput, options?: UnetClientOptions): Promise<ServiceResolution> => {
  const baseUrl = (options?.controlPlaneUrl ?? 'https://issuer.egress.live').replace(/\/+$/, '');
  const search = new URLSearchParams({ serviceId: input.serviceId, origin: input.origin });
  return providerRequest<ServiceResolution>(baseUrl, `/v2/services/resolve?${search}`, undefined, {
    fetchImpl: options?.fetchImpl,
    timeoutMs: options?.defaultTimeoutMs,
  });
};

/** @public */
export type DomainAdministrationRole = 'owner' | 'admin';
/** @public */
export interface DomainAdministrationSelection { serviceId: string; role: DomainAdministrationRole; attestationCommitment: string; }
/** @public */
export interface DomainAdministrationProofRequest { serviceId: string; role: DomainAdministrationRole; status: 'proving' | 'failed'; reasonCode?: string; verification?: { sessionId: string; sessionRef: string; nonce: string; expiresAt: string; requestedChecks: Array<Record<string, unknown>>; }; }
/** @public */
export interface DomainAdministrationSelectionStatus { serviceId: string; role: DomainAdministrationRole; status: 'selected' | 'proving' | 'verified' | 'failed' | 'omitted'; reasonCode?: string; }

const controlPlaneRequest = async <T>(path: string, init: RequestInit, options?: UnetClientOptions): Promise<T> => {
  const baseUrl = (options?.controlPlaneUrl ?? 'https://issuer.egress.live').replace(/\/+$/, '');
  const fetcher = options?.fetchImpl ?? globalThis.fetch;
  const response = await fetcher.call(globalThis, `${baseUrl}${path}`, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (!response.ok) throw new UnetApiError(String(payload.message ?? `U-net dashboard login error ${response.status}`), response.status, typeof payload.errorCode === 'string' ? payload.errorCode : undefined, payload);
  return payload as T;
};

/** Submit optional Owner/Admin selections for a dashboard Direct Login challenge.
 * @public
 */
export const submitDirectDomainAdministrationSelections = (
  challenge: Pick<DirectProviderLoginChallenge, 'requestRef' | 'expiresAtIso'>,
  selections: DomainAdministrationSelection[],
  options?: UnetClientOptions,
) => controlPlaneRequest<{ success: true; results: DomainAdministrationProofRequest[] }>(
  `/v2/dashboard/direct-login/${encodeURIComponent(challenge.requestRef)}/domain-administration/selections`,
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expiresAt: challenge.expiresAtIso, selections: selections.slice(0, 10) }) },
  options,
);

/** Read optional Owner/Admin proof status for a dashboard Direct Login challenge.
 * @public
 */
export const getDirectDomainAdministrationSelectionStatus = (requestRef: string, options?: UnetClientOptions) =>
  controlPlaneRequest<{ success: true; selections: DomainAdministrationSelectionStatus[] }>(
    `/v2/dashboard/direct-login/${encodeURIComponent(requestRef)}/domain-administration/status`,
    { headers: { accept: 'application/json' } },
    options,
  );

export type { ResolveServiceInput, ServiceResolution, UnetClientOptions, VerifiedService } from '@u-net/client';
