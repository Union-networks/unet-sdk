import { createUnetClient, pollUntil } from '@union-networks/client';
import type { CheckoutVerificationResponse, CreateCheckoutVerificationInput, CreateVerificationSessionInput, PollOptions, UnetClientOptions, VerificationCheckCatalogResponse, VerificationSession, VerificationSessionStatus } from '@union-networks/client';

export type { CheckoutVerificationResponse, CreateCheckoutVerificationInput, CreateVerificationSessionInput, VerificationSession, VerificationSessionStatus } from '@union-networks/client';

export const listVerificationChecks = (options?: UnetClientOptions): Promise<VerificationCheckCatalogResponse> =>
  createUnetClient(options).listVerificationChecks();

export const createVerificationSession = (input: CreateVerificationSessionInput, options?: UnetClientOptions): Promise<VerificationSession> =>
  createUnetClient(options).createVerificationSession(input);

export const pollVerificationResult = (sessionId: string, options?: PollOptions & UnetClientOptions): Promise<VerificationSessionStatus> =>
  pollUntil(() => createUnetClient(options).getVerificationSession(sessionId), (result) => ['verified', 'denied', 'rejected', 'expired', 'unavailable'].includes(result.status), options);

export const createCheckoutVerification = (input: CreateCheckoutVerificationInput, options?: UnetClientOptions): Promise<CheckoutVerificationResponse> =>
  createUnetClient(options).createCheckoutVerification(input);

export const pollCheckoutVerification = (input: { checkoutId: string; serviceId?: string; assertionJws: string }, options?: PollOptions & UnetClientOptions): Promise<CheckoutVerificationResponse> =>
  pollUntil(() => createUnetClient(options).getCheckoutVerification(input), (result) => result.checkout.status !== 'pending_verification', options);
