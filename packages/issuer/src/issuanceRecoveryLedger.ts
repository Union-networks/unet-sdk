import {
  recoveryDigest, validateRecoveryRecord,
  type RecoveryReceipt, type RecoveryRecord,
} from './issuanceRecovery.js';

// Private checkpoint only: the configured gateway verifies request-specific chain
// evidence. This is not a provider coordinator or an independent RPC verifier.
type Reconciliation =
  | { kind: 'confirmed'; receipt: RecoveryReceipt }
  | { kind: 'revoked' }
  | { kind: 'pending' }
  | { kind: 'unavailable' };

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
async function requestJson(url: string, body: string, fetcher: typeof fetch, signal?: AbortSignal): Promise<{
  status: number; payload: unknown;
}> {
  if (signal?.aborted) throw new Error('request_aborted');
  const deadline = performance.now() + REQUEST_MS;
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
    timer = setTimeout(stop, REQUEST_MS);
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

function reconcileResponse(status: number, payload: unknown, record: RecoveryRecord): Reconciliation {
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
  const submission = record.submission!;
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
  return { kind: 'confirmed', receipt: {
    chainId: receipt.chainId, ledgerAddress: receipt.ledgerAddress,
    attestationHash: receipt.attestationHash, issuerIdHash: receipt.issuerIdHash,
    holderRevocationSigner: op.holderRevocationSigner, requestIdHash: op.requestIdHash,
    submissionDigest: recoveryDigest(submission), transactionHash: receipt.transactionHash,
    blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, confirmations: receipt.confirmations,
  } };
}

export async function reconcileRecoveryAnchor(
  record: RecoveryRecord,
  readUrl: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<Reconciliation> {
  try {
    // Snapshot and validate synchronously, before fetch or the first await. Never
    // refresh or re-sign an expired submission: these are its exact durable bytes.
    const snapshot = structuredClone(record);
    validateRecoveryRecord(snapshot);
    if (snapshot.phase !== 'submitted' || !snapshot.preparation || !snapshot.submission) return { kind: 'unavailable' };
    const { chainId, ledgerAddress, requiredConfirmations } = snapshot.input.context;
    const { operation, signature } = snapshot.submission;
    const body = JSON.stringify({ chainId, ledgerAddress, requiredConfirmations, operation, signature });
    const response = await requestJson(endpoint(readUrl), body, options.fetch ?? globalThis.fetch, options.signal);
    return reconcileResponse(response.status, response.payload, snapshot);
  } catch {
    // No caller data, gateway bodies, or raw dependency errors leave this boundary.
    return { kind: 'unavailable' };
  }
}
