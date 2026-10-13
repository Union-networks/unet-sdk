import { createUnetClient, pollUntil } from '@u-net/client';
export { createVerificationV2Session, getVerificationV2Challenge, submitVerificationV2Response, getVerificationV2Status, getVerificationV2Jwks, pollVerificationV2Result, canonicalVerificationV2Json, verificationV2RequestedChecksDigest } from '@u-net/client';
export type { CreateVerificationV2SessionInput, GetVerificationV2StatusInput, VerificationV2RequestOptions, VerificationV2Check, VerificationV2Challenge, VerificationV2Session, VerificationV2Proof, VerificationV2CheckResponse, VerificationV2Submission, VerificationV2Reason, VerificationV2CheckResult, VerificationV2ReceiptPayload, VerificationV2Status, VerificationV2Jwk, VerificationV2Jwks } from '@u-net/client';
export * from './receiptV2.js';
export type { VerificationV2RequestedCheck, VerificationV2WitnessSchemaEntry } from '@u-net/client';
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

/** Legacy V1 helper; use createVerificationV2Session for manual V2 flows. @public */
export const createVerificationSession = (input: CreateVerificationSessionInput, options?: UnetClientOptions): Promise<VerificationSession> =>
  createUnetClient(options).createVerificationSession(input);

/** Legacy V1 polling; V2 results require pollVerificationV2Result and private authority. @public */
export const pollVerificationResult = (sessionId: string, options?: PollOptions & UnetClientOptions): Promise<VerificationSessionStatus> =>
  pollUntil(() => createUnetClient(options).getVerificationSession(sessionId), (result) => ['verified', 'denied', 'rejected', 'expired', 'unavailable'].includes(result.status), options);
