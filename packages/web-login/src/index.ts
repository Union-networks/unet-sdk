import { createUnetClient, pollUntil } from '@unet/client';
import type { CreateWebLoginSessionInput, PollOptions, UnetClientOptions, WebLoginSession } from '@unet/client';

export type { CreateWebLoginSessionInput, WebLoginSession } from '@unet/client';

export const createLoginSession = (input: CreateWebLoginSessionInput, options?: UnetClientOptions): Promise<WebLoginSession> =>
  createUnetClient(options).createLoginSession(input);

export const pollLoginSession = (sessionId: string, options?: PollOptions & UnetClientOptions): Promise<WebLoginSession> =>
  pollUntil(() => createUnetClient(options).getLoginSession(sessionId), (session) => session.status !== 'pending', options);

export const renderLoginQrPayload = (session: WebLoginSession): string => {
  if (session.qrPayload) return session.qrPayload;
  return `unet://web-login?payload=${encodeURIComponent(JSON.stringify({ kind: 'unet_web_login', version: 1, requestRef: session.requestRef }))}`;
};

export const isApprovedLoginResult = (result: WebLoginSession): boolean => result.status === 'approved' && Boolean(result.scopedUserId && result.assertionJws);
