import { createHash } from 'node:crypto';
import type { DirectIssuerRequestRecord } from './directIssuer.js';
import { ledgerV2IssuerIdHash, ledgerV2RequestHash, type LedgerV2AnchorOperation } from './ledgerV2.js';

// Core recovery contracts staged for coordinated SDK 2 RC provider integration,
// not approved stable. Mutations and digests remain private implementation helpers.
// Providers compose journal and publication writes on one owned, pinned transaction.
/** @beta */
export interface RecoveryInput {
  request: DirectIssuerRequestRecord;
  context: {
    schemaId: string;
    chainId: number;
    ledgerAddress: string;
    issuerId: string;
    issuerIdHash: string;
    issuerKeyEpoch: number;
    requiredConfirmations: number;
    credentialKeyId: string;
    credentialKeyFingerprint: string;
    validFromEpoch: number;
    validUntilEpoch: number;
  };
}

/** @beta */
export interface RecoveryPreparation {
  attestationHash: string;
  encryptedCredentialEnvelope: Record<string, unknown>;
}

/** @beta */
export interface RecoverySubmission {
  operation: LedgerV2AnchorOperation;
  signature: string;
}

/** @beta */
export interface RecoveryReceipt {
  chainId: number;
  ledgerAddress: string;
  attestationHash: string;
  issuerIdHash: string;
  holderRevocationSigner: string;
  requestIdHash: string;
  submissionDigest: string;
  transactionHash: string;
  blockHash: string;
  blockNumber: number;
  confirmations: number;
}

/** @beta */
export type RecoveryPhase = 'reserved' | 'prepared' | 'submitted' | 'confirmed' | 'completed' | 'blocked';
/** @beta */
export type RecoveryFailure = 'dependency_unavailable' | 'receipt_pending' | 'policy_unavailable';
/** @beta */
export interface RecoveryRecord {
  requestId: string;
  input: RecoveryInput;
  inputDigest: string;
  phase: RecoveryPhase;
  revision: number;
  attempts: number;
  nextAttemptAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
  leaseToken?: string;
  leaseUntilMs?: number;
  preparation?: RecoveryPreparation;
  submission?: RecoverySubmission;
  /** Older attempts in append order; at most 32 attempts including submission. */
  previousSubmissions?: RecoverySubmission[];
  receipt?: RecoveryReceipt;
  failureCategory?: RecoveryFailure | 'policy_denied' | 'artifact_invalid';
}

/** @beta */
export type RecoveryAction =
  | { kind: 'prepare'; preparation: RecoveryPreparation }
  | { kind: 'submit'; submission: RecoverySubmission }
  | { kind: 'resubmit'; submission: RecoverySubmission }
  | { kind: 'confirm'; receipt: RecoveryReceipt }
  | { kind: 'complete' }
  | { kind: 'defer'; category: RecoveryFailure }
  | { kind: 'block'; category: 'policy_denied' | 'artifact_invalid' };

const hex32 = /^0x[0-9a-f]{64}$/;
const address = /^0x[0-9a-fA-F]{40}$/;
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const nonnegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const matches = (value: unknown, pattern: RegExp): value is string => typeof value === 'string' && pattern.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const failures = ['dependency_unavailable', 'receipt_pending', 'policy_unavailable', 'policy_denied', 'artifact_invalid'];
const MAX_SUBMISSIONS = 32;

// Chronological order. Call only after checking the persisted history shape.
export function recoverySubmissions(record: RecoveryRecord): RecoverySubmission[] {
  return [...(record.previousSubmissions ?? []), ...(record.submission ? [record.submission] : [])];
}

function submissionIdentity(submission: RecoverySubmission): string {
  // Re-signing the same operation or changing hex case is not a new attempt.
  return recoveryDigest({ ...submission.operation,
    holderRevocationSigner: submission.operation.holderRevocationSigner.toLowerCase() });
}

function keys(value: unknown, allowed: string[]): void {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('issuance_recovery_data_invalid');
}

function encodedBytes(value: unknown, length?: number): boolean {
  if (typeof value !== 'string' || value.length > 3_000_000 || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.toString('base64url') === value && (length === undefined ? bytes.length >= 16 : bytes.length === length);
}

function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error('issuance_recovery_data_invalid');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) throw new Error('issuance_recovery_data_invalid');
      items.push(canonical(value[index], depth + 1));
    }
    return `[${items.join(',')}]`;
  }
  if (object(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
  }
  throw new Error('issuance_recovery_data_invalid');
}

