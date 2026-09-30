import { createHash, randomUUID } from 'node:crypto';
import { AbiCoder, Interface, Signature, keccak256, verifyTypedData } from 'ethers';
import type { SqlClient } from './directIssuerPostgres.js';

// SDK 2 RC candidate extracted from Safety. No provider runtime is migrated here.
// Public/private writers sharing a chain+contract+issuer MUST select the same
// table on the same database. Job IDs and signer/key prefixes are NOT lane scope.
/** @beta */
export interface ProviderIssuerLaneTableConfig {
  readonly table: string;
  readonly stateConstraint: string;
  readonly ownerIndex: string;
}

/** Fixed trusted configurations only, never caller-supplied SQL identifiers. @beta */
export const PROVIDER_ISSUER_LANE_TABLES = Object.freeze({
  safety: Object.freeze({
    table: 'safety_issuer_operation_lanes_v2',
    stateConstraint: 'safety_issuer_operation_lanes_v2_state_check',
    ownerIndex: 'safety_issuer_operation_lane_owner_v2',
  }),
  shared: Object.freeze({
    table: 'unet_issuer_operation_lanes_v2',
    stateConstraint: 'unet_issuer_operation_lanes_v2_state_check',
    ownerIndex: 'unet_issuer_operation_lane_owner_v2',
  }),
});

function trustedTable(config: ProviderIssuerLaneTableConfig): ProviderIssuerLaneTableConfig {
  if (config !== PROVIDER_ISSUER_LANE_TABLES.safety && config !== PROVIDER_ISSUER_LANE_TABLES.shared) {
    throw new Error('issuer_lane_table_config_invalid');
  }
  return config;
}

/** @beta */
export interface IssuerLaneIntent {
  kind: 'anchor' | 'issuer_revoke';
  operationId: string;
  chainId: number;
  ledgerAddress: string;
  issuerIdHash: string;
  issuerKeyEpoch: number;
  requiredConfirmations: number;
  signerAddress: string;
  attestationHash: string;
  requestIdHash: string;
  holderRevocationSigner?: string;
  reasonHash?: string;
}

/** @beta */
export interface IssuerLaneAttempt {
  nonce: string;
  deadline: number;
  signature: string;
}

/** @beta */
export interface IssuerLaneRecord {
  version: 1;
  intent: IssuerLaneIntent;
  token: string;
  revision: number;
  state: 'reserved' | 'signed' | 'cancelled_unsigned' | 'target_nonexecutable' | 'expired_nonexecutable';
  attempts: IssuerLaneAttempt[];
  targetEvidence?: IssuerLaneTargetEvidence;
  expiryEvidence?: IssuerLaneExpiryEvidence;
}

/** Trusted-gateway observations, not light-client proofs or publication authorization. @beta */
export interface IssuerLaneTargetEvidence {
  kind: 'anchor' | 'issuer_revoke'; chainId: number; ledgerAddress: string;
  issuerIdHash: string; attestationHash: string; expectedHolderRevocationSigner: string | null;
  attemptsDigest: string; attemptCount: number; maxDeadline: string; targetStatus: 'active' | 'revoked';
  blockHash: string; blockNumber: number; blockTimestamp: string; checkedHeadHash: string;
  checkedHeadNumber: number; confirmations: number; requiredConfirmations: number; codeHash: string;
}

/** @beta */
export type IssuerLaneExpiryEvidence = Omit<IssuerLaneTargetEvidence, 'targetStatus'>;

function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new Error('issuer_lane_record_invalid');
}

function object(value: unknown, names: string[]): asserts value is Record<string, unknown> {
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)));
}

function hex(value: unknown, bytes: number, nonzero = false): string {
  requireValid(typeof value === 'string' && value.length === bytes * 2 + 2 && /^0x[0-9a-f]+$/.test(value)
    && (!nonzero || BigInt(value) !== 0n));
  return value;
}

