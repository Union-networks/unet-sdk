import {
  recoveryDigest, recoverySubmissions, validateRecoveryRecord,
  type RecoveryReceipt, type RecoveryRecord, type RecoverySubmission,
} from './issuanceRecovery.js';

/**
 * Request-specific evidence from the configured gateway, not independent RPC
 * verification or provider publication authorization. Coordinated SDK 2 RC only.
 * @beta
 */
export type RecoveryAnchorReconciliationResult =
  | { kind: 'confirmed'; receipt: RecoveryReceipt }
  | { kind: 'revoked' }
  | { kind: 'pending' }
  | { kind: 'unavailable' };

/** @beta */
export interface RecoveryAnchorReconciliationOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

const REQUEST_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const hash = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
const address = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
const integer = (value: unknown, minimum: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;

function exactObject(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || fields.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new Error('invalid_response');
  return value as Record<string, unknown>;
}

function endpoint(base: string): string {
  const url = new URL(base);
  if (typeof base !== 'string' || !/^https:\/\//i.test(base)
    || url.protocol !== 'https:' || url.username || url.password
    || base.includes('?') || base.includes('#') || base.split('/')[2].includes('@')) throw new Error('invalid_endpoint');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/v2/operations/anchor/reconcile`;
  return url.href;
}

// Follow Safety's bounded streaming transport pattern, including an explicit
// race for fetch implementations that ignore abort, and cleanup of late headers.
async function requestJson(url: string, body: string, fetcher: typeof fetch, deadline: number, signal?: AbortSignal): Promise<{
  status: number; payload: unknown;
}> {
  if (signal?.aborted) throw new Error('request_aborted');
  if (performance.now() >= deadline) throw new Error('request_stopped');
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let stopped = false;
  let completed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  function cancelBody(stream: ReadableStream<Uint8Array> | null): void {
    try { void stream?.cancel().catch(() => undefined); } catch { /* Best-effort cleanup. */ }
  }

  function releaseReader(): void {
    const current = reader;
    reader = undefined;
    if (!current) return;
    // Neither cancellation nor a stalled underlying source may extend the budget.
    try { void current.cancel().catch(() => undefined); } catch { /* Best-effort cleanup. */ }
    try { current.releaseLock(); } catch { /* Best-effort cleanup. */ }
  }

  function checkDeadline(): void {
    if (stopped || signal?.aborted || performance.now() >= deadline) throw new Error('request_stopped');
  }

  const interrupted = new Promise<never>((_, reject) => {
    const stop = () => {
      stopped = true;
      reject(new Error('request_stopped'));
      controller.abort();
      releaseReader();
    };
    onAbort = stop;
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(stop, Math.max(0, deadline - performance.now()));
  });
  const response = (async () => {
    checkDeadline();
    const result = await fetcher(url, {
      method: 'POST', headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body,
      cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal,
    });
    try {
      checkDeadline();
      const contentType = result.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
      if (result.redirected || ![200, 202, 409].includes(result.status)
        || !result.body || contentType !== 'application/json') throw new Error('invalid_response');
      reader = result.body.getReader();
    } catch {
      cancelBody(result.body);
      throw new Error('invalid_response');
    }
    const current = reader;
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const chunk = await current.read();
      checkDeadline();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new Error('response_too_large');
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    checkDeadline();
    return { status: result.status, payload };
  })();
  try {
    const result = await Promise.race([response, interrupted]);
    checkDeadline();
    completed = true;
    return result;
  } finally {
    stopped = true;
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    if (!completed) controller.abort();
    releaseReader();
  }
}

function reconcileResponse(
  status: number, payload: unknown, record: RecoveryRecord, submission: RecoverySubmission,
): RecoveryAnchorReconciliationResult {
  if (status === 409) {
    const result = exactObject(payload, ['success', 'error']);
    // Only the configured, request-specific reconciliation gateway is trusted to
    // report revocation. Generic status reads and other conflicts are not evidence.
    return result.success === false && result.error === 'ledger_v2_attestation_revoked'
      ? { kind: 'revoked' } : { kind: 'unavailable' };
  }
  if (status === 202) {
    const result = exactObject(payload, ['success', 'protocolVersion', 'status', 'reason']);
    return result.success === true && result.protocolVersion === 2 && result.status === 'pending'
      && typeof result.reason === 'string'
      && ['receipt_pending', 'insufficient_confirmations', 'reorg_detected'].includes(result.reason)
      ? { kind: 'pending' } : { kind: 'unavailable' };
  }
  const result = exactObject(payload, ['success', 'protocolVersion', 'status', 'receipt']);
  if (status !== 200 || result.success !== true || result.protocolVersion !== 2 || result.status !== 'confirmed') {
    return { kind: 'unavailable' };
  }
  const receipt = exactObject(result.receipt, ['chainId', 'ledgerAddress', 'attestationHash', 'issuerIdHash',
    'transactionHash', 'blockHash', 'blockNumber', 'confirmations', 'requiredConfirmations',
    'checkedHeadHash', 'checkedHeadNumber', 'status']);
  const { context } = record.input;
  const op = submission.operation;
  if (!integer(receipt.chainId, 1) || receipt.chainId !== context.chainId
    || !address(receipt.ledgerAddress) || receipt.ledgerAddress.toLowerCase() !== context.ledgerAddress.toLowerCase()
    || !hash(receipt.attestationHash) || receipt.attestationHash !== op.attestationHash
    || !hash(receipt.issuerIdHash) || receipt.issuerIdHash !== op.issuerIdHash
    || !hash(receipt.transactionHash) || !hash(receipt.blockHash) || !hash(receipt.checkedHeadHash)
    || !integer(receipt.blockNumber, 0) || !integer(receipt.checkedHeadNumber, 0)
    || !integer(receipt.confirmations, 1) || !integer(receipt.requiredConfirmations, 1)
    || receipt.requiredConfirmations < context.requiredConfirmations
    || receipt.confirmations < receipt.requiredConfirmations
    || receipt.checkedHeadNumber < receipt.blockNumber
    || receipt.confirmations !== receipt.checkedHeadNumber - receipt.blockNumber + 1
    || (receipt.checkedHeadNumber === receipt.blockNumber && receipt.checkedHeadHash !== receipt.blockHash)
    || receipt.status !== 'active') return { kind: 'unavailable' };
  // A confirmed journal can refresh depth, never switch its saved attempt or
  // transaction/block binding on a later recovery check.
  if (record.receipt && (record.receipt.submissionDigest !== recoveryDigest(submission)
    || record.receipt.transactionHash !== receipt.transactionHash
    || record.receipt.blockHash !== receipt.blockHash
    || record.receipt.blockNumber !== receipt.blockNumber)) return { kind: 'unavailable' };
  return { kind: 'confirmed', receipt: {
    chainId: receipt.chainId, ledgerAddress: receipt.ledgerAddress,
    attestationHash: receipt.attestationHash, issuerIdHash: receipt.issuerIdHash,
    holderRevocationSigner: op.holderRevocationSigner, requestIdHash: op.requestIdHash,
    submissionDigest: recoveryDigest(submission), transactionHash: receipt.transactionHash,
    blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, confirmations: receipt.confirmations,
  } };
}

/**
 * Coordinated SDK 2 RC candidate, not approved stable. Reconcile exact durable
 * submission bytes through the configured gateway outside provider transactions.
 * This does not mutate the journal. Before publication, recheck policy and apply
 * the result under the provider's owned, pinned transaction and current lease.
 * @beta
 */
export async function reconcileRecoveryAnchor(
  record: RecoveryRecord,
  readUrl: string,
  options: RecoveryAnchorReconciliationOptions = {},
): Promise<RecoveryAnchorReconciliationResult> {
  try {
    // Snapshot and validate synchronously, before fetch or the first await. Never
    // refresh or re-sign here: each request uses one attempt's exact durable bytes.
    const snapshot = structuredClone(record);
    validateRecoveryRecord(snapshot);
    if (!['submitted', 'confirmed'].includes(snapshot.phase) || !snapshot.preparation || !snapshot.submission) return { kind: 'unavailable' };
    const { chainId, ledgerAddress, requiredConfirmations } = snapshot.input.context;
    const url = endpoint(readUrl);
    const newestFirst = recoverySubmissions(snapshot).reverse();
    const offset = Math.max(0, snapshot.attempts - 1) % newestFirst.length;
    // Rotate by durable claim count so a stalled newest attempt cannot starve
    // history across worker retries. Confirmed checks stay pinned to one attempt.
    const attempts = snapshot.receipt
      ? newestFirst.filter(attempt => recoveryDigest(attempt) === snapshot.receipt!.submissionDigest)
      : [...newestFirst.slice(offset), ...newestFirst.slice(0, offset)];
    const deadline = performance.now() + REQUEST_MS;
    let unavailable = false;
    for (const submission of attempts) {
      if (options.signal?.aborted || performance.now() >= deadline) return { kind: 'unavailable' };
      try {
        const { operation, signature } = submission;
        const body = JSON.stringify({ chainId, ledgerAddress, requiredConfirmations, operation, signature });
        const response = await requestJson(url, body, options.fetch ?? globalThis.fetch, deadline, options.signal);
        const result = reconcileResponse(response.status, response.payload, snapshot, submission);
        if (options.signal?.aborted || performance.now() >= deadline) return { kind: 'unavailable' };
        if (result.kind === 'confirmed' || result.kind === 'revoked') return result;
        if (result.kind === 'unavailable') unavailable = true;
      } catch {
        unavailable = true;
      }
    }
    return { kind: unavailable ? 'unavailable' : 'pending' };
  } catch {
    // No caller data, gateway bodies, or raw dependency errors leave this boundary.
    return { kind: 'unavailable' };
  }
}
