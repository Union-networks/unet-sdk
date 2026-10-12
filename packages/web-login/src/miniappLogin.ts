import type { DirectProviderLoginChallenge } from './index.js';

/** An account obtained from the provider's authenticated session, not a host hint.
 * @public
 */
export interface MiniappLoginAccount {
  scopedUserId: string;
}

/** The host.createServiceSession approval for this exact browser challenge.
 * @public
 */
export interface MiniappLoginApproval {
  requestRef: string;
  approved: true;
  scopedUserId: string;
  /** Fixed V1 capability fields; exchange and initial status have at most 15 seconds after approval. */
  launchReadiness: {
    /** The only supported readiness protocol version. */
    version: 1;
    /** Native-issued capability: exactly 64 hexadecimal characters. Never put it in a URL or log. */
    launchToken: string;
    /** Safe-integer Unix milliseconds, strictly future and at most 30 seconds from receipt. */
    expiresAtMs: number;
  };
}

/** The complete host.completeLaunch payload. No account or session data is sent.
 * @public
 */
export interface MiniappLaunchCompletion {
  requestRef: string;
  launchToken: string;
  state: 'ready' | 'failed';
  stage: 'initial_status';
  outcome: 'success' | 'unavailable';
}

/** Transport adapters must preserve the initiating WebView's same-origin cookie.
 * @public
 */
export interface MiniappLoginOptions<Account extends MiniappLoginAccount> {
  origin: string;
  signal?: AbortSignal;
  /** Positive integer milliseconds, at most 60 seconds (default). After approval the native initial-status budget is at most 15 seconds, also bounded by challenge/readiness expiry. */
  timeoutMs?: number;
  createChallenge: (signal: AbortSignal) => Promise<DirectProviderLoginChallenge>;
  approve: (challenge: DirectProviderLoginChallenge, signal: AbortSignal) => Promise<MiniappLoginApproval>;
  exchange: (challenge: DirectProviderLoginChallenge, signal: AbortSignal) => Promise<Account>;
  /** Return the authoritative initial-status account within the shared 15-second post-approval budget. */
  initialize: (account: Account, signal: AbortSignal) => Promise<Account>;
  /** Forward the host acknowledgement. Ready requires an object with completed: true; void or success-only is not acknowledgement. */
  complete: (completion: MiniappLaunchCompletion, signal: AbortSignal) => Promise<unknown>;
}

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

// Race even non-cooperative adapters, and consume their late settlements without continuing the flow.
const runStep = <T>(signal: AbortSignal, operation: () => Promise<T>, failureCode: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(new Error('miniapp_login_aborted'));
    };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw new Error('miniapp_login_aborted');
      return operation();
    }).then(resolve, () => reject(new Error(failureCode))).finally(() => signal.removeEventListener('abort', abort));
  });

/** Approve, redeem, and initialize one browser-bound miniapp launch before reporting readiness.
 * Never navigates, logs identifiers, or sends account/session data to the host.
 * @public
 */
