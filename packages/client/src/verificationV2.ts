import { UnetClient } from './http.js';
export { canonicalVerificationV2Json, verificationV2RequestedChecksDigest } from './verificationV2Json.js';
import { UnetTimeoutError } from './errors.js';
import type { PollOptions, UnetClientOptions } from './types.js';
import type { CreateVerificationV2SessionInput, GetVerificationV2StatusInput, VerificationV2Challenge, VerificationV2Jwks, VerificationV2RequestOptions, VerificationV2Session, VerificationV2Status, VerificationV2Submission } from './verificationV2Types.js';

/** Create a manual V2 challenge and private polling authority. @public */
export const createVerificationV2Session = (input: CreateVerificationV2SessionInput, options?: UnetClientOptions & VerificationV2RequestOptions): Promise<VerificationV2Session> =>
  new UnetClient(options).createVerificationV2Session(input, options);
/** Fetch the public challenge; its reference cannot read private results. @public */
export const getVerificationV2Challenge = (requestRef: string, options?: UnetClientOptions & VerificationV2RequestOptions): Promise<VerificationV2Challenge> =>
  new UnetClient(options).getVerificationV2Challenge(requestRef, options);
/** Submit consented native proofs once; preserve submissionId for explicit retry. @public */
export const submitVerificationV2Response = (requestRef: string, submission: VerificationV2Submission, options?: UnetClientOptions & VerificationV2RequestOptions): Promise<VerificationV2Status> =>
  new UnetClient(options).submitVerificationV2Response(requestRef, submission, options);
/** Read lifecycle state with header-only private polling authority. @public */
export const getVerificationV2Status = (input: GetVerificationV2StatusInput, options?: UnetClientOptions & VerificationV2RequestOptions): Promise<VerificationV2Status> =>
  new UnetClient(options).getVerificationV2Status(input, options);
/** Obtain purpose-specific result keys from the configured trusted origin. @public */
export const getVerificationV2Jwks = (options?: UnetClientOptions & VerificationV2RequestOptions): Promise<VerificationV2Jwks> =>
  new UnetClient(options).getVerificationV2Jwks(options);

/** Non-overlapping, cancellable polling; 2 seconds between reads, 2 minutes total by default.
 * Stop this controller while the presentation is hidden or backgrounded.
 * @public
 */
export async function pollVerificationV2Result(input: GetVerificationV2StatusInput, options: UnetClientOptions & PollOptions = {}): Promise<VerificationV2Status> {
  const interval = options.intervalMs ?? 2_000;
  const budget = options.timeoutMs ?? 120_000;
  if (!Number.isFinite(interval) || interval < 1 || !Number.isFinite(budget) || budget < 1) throw new UnetTimeoutError('verification_v2_poll_budget_invalid');
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, budget);
  const client = new UnetClient(options);
  try {
    for (;;) {
      if (controller.signal.aborted) throw new UnetTimeoutError();
      const result = await client.getVerificationV2Status(input, { signal: controller.signal });
      if (!['created', 'verifying'].includes(result.status)) return result;
      await new Promise<void>((resolve, reject) => {
        const cancel = () => { clearTimeout(wait); reject(new UnetTimeoutError()); };
        const wait = setTimeout(() => { controller.signal.removeEventListener('abort', cancel); resolve(); }, interval);
        controller.signal.addEventListener('abort', cancel, { once: true });
        if (controller.signal.aborted) cancel();
      });
    }
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