function positive(value: unknown): number {
  requireValid(typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
  return value;
}

function intentCopy(input: IssuerLaneIntent): IssuerLaneIntent {
  requireValid(input?.kind === 'anchor' || input?.kind === 'issuer_revoke');
  object(input, ['kind', 'operationId', 'chainId', 'ledgerAddress', 'issuerIdHash', 'issuerKeyEpoch', 'requiredConfirmations',
    'signerAddress', 'attestationHash', 'requestIdHash', input.kind === 'anchor' ? 'holderRevocationSigner' : 'reasonHash']);
  requireValid(typeof input.operationId === 'string' && /^[A-Za-z0-9._:-]{1,512}$/.test(input.operationId));
  return { kind: input.kind, operationId: input.operationId, chainId: positive(input.chainId),
    ledgerAddress: hex(input.ledgerAddress, 20, true), issuerIdHash: hex(input.issuerIdHash, 32),
    issuerKeyEpoch: positive(input.issuerKeyEpoch), signerAddress: hex(input.signerAddress, 20, true),
    requiredConfirmations: positive(input.requiredConfirmations),
    attestationHash: hex(input.attestationHash, 32, true), requestIdHash: hex(input.requestIdHash, 32),
    ...(input.kind === 'anchor' ? { holderRevocationSigner: hex(input.holderRevocationSigner, 20, true) }
      : { reasonHash: hex(input.reasonHash, 32) }) };
}

// Persisted Safety v2 keys: deliberately no provider/job/key-prefix namespace.
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const laneKey = (intent: Pick<IssuerLaneIntent, 'chainId' | 'ledgerAddress' | 'issuerIdHash'>) => hash([intent.chainId, intent.ledgerAddress, intent.issuerIdHash]);
const operationKey = (intent: IssuerLaneIntent) => hash([laneKey(intent), intent.kind, intent.operationId]);

const commonTypes = [
  { name: 'attestationHash', type: 'bytes32' }, { name: 'issuerIdHash', type: 'bytes32' },
];

function attemptCopy(intent: IssuerLaneIntent, input: IssuerLaneAttempt): IssuerLaneAttempt {
  object(input, ['nonce', 'deadline', 'signature']);
  requireValid(typeof input.nonce === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(input.nonce)
    && BigInt(input.nonce) < (1n << 256n));
  const attempt = { nonce: input.nonce, deadline: positive(input.deadline), signature: hex(input.signature, 65) };
  const anchor = intent.kind === 'anchor';
  const types = { [anchor ? 'Anchor' : 'IssuerRevoke']: [
    ...commonTypes,
    ...(anchor ? [{ name: 'holderRevocationSigner', type: 'address' }] : []),
    { name: 'requestIdHash', type: 'bytes32' },
    ...(!anchor ? [{ name: 'reasonHash', type: 'bytes32' }] : []),
    { name: 'issuerKeyEpoch', type: 'uint64' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint64' },
  ] };
  try {
    requireValid(/(?:1b|1c)$/.test(attempt.signature)
      && BigInt(Signature.from(attempt.signature).s)
        <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n);
    const recovered = verifyTypedData({ name: 'U-net Attestation Ledger', version: '2',
      chainId: intent.chainId, verifyingContract: intent.ledgerAddress }, types,
    { attestationHash: intent.attestationHash, issuerIdHash: intent.issuerIdHash,
      ...(anchor ? { holderRevocationSigner: intent.holderRevocationSigner } : { reasonHash: intent.reasonHash }),
      requestIdHash: intent.requestIdHash, issuerKeyEpoch: intent.issuerKeyEpoch, nonce: attempt.nonce, deadline: attempt.deadline },
    attempt.signature);
    requireValid(recovered.toLowerCase() === intent.signerAddress);
  } catch { throw new Error('issuer_lane_signature_invalid'); }
  return attempt;
}

function recordCopy(input: IssuerLaneRecord): IssuerLaneRecord {
  object(input, ['version', 'intent', 'token', 'revision', 'state', 'attempts',
    ...(input?.state === 'target_nonexecutable' ? ['targetEvidence'] : []),
    ...(input?.state === 'expired_nonexecutable' ? ['expiryEvidence'] : [])]);
  requireValid(input.version === 1 && typeof input.token === 'string'
    && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.token));
  requireValid(['reserved', 'signed', 'cancelled_unsigned', 'target_nonexecutable', 'expired_nonexecutable'].includes(input.state));
  requireValid(Array.isArray(input.attempts) && input.attempts.length <= 32
    && (['signed', 'target_nonexecutable', 'expired_nonexecutable'].includes(input.state) ? input.attempts.length > 0 : input.attempts.length === 0));
  for (let index = 0; index < input.attempts.length; index++) requireValid(Object.hasOwn(input.attempts, index));
  const intent = intentCopy(input.intent);
  const attempts = input.attempts.map(attempt => attemptCopy(intent, attempt));
  requireValid(new Set(attempts.map(item => `${item.nonce}:${item.deadline}`)).size === attempts.length);
  return { version: 1, intent, token: input.token, revision: positive(input.revision), state: input.state, attempts,
    ...(input.state === 'target_nonexecutable' ? { targetEvidence: targetEvidenceCopy(intent, attempts, input.targetEvidence) } : {}),
    ...(input.state === 'expired_nonexecutable' ? { expiryEvidence: evidenceCopy(intent, attempts, input.expiryEvidence, 'expiry') } : {}) };
}

const ledger = new Interface([
  'function anchor((bytes32 attestationHash,bytes32 issuerIdHash,address holderRevocationSigner,bytes32 requestIdHash,uint64 issuerKeyEpoch,uint256 nonce,uint64 deadline) operation, bytes signature)',
  'function revokeByIssuer((bytes32 attestationHash,bytes32 issuerIdHash,bytes32 requestIdHash,bytes32 reasonHash,uint64 issuerKeyEpoch,uint256 nonce,uint64 deadline) operation, bytes signature)',
]);

function targetRequest(intent: IssuerLaneIntent, attempts: IssuerLaneAttempt[], mode: 'target' | 'expiry' = 'target') {
  const expected = { attestationHash: intent.attestationHash, issuerIdHash: intent.issuerIdHash,
    requestIdHash: intent.requestIdHash, issuerKeyEpoch: intent.issuerKeyEpoch,
    ...(intent.kind === 'anchor' ? { holderRevocationSigner: intent.holderRevocationSigner! } : { reasonHash: intent.reasonHash! }) };
  const saved = attempts.map(({ nonce, deadline, signature }) => ({ operation: { ...expected, nonce, deadline }, signature }));
  const digest = keccak256(AbiCoder.defaultAbiCoder().encode(
    ['string', 'uint256', 'address', 'string', 'address', 'bytes[]'],
    [`unet:internal:v2:issuer-operation-${mode}:1`, intent.chainId, intent.ledgerAddress, intent.kind, intent.signerAddress,
      saved.map(attempt => ledger.encodeFunctionData(intent.kind === 'anchor' ? 'anchor' : 'revokeByIssuer', [attempt.operation, attempt.signature]))],
  ));
  return { digest, request: { kind: intent.kind, chainId: intent.chainId, ledgerAddress: intent.ledgerAddress,
    requiredConfirmations: intent.requiredConfirmations, signerAddress: intent.signerAddress, expected, attempts: saved } };
}

function targetEvidenceCopy(intent: IssuerLaneIntent, attempts: IssuerLaneAttempt[], input: unknown): IssuerLaneTargetEvidence {
  return evidenceCopy(intent, attempts, input, 'target');
}

function evidenceCopy(intent: IssuerLaneIntent, attempts: IssuerLaneAttempt[], input: unknown, mode: 'target'): IssuerLaneTargetEvidence;
function evidenceCopy(intent: IssuerLaneIntent, attempts: IssuerLaneAttempt[], input: unknown, mode: 'expiry'): IssuerLaneExpiryEvidence;
function evidenceCopy(intent: IssuerLaneIntent, attempts: IssuerLaneAttempt[], input: unknown,
  mode: 'target' | 'expiry'): IssuerLaneTargetEvidence | IssuerLaneExpiryEvidence {
  object(input, ['kind', 'chainId', 'ledgerAddress', 'issuerIdHash', 'attestationHash', 'expectedHolderRevocationSigner',
    'attemptsDigest', 'attemptCount', 'maxDeadline', ...(mode === 'target' ? ['targetStatus'] : []), 'blockHash', 'blockNumber', 'blockTimestamp',
    'checkedHeadHash', 'checkedHeadNumber', 'confirmations', 'requiredConfirmations', 'codeHash']);
  const zeroOrPositive = (value: unknown) => { requireValid(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0); return value; };
  const decimal = (value: unknown) => {
    requireValid(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < (1n << 256n)); return value;
  };
  requireValid(input.kind === intent.kind);
  if (mode === 'target') requireValid(input.targetStatus === 'revoked' || (intent.kind === 'anchor' && input.targetStatus === 'active'));
  const evidence: IssuerLaneExpiryEvidence = {
    kind: intent.kind, chainId: positive(input.chainId), ledgerAddress: hex(input.ledgerAddress, 20, true),
    issuerIdHash: hex(input.issuerIdHash, 32), attestationHash: hex(input.attestationHash, 32, true),
    expectedHolderRevocationSigner: input.expectedHolderRevocationSigner === null ? null : hex(input.expectedHolderRevocationSigner, 20, true),
    attemptsDigest: hex(input.attemptsDigest, 32), attemptCount: positive(input.attemptCount), maxDeadline: decimal(input.maxDeadline),
    blockHash: hex(input.blockHash, 32, true),
    blockNumber: zeroOrPositive(input.blockNumber), blockTimestamp: decimal(input.blockTimestamp),
    checkedHeadHash: hex(input.checkedHeadHash, 32, true), checkedHeadNumber: zeroOrPositive(input.checkedHeadNumber),
    confirmations: positive(input.confirmations), requiredConfirmations: positive(input.requiredConfirmations), codeHash: hex(input.codeHash, 32, true),
  };
  requireValid(attempts.length > 0 && evidence.chainId === intent.chainId && evidence.ledgerAddress === intent.ledgerAddress
    && evidence.issuerIdHash === intent.issuerIdHash && evidence.attestationHash === intent.attestationHash
    && evidence.expectedHolderRevocationSigner === (intent.kind === 'anchor' ? intent.holderRevocationSigner : null)
    && evidence.attemptsDigest === targetRequest(intent, attempts, mode).digest && evidence.attemptCount === attempts.length
    && evidence.maxDeadline === String(Math.max(...attempts.map(attempt => attempt.deadline)))
    && evidence.requiredConfirmations >= intent.requiredConfirmations && evidence.confirmations >= evidence.requiredConfirmations
    && evidence.checkedHeadNumber >= evidence.blockNumber
    && BigInt(evidence.confirmations) === BigInt(evidence.checkedHeadNumber) - BigInt(evidence.blockNumber) + 1n
    && (evidence.checkedHeadNumber === evidence.blockNumber) === (evidence.checkedHeadHash === evidence.blockHash)
    && evidence.codeHash !== keccak256('0x'));
  if (mode === 'expiry') requireValid(BigInt(evidence.blockTimestamp) > BigInt(evidence.maxDeadline));
  return mode === 'target' ? { ...evidence, targetStatus: input.targetStatus as 'active' | 'revoked' } : evidence;
}

/** Read-only exact saved history; never re-sign or send before committed append. @beta */
export function prepareIssuerLaneTargetRequest(input: IssuerLaneRecord) {
  const record = recordCopy(input);
  requireValid(record.state === 'signed');
  const body = JSON.stringify(targetRequest(record.intent, record.attempts).request);
  requireValid(Buffer.byteLength(body) <= 32 * 1024);
  return { record, body };
}

/** @beta */
export function validateIssuerLaneTargetEvidence(input: IssuerLaneRecord, evidence: unknown) {
  const record = recordCopy(input);
  requireValid(record.state === 'signed' || record.state === 'target_nonexecutable');
  return targetEvidenceCopy(record.intent, record.attempts, evidence);
}

/** @beta */
export function prepareIssuerLaneExpiryRequest(input: IssuerLaneRecord) {
  const record = recordCopy(input);
  requireValid(record.state === 'signed');
  const body = JSON.stringify(targetRequest(record.intent, record.attempts, 'expiry').request);
  requireValid(Buffer.byteLength(body) <= 32 * 1024);
  return { record, body };
}

/** @beta */
export function validateIssuerLaneExpiryEvidence(input: IssuerLaneRecord, evidence: unknown) {
  const record = recordCopy(input);
  requireValid(record.state === 'signed' || record.state === 'expired_nonexecutable');
  return evidenceCopy(record.intent, record.attempts, evidence, 'expiry');
}

/** Initialize before provider transactions; Safety config preserves its exact schema. @beta */
export async function ensureIssuerOperationLaneSchema(db: SqlClient, config: ProviderIssuerLaneTableConfig): Promise<void> {
  const { table, stateConstraint, ownerIndex } = trustedTable(config);
  await db.query(`CREATE TABLE IF NOT EXISTS ${table} (
    operation_key TEXT PRIMARY KEY,
    lane_key TEXT NOT NULL,
    revision BIGINT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('reserved','signed','cancelled_unsigned','target_nonexecutable','expired_nonexecutable')),
    record JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  );
  ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${stateConstraint};
  ALTER TABLE ${table} ADD CONSTRAINT ${stateConstraint}
    CHECK(state IN ('reserved','signed','cancelled_unsigned','target_nonexecutable','expired_nonexecutable'));
  DROP INDEX IF EXISTS ${ownerIndex};
  CREATE UNIQUE INDEX ${ownerIndex}
    ON ${table}(lane_key) WHERE state IN ('reserved','signed');`);
}

/**
 * Candidate transaction-bound primitive: never starts/commits transactions.
 * Only a pinned client, never a pool. Roll back on every thrown error and discard
 * on COMMIT/ROLLBACK. Producer journal changes must commit on THIS transaction
 * before transmission. No worker-expiry takeover; signed release needs evidence.
 * @beta
 */
export class TransactionalIssuerOperationLane {
  private readonly config: ProviderIssuerLaneTableConfig;

  constructor(private readonly db: SqlClient, config: ProviderIssuerLaneTableConfig) {
    this.config = trustedTable(config);
  }

  // Recover frozen signer context, not today's possibly rotated key configuration.
  async forRequest(input: Pick<IssuerLaneIntent, 'kind' | 'chainId' | 'ledgerAddress' | 'issuerIdHash' | 'requestIdHash'>): Promise<IssuerLaneRecord[]> {
    object(input, ['kind', 'chainId', 'ledgerAddress', 'issuerIdHash', 'requestIdHash']);
    requireValid(input.kind === 'anchor' || input.kind === 'issuer_revoke');
    const kind = input.kind;
    const domain = { chainId: positive(input.chainId), ledgerAddress: hex(input.ledgerAddress, 20, true),
      issuerIdHash: hex(input.issuerIdHash, 32) };
    const requestIdHash = hex(input.requestIdHash, 32);
    const key = laneKey(domain);
    const result = await this.db.query(`SELECT operation_key,lane_key,revision,state,record
      FROM ${this.config.table} WHERE lane_key=$1
        AND record->'intent'->>'kind'=$2 AND record->'intent'->>'requestIdHash'=$3
      ORDER BY operation_key FOR UPDATE`, [key, kind, requestIdHash]);
    return result.rows.map(row => {
      const record = recordCopy(row.record as IssuerLaneRecord);
      requireValid(row.operation_key === operationKey(record.intent) && row.lane_key === key
        && laneKey(record.intent) === key && record.intent.kind === kind && record.intent.requestIdHash === requestIdHash
        && row.state === record.state && (row.revision === record.revision || row.revision === String(record.revision)));
      return record;
    });
  }

  private async read(intent: IssuerLaneIntent): Promise<IssuerLaneRecord | undefined> {
    const key = operationKey(intent);
    const result = await this.db.query(`SELECT operation_key,lane_key,revision,state,record
      FROM ${this.config.table} WHERE operation_key=$1 FOR UPDATE`, [key]);
    const row = result.rows[0];
    if (!row) return undefined;
    const record = recordCopy(row.record as IssuerLaneRecord);
    requireValid(row.operation_key === key && row.lane_key === laneKey(record.intent)
      && row.operation_key === operationKey(record.intent) && row.state === record.state
      && (row.revision === record.revision || row.revision === String(record.revision)));
    if (JSON.stringify(record.intent) !== JSON.stringify(intent)) throw new Error('issuer_lane_intent_conflict');
    return record;
  }

  async reserve(input: IssuerLaneIntent): Promise<IssuerLaneRecord | undefined> {
    const intent = intentCopy(input);
    const previous = await this.read(intent);
    if (previous) return previous;
    const record: IssuerLaneRecord = { version: 1, intent, token: randomUUID(), revision: 1, state: 'reserved', attempts: [] };
    await this.db.query(`INSERT INTO ${this.config.table}(operation_key,lane_key,revision,state,record)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [operationKey(intent), laneKey(intent), 1, 'reserved', record]);
    // Unique ownership survives crashed workers/lost COMMIT replies, without TTL.
    return this.read(intent);
  }

  async append(input: IssuerLaneRecord, candidate: IssuerLaneAttempt): Promise<IssuerLaneRecord> {
    const expected = recordCopy(input);
    const attempt = attemptCopy(expected.intent, candidate);
    const current = await this.read(expected.intent);
    if (!current || current.token !== expected.token || current.revision !== expected.revision
      || JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('issuer_lane_ownership_lost');
    if (!['reserved', 'signed'].includes(current.state)) throw new Error('issuer_lane_terminal');
    const previous = current.attempts.find(item => item.nonce === attempt.nonce && item.deadline === attempt.deadline);
    if (previous) {
      if (previous.signature !== attempt.signature) throw new Error('issuer_lane_attempt_conflict');
      return current;
    }
    if (current.attempts.length >= 32) throw new Error('issuer_lane_attempt_limit');
    const next = recordCopy({ ...current, state: 'signed', revision: current.revision + 1, attempts: [...current.attempts, attempt] });
    return this.write(current, next);
  }

  // Compose the unsigned producer cancellation in the same transaction.
  async cancelUnsigned(input: IssuerLaneRecord): Promise<IssuerLaneRecord> {
    const expected = recordCopy(input);
    const current = await this.read(expected.intent);
    if (!current || current.token !== expected.token || current.revision !== expected.revision
      || JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('issuer_lane_ownership_lost');
    if (current.state === 'cancelled_unsigned') return current;
    if (current.state !== 'reserved' || current.attempts.length) throw new Error('issuer_lane_signed_cancellation_requires_evidence');
    return this.write(current, recordCopy({ ...current, state: 'cancelled_unsigned', revision: current.revision + 1 }));
  }

  // Release only, NOT publication or proof this operation's transaction succeeded.
  async finishTarget(input: IssuerLaneRecord, observed: IssuerLaneTargetEvidence): Promise<IssuerLaneRecord> {
    const expected = recordCopy(input);
    const evidence = validateIssuerLaneTargetEvidence(expected, observed);
    const current = await this.read(expected.intent);
    if (!current || current.token !== expected.token || current.revision !== expected.revision
      || JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('issuer_lane_ownership_lost');
    if (current.state === 'target_nonexecutable') {
      if (JSON.stringify(current.targetEvidence) !== JSON.stringify(evidence)) throw new Error('issuer_lane_evidence_conflict');
      return current;
    }
    requireValid(current.state === 'signed');
    return this.write(current, recordCopy({ ...current, state: 'target_nonexecutable',
      revision: current.revision + 1, targetEvidence: evidence }));
  }

  // Saved signatures cannot execute in the future; reconcile past execution and
  // producer disposition independently in this same transaction before COMMIT.
  async finishExpired(input: IssuerLaneRecord, observed: IssuerLaneExpiryEvidence): Promise<IssuerLaneRecord> {
    const expected = recordCopy(input);
    const evidence = validateIssuerLaneExpiryEvidence(expected, observed);
    const current = await this.read(expected.intent);
    if (!current || current.token !== expected.token || current.revision !== expected.revision
      || JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('issuer_lane_ownership_lost');
    if (current.state === 'expired_nonexecutable') {
      if (JSON.stringify(current.expiryEvidence) !== JSON.stringify(evidence)) throw new Error('issuer_lane_evidence_conflict');
      return current;
    }
    requireValid(current.state === 'signed');
    return this.write(current, recordCopy({ ...current, state: 'expired_nonexecutable',
      revision: current.revision + 1, expiryEvidence: evidence }));
  }

  private async write(current: IssuerLaneRecord, next: IssuerLaneRecord): Promise<IssuerLaneRecord> {
    const result = await this.db.query(`UPDATE ${this.config.table}
      SET revision=$2,state=$3,record=$4,updated_at=clock_timestamp()
      WHERE operation_key=$1 AND revision=$5 AND record->>'token'=$6`,
    [operationKey(current.intent), next.revision, next.state, next, current.revision, current.token]);
    if (result.rowCount !== 1) throw new Error('issuer_lane_ownership_lost');
    return next;
  }
}

/** @beta */
export type IssuerLaneTargetResult =
  | { kind: 'target_nonexecutable'; evidence: IssuerLaneTargetEvidence; laneRevision: number; laneToken: string }
  | { kind: 'pending' | 'unavailable' };

/** @beta */
export type IssuerLaneExpiryResult =
  | { kind: 'expired_nonexecutable'; evidence: IssuerLaneExpiryEvidence; laneRevision: number; laneToken: string }
  | { kind: 'pending' | 'unavailable' };

/** @beta */
export interface IssuerLaneEvidenceOptions { fetch?: typeof fetch; signal?: AbortSignal }

/** Read-only trusted-gateway observation, outside any SQL transaction. @beta */
export async function checkIssuerLaneTarget(record: IssuerLaneRecord, readUrl: string,
  options: IssuerLaneEvidenceOptions = {}): Promise<IssuerLaneTargetResult> {
  const result = await checkEvidence(record, readUrl, options, 'target');
  return result.kind === 'expired_nonexecutable' ? { kind: 'unavailable' } : result;
}

/** Expiry is not evidence of past nonexecution or permission to publish. @beta */
export async function checkIssuerLaneExpiry(record: IssuerLaneRecord, readUrl: string,
  options: IssuerLaneEvidenceOptions = {}): Promise<IssuerLaneExpiryResult> {
  const result = await checkEvidence(record, readUrl, options, 'expiry');
  return result.kind === 'target_nonexecutable' ? { kind: 'unavailable' } : result;
}

async function checkEvidence(record: IssuerLaneRecord, readUrl: string,
  options: IssuerLaneEvidenceOptions, mode: 'target' | 'expiry'): Promise<IssuerLaneTargetResult | IssuerLaneExpiryResult> {
  const deadline = performance.now() + 10_000;
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('invalid_options');
    const fetcher = options.fetch ?? globalThis.fetch, signal = options.signal;
    if (typeof fetcher !== 'function' || (signal !== undefined && !(signal instanceof AbortSignal))) throw new Error('invalid_options');
    const url = evidenceEndpoint(readUrl, mode);
    const saved = mode === 'target' ? prepareIssuerLaneTargetRequest(record) : prepareIssuerLaneExpiryRequest(record);
    const { status, payload } = await postEvidence(url, saved.body, fetcher, deadline, signal);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid_response');
    const result = payload as Record<string, unknown>;
    const keys = status === 200 ? ['success', 'protocolVersion', 'status', 'evidence'] : ['success', 'protocolVersion', 'status', 'reason'];
    if (Object.keys(result).length !== keys.length || !keys.every(key => Object.hasOwn(result, key))
      || result.success !== true || result.protocolVersion !== 2) throw new Error('invalid_response');
    if (signal?.aborted || performance.now() >= deadline) throw new Error('evidence_deadline');
    if (status === 202 && result.status === 'pending' && typeof result.reason === 'string'
      && [`${mode}_pending`, 'insufficient_confirmations', 'reorg_detected'].includes(result.reason)) return { kind: 'pending' };
    if (status !== 200 || result.status !== (mode === 'target' ? 'target_nonexecutable' : 'expired_nonexecutable')) throw new Error('invalid_response');
    const observed: IssuerLaneTargetResult | IssuerLaneExpiryResult = mode === 'target'
      ? { kind: 'target_nonexecutable', evidence: validateIssuerLaneTargetEvidence(saved.record, result.evidence),
        laneRevision: saved.record.revision, laneToken: saved.record.token }
      : { kind: 'expired_nonexecutable', evidence: validateIssuerLaneExpiryEvidence(saved.record, result.evidence),
        laneRevision: saved.record.revision, laneToken: saved.record.token };
    if (signal?.aborted || performance.now() >= deadline) throw new Error('evidence_deadline');
    return observed;
  } catch { return { kind: 'unavailable' }; }
}

function transportValid(condition: unknown): void {
  if (!condition) throw new Error('invalid_recovery_evidence');
}

function evidenceEndpoint(base: string, mode: 'target' | 'expiry'): string {
  transportValid(typeof base === 'string' && base.length <= 4096 && /^https:\/\//i.test(base)
    && !/[\s\\?#]/.test(base) && !base.split('/')[2]?.includes('@'));
  transportValid(Boolean(base.split('/')[2]));
  const url = new URL(base);
  transportValid(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/v2/operations/issuer/${mode}-evidence`;
  return url.href;
}

// Preserve Safety's absolute fetch+body budget, including implementations that
// ignore AbortSignal, late headers, bounded UTF-8 and best-effort cancellation.
async function postEvidence(url: string, body: string, fetcher: typeof fetch, deadline: number, signal?: AbortSignal) {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let completed = false;
  const cancelBody = (stream: ReadableStream<Uint8Array> | null) => {
    try { void stream?.cancel().catch(() => undefined); } catch { /* Best-effort cleanup. */ }
  };
  const releaseReader = () => {
    const current = reader;
    reader = undefined;
    if (!current) return;
    try { void current.cancel().catch(() => undefined); } catch { /* Best-effort cleanup. */ }
    try { current.releaseLock(); } catch { /* Best-effort cleanup. */ }
  };
  const checkDeadline = () => transportValid(!stopped && !signal?.aborted && performance.now() < deadline);
  let interrupt!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    interrupt = () => {
      stopped = true;
      reject(new Error('recovery_evidence_stopped'));
      controller.abort();
      releaseReader();
    };
  });
  void interrupted.catch(() => undefined);
  try {
    checkDeadline();
    signal?.addEventListener('abort', interrupt, { once: true });
    timer = setTimeout(interrupt, Math.max(0, deadline - performance.now()));
    const response = (async () => {
      checkDeadline();
      const result = await fetcher(url, {
        method: 'POST', headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body,
        cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal,
      });
      try {
        checkDeadline();
        transportValid(!result.redirected && [200, 202, 409].includes(result.status) && result.body
          && result.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json');
        reader = result.body!.getReader();
      } catch {
        cancelBody(result.body);
        throw new Error('invalid_recovery_response');
      }
      const current = reader;
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const chunk = await current.read();
        checkDeadline();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        transportValid(length <= 64 * 1024);
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      checkDeadline();
      return { status: result.status, payload };
    })();
    const result = await Promise.race([response, interrupted]);
    checkDeadline();
    completed = true;
    return result;
  } finally {
    stopped = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', interrupt);
    if (!completed) controller.abort();
    releaseReader();
  }
}
