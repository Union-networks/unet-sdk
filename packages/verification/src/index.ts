import { createUnetClient, pollUntil } from '@u-net/client';
import type { CreateVerificationSessionInput, ListMiniProgramsOptions, ListVerificationChecksOptions, MiniProgramCatalogResponse, PollOptions, UnetClientOptions, VerificationCheckCatalogResponse, VerificationRequestedCheck, VerificationSession, VerificationSessionStatus } from '@u-net/client';

export type { CreateVerificationSessionInput, ListMiniProgramsOptions, ListVerificationChecksOptions, MiniProgramCatalogResponse, VerificationCheckCatalogResponse, VerificationRequestedCheck, VerificationSession, VerificationSessionStatus } from '@u-net/client';

/** @public */
export const listVerificationChecks = (input: ListVerificationChecksOptions = {}, options?: UnetClientOptions): Promise<VerificationCheckCatalogResponse> =>
  createUnetClient(options).listVerificationChecks(input);

/** @public */
export async function* iterateVerificationChecks(input: ListVerificationChecksOptions = {}, options?: UnetClientOptions): AsyncGenerator<VerificationRequestedCheck, void, void> {
  yield* createUnetClient(options).iterateVerificationChecks(input);
}

/** @public */
export const listMiniPrograms = (input: ListMiniProgramsOptions = {}, options?: UnetClientOptions): Promise<MiniProgramCatalogResponse> =>
  createUnetClient(options).listMiniPrograms(input);

/** @public */
export const createVerificationSession = (input: CreateVerificationSessionInput, options?: UnetClientOptions): Promise<VerificationSession> =>
  createUnetClient(options).createVerificationSession(input);

/** @public */
export const pollVerificationResult = (sessionId: string, options?: PollOptions & UnetClientOptions): Promise<VerificationSessionStatus> =>
  pollUntil(() => createUnetClient(options).getVerificationSession(sessionId), (result) => ['verified', 'denied', 'rejected', 'expired', 'unavailable'].includes(result.status), options);
