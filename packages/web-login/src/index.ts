import { createUnetClient, pollUntil } from '@union-networks/client';
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
