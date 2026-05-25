import { createUnetClient, pollUntil } from '@union-networks/client';
import type { CheckoutVerificationResponse, CreateCheckoutVerificationInput, CreateVerificationSessionInput, ListMiniProgramsOptions, ListVerificationChecksOptions, MiniProgramCatalogResponse, PollOptions, UnetClientOptions, VerificationCheckCatalogResponse, VerificationRequestedCheck, VerificationSession, VerificationSessionStatus } from '@union-networks/client';

export type { CheckoutVerificationResponse, CreateCheckoutVerificationInput, CreateVerificationSessionInput, ListMiniProgramsOptions, ListVerificationChecksOptions, MiniProgramCatalogResponse, VerificationCheckCatalogResponse, VerificationRequestedCheck, VerificationSession, VerificationSessionStatus } from '@union-networks/client';

export const listVerificationChecks = (input: ListVerificationChecksOptions = {}, options?: UnetClientOptions): Promise<VerificationCheckCatalogResponse> =>
  createUnetClient(options).listVerificationChecks(input);

export async function* iterateVerificationChecks(input: ListVerificationChecksOptions = {}, options?: UnetClientOptions): AsyncGenerator<VerificationRequestedCheck, void, void> {
  yield* createUnetClient(options).iterateVerificationChecks(input);
}

export const listMiniPrograms = (input: ListMiniProgramsOptions = {}, options?: UnetClientOptions): Promise<MiniProgramCatalogResponse> =>
  createUnetClient(options).listMiniPrograms(input);

export const createVerificationSession = (input: CreateVerificationSessionInput, options?: UnetClientOptions): Promise<VerificationSession> =>
  createUnetClient(options).createVerificationSession(input);

export const pollVerificationResult = (sessionId: string, options?: PollOptions & UnetClientOptions): Promise<VerificationSessionStatus> =>
  pollUntil(() => createUnetClient(options).getVerificationSession(sessionId), (result) => ['verified', 'denied', 'rejected', 'expired', 'unavailable'].includes(result.status), options);

export const createCheckoutVerification = (input: CreateCheckoutVerificationInput, options?: UnetClientOptions): Promise<CheckoutVerificationResponse> =>
  createUnetClient(options).createCheckoutVerification(input);

export const pollCheckoutVerification = (input: { checkoutId: string; serviceId?: string; assertionJws: string }, options?: PollOptions & UnetClientOptions): Promise<CheckoutVerificationResponse> =>
  pollUntil(() => createUnetClient(options).getCheckoutVerification(input), (result) => result.checkout.status !== 'pending_verification', options);