export function recoveryDigest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function copy<T>(value: T): T {
  return JSON.parse(canonical(value)) as T;
}

function validateInput(input: RecoveryInput): void {
  keys(input, ['request', 'context']);
  const request = input?.request;
  const context = input?.context;
  keys(request, ['requestId', 'deliveryCapabilityHash', 'state', 'createdAtIso', 'updatedAtIso', 'serviceAccountRef',
    'checkId', 'holderBinding', 'deliveryPublicKey', 'holderRevocationSigner', 'claims', 'consent', 'idempotencyKey',
    'attestationHash', 'encryptedCredentialEnvelope', 'ledgerTransactionHash', 'replacedAttestationHash', 'renewalOfRequestId', 'failureCategory']);
  keys(context, ['schemaId', 'chainId', 'ledgerAddress', 'issuerId', 'issuerIdHash', 'issuerKeyEpoch', 'requiredConfirmations', 'credentialKeyId',
    'credentialKeyFingerprint', 'validFromEpoch', 'validUntilEpoch']);
  if (!request || !context || request.state !== 'pending'
    || ![request.requestId, request.serviceAccountRef, request.checkId, request.holderBinding,
      request.deliveryPublicKey, request.idempotencyKey].every(text)
    || !matches(request.deliveryCapabilityHash, /^[0-9a-f]{64}$/)
    || !matches(request.holderRevocationSigner, address)
    || (request.renewalOfRequestId !== undefined && (!text(request.renewalOfRequestId) || request.renewalOfRequestId.length > 512))
    || request.attestationHash !== undefined || request.encryptedCredentialEnvelope !== undefined
    || request.ledgerTransactionHash !== undefined || request.failureCategory !== undefined
    || !text(context.schemaId) || context.schemaId.length > 512 || context.schemaId.includes('\0')
    || !positiveInteger(context.chainId) || !matches(context.ledgerAddress, address)
    || !text(context.issuerId) || context.issuerIdHash !== ledgerV2IssuerIdHash(context.issuerId)
    || !positiveInteger(context.issuerKeyEpoch) || !positiveInteger(context.requiredConfirmations) || !text(context.credentialKeyId)
    || !matches(context.credentialKeyFingerprint, hex32)
    || !nonnegativeInteger(context.validFromEpoch) || !positiveInteger(context.validUntilEpoch)
    || context.validUntilEpoch <= context.validFromEpoch) throw new Error('issuance_recovery_input_invalid');
  canonical(input);
}

function validatePreparation(preparation: RecoveryPreparation): void {
  keys(preparation, ['attestationHash', 'encryptedCredentialEnvelope']);
  const envelope = preparation.encryptedCredentialEnvelope;
  keys(envelope, ['version', 'algorithm', 'senderPublicKey', 'nonce', 'ciphertext']);
  if (!preparation || !matches(preparation.attestationHash, /^[0-9a-f]{64}$/)
    || envelope.version !== 2 || envelope.algorithm !== 'x25519-xchacha20poly1305'
    || !encodedBytes(envelope.senderPublicKey, 32) || !encodedBytes(envelope.nonce, 24)
    || !encodedBytes(envelope.ciphertext)) throw new Error('issuance_recovery_preparation_invalid');
  canonical(preparation);
}

function validateSubmission(record: RecoveryRecord, submission: RecoverySubmission): void {
  keys(submission, ['operation', 'signature']);
  const op = submission?.operation;
  keys(op, ['attestationHash', 'issuerIdHash', 'holderRevocationSigner', 'requestIdHash', 'issuerKeyEpoch', 'nonce', 'deadline']);
  const { context, request } = record.input;
  if (!op || !record.preparation || op.attestationHash !== `0x${record.preparation.attestationHash}`
    || op.issuerIdHash !== context.issuerIdHash || op.issuerKeyEpoch !== context.issuerKeyEpoch
    || op.requestIdHash !== ledgerV2RequestHash(request.requestId)
    || typeof op.holderRevocationSigner !== 'string'
    || op.holderRevocationSigner.toLowerCase() !== request.holderRevocationSigner.toLowerCase()
    || typeof op.nonce !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(op.nonce)
    || BigInt(op.nonce) >= (1n << 256n) || !positiveInteger(op.deadline)
    || !matches(submission.signature, /^0x[0-9a-fA-F]{128}(1b|1c)$/i)) throw new Error('issuance_recovery_submission_invalid');
  canonical(submission);
}

