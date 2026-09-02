import { createUnetClient, pollUntil } from '@u-net/client';
import type { CreateVerificationSessionInput, ListMiniProgramsOptions, ListVerificationChecksOptions, MiniProgramCatalogResponse, PollOptions, UnetClientOptions, VerificationCheckCatalogResponse, VerificationRequestedCheck, VerificationSession, VerificationSessionStatus } from '@u-net/client';

export type { CreateVerificationSessionInput, ListMiniProgramsOptions, ListVerificationChecksOptions, MiniProgramCatalogResponse, VerificationCheckCatalogResponse, VerificationRequestedCheck, VerificationSession, VerificationSessionStatus } from '@u-net/client';

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