export async function runMiniappLogin<Account extends MiniappLoginAccount>(options: MiniappLoginOptions<Account>): Promise<Account> {
  let origin: string;
  try {
    const url = new URL(options.origin);
    if (url.protocol !== 'https:' || url.username || url.password
      || (typeof globalThis.location !== 'undefined' && globalThis.location.origin !== url.origin)) throw new Error();
    origin = url.origin;
  } catch {
    throw new Error('miniapp_login_origin_mismatch');
  }
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new Error('miniapp_login_timeout_invalid');
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  let deadline = Date.now() + timeoutMs;
  let timer = setTimeout(abort, timeoutMs);
  const checkDeadline = () => {
    if (Date.now() >= deadline) abort();
    if (controller.signal.aborted) throw new Error('miniapp_login_aborted');
  };
  const boundDeadline = (expiresAtMs: number) => {
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) throw new Error('miniapp_login_expired');
    deadline = Math.min(deadline, expiresAtMs);
    clearTimeout(timer);
    timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
    checkDeadline();
  };
  let approval: MiniappLoginApproval | undefined;
  let completionStarted = false;
  try {
    checkDeadline();
    const created = await runStep(controller.signal, () => options.createChallenge(controller.signal), 'miniapp_login_challenge_failed');
    const challenge = Object.freeze({ ...created });
    checkDeadline();
    try {
      if (challenge?.protocolVersion !== 2 || challenge.origin !== origin || !nonempty(challenge.requestRef)
        || !nonempty(challenge.serviceId) || !nonempty(challenge.challenge)) throw new Error();
      for (const endpoint of [challenge.challengeUrl, challenge.approvalUrl]) {
        const url = new URL(endpoint);
        if (url.origin !== origin || url.username || url.password || url.hash) throw new Error();
      }
    } catch {
      throw new Error('miniapp_login_challenge_invalid');
    }
    boundDeadline(Date.parse(challenge.expiresAtIso));
    const approved = await runStep(controller.signal, () => options.approve(challenge, controller.signal), 'miniapp_login_approval_failed');
    checkDeadline();
    const readiness = approved?.launchReadiness;
    if (approved?.approved !== true || approved.requestRef !== challenge.requestRef || !nonempty(approved.scopedUserId)
      || readiness?.version !== 1 || typeof readiness.launchToken !== 'string' || readiness.launchToken.length !== 64 || !/^[0-9a-f]{64}$/i.test(readiness.launchToken)
      || Object.keys(readiness).length !== 3 || !Number.isSafeInteger(readiness.expiresAtMs)
      || readiness.expiresAtMs > Date.now() + 30_000) throw new Error('miniapp_login_approval_invalid');
    boundDeadline(readiness.expiresAtMs);
    boundDeadline(Date.now() + 15_000);
    approval = {
      requestRef: approved.requestRef, approved: true, scopedUserId: approved.scopedUserId,
      launchReadiness: { version: 1, launchToken: readiness.launchToken, expiresAtMs: readiness.expiresAtMs },
    };
    const account = await runStep(controller.signal, () => options.exchange(challenge, controller.signal), 'miniapp_login_exchange_failed');
    checkDeadline();
    if (account?.scopedUserId !== approval.scopedUserId) throw new Error('miniapp_login_account_mismatch');
    const initialized = await runStep(controller.signal, () => options.initialize(account, controller.signal), 'miniapp_login_initial_status_failed');
    checkDeadline();
    if (initialized?.scopedUserId !== approval.scopedUserId) throw new Error('miniapp_login_account_mismatch');
    const acknowledgement = await runStep(controller.signal, () => {
      completionStarted = true;
      return options.complete({
        requestRef: approval!.requestRef, launchToken: approval!.launchReadiness.launchToken,
        state: 'ready', stage: 'initial_status', outcome: 'success',
      }, controller.signal);
    }, 'miniapp_login_complete_failed');
    checkDeadline();
    if (typeof acknowledgement !== 'object' || acknowledgement === null || Array.isArray(acknowledgement)
      || !Object.hasOwn(acknowledgement, 'completed') || (acknowledgement as { completed?: unknown }).completed !== true) throw new Error('miniapp_login_complete_unconfirmed');
    return initialized;
  } catch (error) {
    // A failed launch may still need reporting after cancellation. Never retry an ambiguous ready acknowledgement.
    if (approval && !completionStarted) {
      const remaining = Math.min(5_000, approval.launchReadiness.expiresAtMs - Date.now());
      if (remaining > 0) {
        const cleanup = new AbortController();
        const cleanupTimer = setTimeout(() => cleanup.abort(), remaining);
        try {
          await runStep(cleanup.signal, () => options.complete({
            requestRef: approval!.requestRef, launchToken: approval!.launchReadiness.launchToken,
            state: 'failed', stage: 'initial_status', outcome: 'unavailable',
          }, cleanup.signal), 'miniapp_login_complete_failed');
        } catch {
          // Preserve the login failure; host readiness expiry is the fallback.
        } finally {
          clearTimeout(cleanupTimer);
          cleanup.abort();
        }
      }
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}