function validateReceipt(record: RecoveryRecord, receipt: RecoveryReceipt): void {
  keys(receipt, ['chainId', 'ledgerAddress', 'attestationHash', 'issuerIdHash', 'holderRevocationSigner',
    'requestIdHash', 'submissionDigest', 'transactionHash', 'blockHash', 'blockNumber', 'confirmations']);
  const submission = recoverySubmissions(record).find(attempt => recoveryDigest(attempt) === receipt.submissionDigest);
  const op = submission?.operation;
  const { context } = record.input;
  if (!op || !receipt || receipt.chainId !== context.chainId
    || typeof receipt.ledgerAddress !== 'string'
    || receipt.ledgerAddress.toLowerCase() !== context.ledgerAddress.toLowerCase()
    || receipt.attestationHash !== op.attestationHash || receipt.issuerIdHash !== op.issuerIdHash
    || typeof receipt.holderRevocationSigner !== 'string'
    || receipt.holderRevocationSigner.toLowerCase() !== op.holderRevocationSigner.toLowerCase()
    || receipt.requestIdHash !== op.requestIdHash
    || !matches(receipt.transactionHash, hex32) || !matches(receipt.blockHash, hex32)
    || !nonnegativeInteger(receipt.blockNumber) || !positiveInteger(receipt.confirmations)
    || receipt.confirmations < context.requiredConfirmations) throw new Error('issuance_recovery_receipt_invalid');
}

export function validateRecoveryRecord(record: RecoveryRecord): void {
  keys(record, ['requestId', 'input', 'inputDigest', 'phase', 'revision', 'attempts', 'nextAttemptAtMs', 'createdAtMs',
    'updatedAtMs', 'leaseToken', 'leaseUntilMs', 'preparation', 'submission', 'previousSubmissions', 'receipt', 'failureCategory']);
  validateInput(record.input);
  if (record.requestId !== record.input.request.requestId || record.inputDigest !== recoveryDigest(record.input)
    || !positiveInteger(record.revision) || !nonnegativeInteger(record.attempts)
    || ![record.nextAttemptAtMs, record.createdAtMs, record.updatedAtMs].every(nonnegativeInteger)
    || !['reserved', 'prepared', 'submitted', 'confirmed', 'completed', 'blocked'].includes(record.phase)
    || (record.failureCategory !== undefined && !failures.includes(record.failureCategory))
    || (record.leaseToken === undefined) !== (record.leaseUntilMs === undefined)
    || (record.leaseToken !== undefined && (!text(record.leaseToken) || !nonnegativeInteger(record.leaseUntilMs)))) {
    throw new Error('issuance_recovery_record_invalid');
  }
  if (record.preparation) validatePreparation(record.preparation);
  if (record.previousSubmissions !== undefined && (!Array.isArray(record.previousSubmissions)
    || !record.submission || record.previousSubmissions.length >= MAX_SUBMISSIONS)) {
    throw new Error('issuance_recovery_record_invalid');
  }
  const identities = new Set<string>();
  for (const attempt of recoverySubmissions(record)) {
    validateSubmission(record, attempt);
    const identity = submissionIdentity(attempt);
    if (identities.has(identity)) throw new Error('issuance_recovery_submission_duplicate');
    identities.add(identity);
  }
  if (record.receipt) validateReceipt(record, record.receipt);
  if ((record.phase === 'reserved' && (record.preparation || record.submission || record.receipt))
    || (record.phase === 'prepared' && (!record.preparation || record.submission || record.receipt))
    || (record.phase === 'submitted' && (!record.submission || record.receipt))
    || (['confirmed', 'completed'].includes(record.phase) && !record.receipt)
    || (['completed', 'blocked'].includes(record.phase) && record.leaseToken !== undefined)) throw new Error('issuance_recovery_record_invalid');
}

export function createRecoveryRecord(input: RecoveryInput, nowMs: number): RecoveryRecord {
  validateInput(input);
  if (!nonnegativeInteger(nowMs)) throw new Error('issuance_recovery_time_invalid');
  return {
    requestId: input.request.requestId, input: copy(input), inputDigest: recoveryDigest(input), phase: 'reserved',
    revision: 1, attempts: 0, nextAttemptAtMs: nowMs, createdAtMs: nowMs, updatedAtMs: nowMs,
  };
}

