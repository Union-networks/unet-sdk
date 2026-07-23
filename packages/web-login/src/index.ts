import { createUnetClient, pollUntil, UnetApiError } from '@union-networks/client';
import type { CreateServiceSessionInput, CreateWebLoginSessionInput, PollOptions, ResolveWebLoginServiceInput, ServiceSessionResponse, UnetClientOptions, WebLoginServiceResolveResponse, WebLoginSession } from '@union-networks/client';

export type { CreateServiceSessionInput, CreateWebLoginSessionInput, ResolveWebLoginServiceInput, ServiceSessionResponse, UnetMiniAppManifest, WebLoginService, WebLoginServiceResolveResponse, WebLoginSession } from '@union-networks/client';

export const createLoginSession = (input: CreateWebLoginSessionInput, options?: UnetClientOptions): Promise<WebLoginSession> =>
  createUnetClient(options).createLoginSession(input);

export const resolveWebLoginService = (input: ResolveWebLoginServiceInput, options?: UnetClientOptions): Promise<WebLoginServiceResolveResponse> =>
  createUnetClient(options).resolveWebLoginService(input);

export const createServiceSession = (input: CreateServiceSessionInput, options?: UnetClientOptions): Promise<ServiceSessionResponse> =>
  createUnetClient(options).createServiceSession(input);

export const pollLoginSession = (sessionId: string, options?: PollOptions & UnetClientOptions): Promise<WebLoginSession> =>
  pollUntil(() => createUnetClient(options).getLoginSession(sessionId), (session) => session.status !== 'pending', options);

export const renderLoginQrPayload = (session: WebLoginSession): string => {
  if (session.qrPayload) return session.qrPayload;
  return `unet://web-login?payload=${encodeURIComponent(JSON.stringify({ kind: 'unet_web_login', version: 1, requestRef: session.requestRef }))}`;
};

export const isApprovedLoginResult = (result: WebLoginSession): boolean => result.status === 'approved' && Boolean(result.scopedUserId && result.assertionJws);

export type DomainAdministrationRole = 'owner' | 'admin';
export interface DomainAdministrationSelection { serviceId: string; role: DomainAdministrationRole; attestationCommitment: string; }
export interface DomainAdministrationProofRequest { serviceId: string; role: DomainAdministrationRole; status: 'proving' | 'failed'; reasonCode?: string; verification?: { sessionId: string; sessionRef: string; nonce: string; expiresAt: string; requestedChecks: Array<Record<string, unknown>>; }; }
export interface DomainAdministrationSelectionStatus { serviceId: string; role: DomainAdministrationRole; status: 'selected' | 'proving' | 'verified' | 'failed' | 'omitted'; reasonCode?: string; }

const dashboardRequest = async <T>(path: string, init: RequestInit, options?: UnetClientOptions): Promise<T> => {
  const baseUrl = (options?.issuerBaseUrl ?? 'https://issuer.egress.live').replace(/\/+$/, '');
  const fetcher = options?.fetchImpl ?? globalThis.fetch;
  const response = await fetcher.call(globalThis, `${baseUrl}${path}`, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) as any : undefined;
  if (!response.ok) throw new UnetApiError(payload?.message ?? `U-net web login error ${response.status}`, response.status, payload?.errorCode, payload);
  return payload as T;
};

export const submitDomainAdministrationSelections = (requestRef: string, selections: DomainAdministrationSelection[], options?: UnetClientOptions) =>
  dashboardRequest<{ success: true; results: DomainAdministrationProofRequest[] }>(`/v1/web-login/requests/${encodeURIComponent(requestRef)}/domain-administration/selections`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selections }) }, options);

export const getDomainAdministrationSelectionStatus = (requestRef: string, options?: UnetClientOptions) =>
  dashboardRequest<{ success: true; selections: DomainAdministrationSelectionStatus[] }>(`/v1/web-login/requests/${encodeURIComponent(requestRef)}/domain-administration/status`, { headers: { accept: 'application/json' } }, options);