export function claimRecoveryRecord(record: RecoveryRecord, token: string, nowMs: number): RecoveryRecord | undefined {
  validateRecoveryRecord(record);
  if (!text(token) || token === record.leaseToken || !nonnegativeInteger(nowMs)) throw new Error('issuance_recovery_claim_invalid');
  if (record.phase === 'completed' || record.phase === 'blocked' || record.nextAttemptAtMs > nowMs
    || (record.leaseUntilMs !== undefined && record.leaseUntilMs > nowMs)) return undefined;
  const next = { ...copy(record), revision: record.revision + 1, attempts: record.attempts + 1,
    leaseToken: token, leaseUntilMs: nowMs + 300_000, updatedAtMs: nowMs };
  validateRecoveryRecord(next);
  return next;
}

export function transitionRecoveryRecord(record: RecoveryRecord, token: string, revision: number, action: RecoveryAction, nowMs: number): RecoveryRecord {
  validateRecoveryRecord(record);
  if (!object(action) || typeof action.kind !== 'string') throw new Error('issuance_recovery_action_invalid');
  if (!nonnegativeInteger(nowMs) || record.leaseToken !== token || record.revision !== revision
    || record.leaseUntilMs === undefined || record.leaseUntilMs <= nowMs
    || ['completed', 'blocked'].includes(record.phase)) throw new Error('issuance_recovery_lease_lost');
  const next = { ...copy(record), revision: record.revision + 1, updatedAtMs: nowMs };
  switch (action.kind) {
    case 'prepare':
      keys(action, ['kind', 'preparation']);
      if (record.phase !== 'reserved') throw new Error('issuance_recovery_phase_conflict');
      validatePreparation(action.preparation);
      next.preparation = copy(action.preparation);
      next.phase = 'prepared';
      break;
    case 'submit':
    case 'resubmit':
      keys(action, ['kind', 'submission']);
      if (record.phase !== (action.kind === 'submit' ? 'prepared' : 'submitted')) throw new Error('issuance_recovery_phase_conflict');
      if (recoverySubmissions(record).length >= MAX_SUBMISSIONS) throw new Error('issuance_recovery_submission_limit');
      validateSubmission(record, action.submission);
      if (action.submission.operation.deadline * 1000 <= nowMs) throw new Error('issuance_recovery_submission_expired');
      if (recoverySubmissions(record).some(attempt => submissionIdentity(attempt) === submissionIdentity(action.submission))) {
        throw new Error('issuance_recovery_submission_duplicate');
      }
      if (action.kind === 'resubmit') next.previousSubmissions = recoverySubmissions(next);
      next.submission = copy(action.submission);
      next.phase = 'submitted';
      break;
    case 'confirm':
      keys(action, ['kind', 'receipt']);
      if (record.phase !== 'submitted') throw new Error('issuance_recovery_phase_conflict');
      validateReceipt(record, action.receipt);
      next.receipt = copy(action.receipt);
      next.phase = 'confirmed';
      break;
    case 'complete':
      keys(action, ['kind']);
      if (record.phase !== 'confirmed') throw new Error('issuance_recovery_phase_conflict');
      next.phase = 'completed';
      delete next.leaseToken;
      delete next.leaseUntilMs;
      break;
    case 'defer':
      keys(action, ['kind', 'category']);
      if (!['dependency_unavailable', 'receipt_pending', 'policy_unavailable'].includes(action.category)) throw new Error('issuance_recovery_failure_invalid');
      next.failureCategory = action.category;
      next.nextAttemptAtMs = nowMs + Math.min(3_600_000, 15_000 * 2 ** Math.min(8, Math.max(0, record.attempts - 1)));
      delete next.leaseToken;
      delete next.leaseUntilMs;
      break;
    case 'block':
      keys(action, ['kind', 'category']);
      if (!['policy_denied', 'artifact_invalid'].includes(action.category)) throw new Error('issuance_recovery_failure_invalid');
      next.phase = 'blocked';
      next.failureCategory = action.category;
      delete next.leaseToken;
      delete next.leaseUntilMs;
      break;
    default:
      throw new Error('issuance_recovery_action_invalid');
  }
  if (!['defer', 'block'].includes(action.kind)) delete next.failureCategory;
  validateRecoveryRecord(next);
  return next;
}
