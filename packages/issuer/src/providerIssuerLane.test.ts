import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AbiCoder, Interface, Wallet, keccak256 } from 'ethers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SqlClient } from './directIssuerPostgres.js';
import { ledgerV2IssuerIdHash, ledgerV2RequestHash, ledgerV2ReasonHash,
  signLedgerV2Anchor, signLedgerV2IssuerRevoke } from './ledgerV2.js';
import {
  PROVIDER_ISSUER_LANE_TABLES, TransactionalIssuerOperationLane, ensureIssuerOperationLaneSchema,
  prepareIssuerLaneTargetRequest, prepareIssuerLaneExpiryRequest,
  validateIssuerLaneTargetEvidence, validateIssuerLaneExpiryEvidence,
  checkIssuerLaneTarget, checkIssuerLaneExpiry,
  type IssuerLaneIntent, type IssuerLaneRecord, type IssuerLaneTargetEvidence,
  type IssuerLaneExpiryEvidence, type ProviderIssuerLaneTableConfig,
} from './providerIssuerLane.js';

// Synthetic key only. Exercise the SDK's existing noble signer against the exact
// audited ethers verifier; no signature-validation or crypto mocks.
const secret = '0x' + '01'.repeat(32);
const signer = { issuerId: 'lane-test', keyId: 'ledger-key', keyEpoch: 1,
  privateKeyHex: secret, address: new Wallet(secret).address.toLowerCase() };
const hex = (digit: string, bytes = 32) => '0x' + digit.repeat(bytes * 2);
const base: IssuerLaneIntent = { kind: 'anchor', operationId: 'request', chainId: 31337,
  ledgerAddress: hex('1', 20), issuerIdHash: ledgerV2IssuerIdHash(signer.issuerId),
  issuerKeyEpoch: 1, requiredConfirmations: 2, signerAddress: signer.address,
  attestationHash: hex('2'), requestIdHash: ledgerV2RequestHash('request'), holderRevocationSigner: hex('3', 20) };
const revoke: IssuerLaneIntent = (() => {
  const { holderRevocationSigner: _holder, ...common } = base;
  return { ...common, kind: 'issuer_revoke', reasonHash: ledgerV2ReasonHash('test-reason') };
})();

function signed(intent = base, nonce = '0', deadline = 2_000_000_000) {
  const common = { domain: { chainId: intent.chainId, ledgerAddress: intent.ledgerAddress }, signer,
    attestationHash: intent.attestationHash, requestId: intent.operationId, nonce, deadline };
  const result = intent.kind === 'anchor'
    ? signLedgerV2Anchor({ ...common, holderRevocationSigner: intent.holderRevocationSigner! })
    : signLedgerV2IssuerRevoke({ ...common, reason: 'test-reason' });
  return { nonce, deadline, signature: result.signature };
}

type Row = { operation_key: string; lane_key: string; revision: number | string; state: string; record: IssuerLaneRecord };
const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();

// SQL/projection/unique-index model, NOT a real PostgreSQL locking or COMMIT test.
// No migrations or provider database access occur in this suite.
class Database {
  rows = new Map<string, Row>();
  queries: { sql: string; values: unknown[] }[] = [];
  updates = 0;
  loseInsertReply = false;
  loseUpdateReply = false;
  conflictUpdate = false;
  constructor(readonly config: ProviderIssuerLaneTableConfig = PROVIDER_ISSUER_LANE_TABLES.safety) {}
  client = { query: async (sql: string, values: unknown[] = []) => {
    const text = normalize(sql);
    this.queries.push({ sql: text, values: structuredClone(values) });
    if (text.startsWith('CREATE TABLE')) return { rows: [], rowCount: 0 };
    expect(text).toContain(this.config.table);
    if (text.startsWith('SELECT')) {
      expect(text).toMatch(/ FOR UPDATE$/);
      let rows: Row[];
      if (text.includes('WHERE lane_key=$1')) {
        expect(text).toContain("AND record->'intent'->>'kind'=$2 AND record->'intent'->>'requestIdHash'=$3 ORDER BY operation_key FOR UPDATE");
        rows = [...this.rows.values()].filter(row => row.lane_key === values[0]
          && row.record.intent.kind === values[1] && row.record.intent.requestIdHash === values[2])
          .sort((a, b) => a.operation_key.localeCompare(b.operation_key));
      } else {
        expect(text).toBe(`SELECT operation_key,lane_key,revision,state,record FROM ${this.config.table} WHERE operation_key=$1 FOR UPDATE`);
        const row = this.rows.get(String(values[0]));
        rows = row ? [row] : [];
      }
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (text.startsWith('INSERT')) {
      expect(text).toBe(`INSERT INTO ${this.config.table}(operation_key,lane_key,revision,state,record) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`);
      const [key, lane, revision, state, record] = values as [string, string, number, string, IssuerLaneRecord];
      if (![...this.rows.values()].some(row => row.operation_key === key
        || row.lane_key === lane && ['reserved', 'signed'].includes(row.state))) {
        this.rows.set(key, structuredClone({ operation_key: key, lane_key: lane, revision, state, record }));
      }
      if (this.loseInsertReply) { this.loseInsertReply = false; throw new Error('synthetic_lost_insert_reply'); }
      return { rows: [], rowCount: 1 };
    }
    expect(text).toBe(`UPDATE ${this.config.table} SET revision=$2,state=$3,record=$4,updated_at=clock_timestamp() WHERE operation_key=$1 AND revision=$5 AND record->>'token'=$6`);
    const [key, revision, state, record, expected, token] = values as [string, number, string, IssuerLaneRecord, number, string];
    const row = this.rows.get(key);
    if (this.conflictUpdate || !row || Number(row.revision) !== expected || row.record.token !== token) return { rows: [], rowCount: 0 };
    this.updates++;
    this.rows.set(key, structuredClone({ ...row, revision, state, record }));
    if (this.loseUpdateReply) { this.loseUpdateReply = false; throw new Error('synthetic_lost_update_reply'); }
    return { rows: [], rowCount: 1 };
  } } as unknown as SqlClient;
  store() { return new TransactionalIssuerOperationLane(this.client, this.config); }
}

// Independent copy of the audited gateway ABI/domain, not candidate internals.
const abi = new Interface([
  'function anchor((bytes32 attestationHash,bytes32 issuerIdHash,address holderRevocationSigner,bytes32 requestIdHash,uint64 issuerKeyEpoch,uint256 nonce,uint64 deadline) operation, bytes signature)',
  'function revokeByIssuer((bytes32 attestationHash,bytes32 issuerIdHash,bytes32 requestIdHash,bytes32 reasonHash,uint64 issuerKeyEpoch,uint256 nonce,uint64 deadline) operation, bytes signature)',
]);
function evidenceFor(record: IssuerLaneRecord): IssuerLaneTargetEvidence {
  const { intent } = record;
  const calls = record.attempts.map(attempt => abi.encodeFunctionData(intent.kind === 'anchor' ? 'anchor' : 'revokeByIssuer', [{
    attestationHash: intent.attestationHash, issuerIdHash: intent.issuerIdHash,
    requestIdHash: intent.requestIdHash, issuerKeyEpoch: intent.issuerKeyEpoch,
    ...(intent.kind === 'anchor' ? { holderRevocationSigner: intent.holderRevocationSigner } : { reasonHash: intent.reasonHash }),
    nonce: attempt.nonce, deadline: attempt.deadline,
  }, attempt.signature]));
  return { kind: intent.kind, chainId: intent.chainId, ledgerAddress: intent.ledgerAddress,
    issuerIdHash: intent.issuerIdHash, attestationHash: intent.attestationHash,
    expectedHolderRevocationSigner: intent.holderRevocationSigner ?? null,
    attemptsDigest: keccak256(AbiCoder.defaultAbiCoder().encode(['string', 'uint256', 'address', 'string', 'address', 'bytes[]'],
      ['unet:internal:v2:issuer-operation-target:1', intent.chainId, intent.ledgerAddress, intent.kind, intent.signerAddress, calls])),
    attemptCount: record.attempts.length, maxDeadline: String(Math.max(...record.attempts.map(item => item.deadline))),
    targetStatus: intent.kind === 'anchor' ? 'active' : 'revoked', blockHash: hex('4'), blockNumber: 100,
    blockTimestamp: '1000', checkedHeadHash: hex('5'), checkedHeadNumber: 101,
    confirmations: 2, requiredConfirmations: 2, codeHash: keccak256('0x6000') };
}
function expiryFor(record: IssuerLaneRecord): IssuerLaneExpiryEvidence {
  const { targetStatus: _status, ...target } = evidenceFor(record);
  const { intent } = record;
  const payload = JSON.parse(prepareIssuerLaneExpiryRequest(record).body);
  const calls = payload.attempts.map((attempt: { operation: object; signature: string }) =>
    abi.encodeFunctionData(intent.kind === 'anchor' ? 'anchor' : 'revokeByIssuer', [attempt.operation, attempt.signature]));
  return { ...target, blockTimestamp: String(BigInt(target.maxDeadline) + 1n),
    attemptsDigest: keccak256(AbiCoder.defaultAbiCoder().encode(['string', 'uint256', 'address', 'string', 'address', 'bytes[]'],
      ['unet:internal:v2:issuer-operation-expiry:1', intent.chainId, intent.ledgerAddress, intent.kind, intent.signerAddress, calls])) };
}
async function fixture(intent = base) {
  const db = new Database(), store = db.store();
  const record = await store.append((await store.reserve(intent))!, signed(intent));
  return { db, store, record, evidence: evidenceFor(record) };
}
const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'content-type': 'application/json' },
});
const envelope = (evidence: unknown, mode = 'target') => ({ success: true, protocolVersion: 2,
  status: mode === 'target' ? 'target_nonexecutable' : 'expired_nonexecutable', evidence });

afterEach(() => { vi.useRealTimers(); });

describe('trusted candidate tables and Safety persisted compatibility', () => {
  it('declares its own exact ethers dependency and resolves it inside the SDK, not through Safety', () => {
    const manifestUrl = new URL('../package.json', import.meta.url);
    const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
    const require = createRequire(manifestUrl);
    const runtime = realpathSync(require.resolve('ethers'));
    const installed = JSON.parse(readFileSync(join(dirname(runtime), '..', 'package.json'), 'utf8'));
    const sdkModules = realpathSync(fileURLToPath(new URL('../../../node_modules/', import.meta.url)));
    expect(manifest.dependencies.ethers).toBe('6.17.0');
    expect(installed.version).toBe(manifest.dependencies.ethers);
    expect(runtime.startsWith(sdkModules + sep)).toBe(true);
    expect(manifest.version).toBe('2.0.0-rc.2');
  });

  it('wires only the explicit candidate APIs into the package barrel', async () => {
    const candidate = await import('./public.js');
    expect(candidate.PROVIDER_ISSUER_LANE_TABLES).toBe(PROVIDER_ISSUER_LANE_TABLES);
    expect(candidate.TransactionalIssuerOperationLane).toBe(TransactionalIssuerOperationLane);
    expect(candidate.checkIssuerLaneTarget).toBe(checkIssuerLaneTarget);
    expect(candidate.checkIssuerLaneExpiry).toBe(checkIssuerLaneExpiry);
    expect(candidate).not.toHaveProperty('laneKey');
    expect(candidate).not.toHaveProperty('attemptCopy');
    expect(candidate).not.toHaveProperty('postEvidence');
  });

  it.each([PROVIDER_ISSUER_LANE_TABLES.safety, PROVIDER_ISSUER_LANE_TABLES.shared])('uses only fixed schema objects: $table', async config => {
    const db = new Database(config);
    await ensureIssuerOperationLaneSchema(db.client, config);
    const sql = db.queries[0].sql;
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${config.table}`);
    expect(sql).toContain(`DROP CONSTRAINT IF EXISTS ${config.stateConstraint}`);
    expect(sql).toContain(`ADD CONSTRAINT ${config.stateConstraint}`);
    expect(sql).toContain(`DROP INDEX IF EXISTS ${config.ownerIndex}`);
    expect(sql).toContain(`CREATE UNIQUE INDEX ${config.ownerIndex} ON ${config.table}(lane_key) WHERE state IN ('reserved','signed')`);
    expect(sql).toContain("CHECK(state IN ('reserved','signed','cancelled_unsigned','target_nonexecutable','expired_nonexecutable'))");
    expect(await db.store().reserve(base)).toMatchObject({ version: 1, revision: 1, state: 'reserved', attempts: [] });
  });

  it.each([undefined, null, 'safety_issuer_operation_lanes_v2',
    { ...PROVIDER_ISSUER_LANE_TABLES.safety }, { table: 'x;DROP TABLE important', stateConstraint: 'x', ownerIndex: 'x' }])(
    'rejects missing/copied/arbitrary SQL configurations before queries', async value => {
      const db = new Database(), config = value as unknown as ProviderIssuerLaneTableConfig;
      expect(() => new TransactionalIssuerOperationLane(db.client, config)).toThrow('issuer_lane_table_config_invalid');
      await expect(ensureIssuerOperationLaneSchema(db.client, config)).rejects.toThrow('issuer_lane_table_config_invalid');
      expect(db.queries).toEqual([]);
    });

  it('freezes the exact Safety table/index/constraint names without a default or arbitrary identifiers', () => {
    expect(PROVIDER_ISSUER_LANE_TABLES.safety).toEqual({ table: 'safety_issuer_operation_lanes_v2',
      stateConstraint: 'safety_issuer_operation_lanes_v2_state_check', ownerIndex: 'safety_issuer_operation_lane_owner_v2' });
    expect(Object.isFrozen(PROVIDER_ISSUER_LANE_TABLES)).toBe(true);
    expect(Object.isFrozen(PROVIDER_ISSUER_LANE_TABLES.safety)).toBe(true);
  });

  it('retains the exact audited chain+contract+issuer and operation hashes', async () => {
    const db = new Database();
    await db.store().reserve(base);
    const row = [...db.rows.values()][0];
    const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const key = sha([base.chainId, base.ledgerAddress, base.issuerIdHash]);
    expect(row.lane_key).toBe(key);
    expect(row.operation_key).toBe(sha([key, base.kind, base.operationId]));
    expect(row.record.intent).toEqual(base);
  });
});

describe('public/private shared nonce ownership and CAS', () => {
  it('shares the lane across public/private operation IDs, kinds and rotated key prefixes', async () => {
    const db = new Database(), publicWriter = db.store(), privateWriter = db.store();
    await publicWriter.reserve({ ...base, operationId: 'public:issuance' });
    expect(await privateWriter.reserve({ ...base, operationId: 'private:domainadmin',
      issuerKeyEpoch: 2, signerAddress: hex('9', 20) })).toBeUndefined();
    expect(await privateWriter.reserve({ ...revoke, operationId: 'private:revoke' })).toBeUndefined();
    for (const change of [{ chainId: 31338 }, { ledgerAddress: hex('4', 20) }, { issuerIdHash: hex('5') }]) {
      expect(await privateWriter.reserve({ ...base, ...change })).toBeDefined();
    }
    expect(db.rows.size).toBe(4);
    expect(db.queries.every(query => !/^(BEGIN|COMMIT|ROLLBACK)/.test(query.sql))).toBe(true);
  });

  it('snapshots reserve input and returned records without worker-timeout takeover', async () => {
    const db = new Database(), store = db.store(), input = { ...base };
    const pending = store.reserve(input);
    input.operationId = 'changed-after-dispatch';
    const first = (await pending)!;
    expect(first.intent.operationId).toBe('request');
    expect(await store.reserve(base)).toEqual(first);
    first.attempts.push(signed());
    expect((await store.reserve(base))!.attempts).toEqual([]);
    expect(await store.reserve({ ...base, operationId: 'competing' })).toBeUndefined();
    expect(db.updates).toBe(0);
  });

  it.each([{ issuerKeyEpoch: 2 }, { signerAddress: hex('9', 20) }, { requiredConfirmations: 1 },
    { attestationHash: hex('9') }, { requestIdHash: hex('9') }])('rejects existing operation intent mutation', async change => {
    const store = new Database().store();
    await store.reserve(base);
    await expect(store.reserve({ ...base, ...change })).rejects.toThrow('issuer_lane_intent_conflict');
  });

  it('recovers signer/history rounds using a public request selector, without current private keys', async () => {
    const db = new Database(), store = db.store();
    const selector = { kind: base.kind, chainId: base.chainId, ledgerAddress: base.ledgerAddress,
      issuerIdHash: base.issuerIdHash, requestIdHash: base.requestIdHash };
    expect(await store.forRequest(selector)).toEqual([]);
    const first = await store.cancelUnsigned((await store.reserve(base))!);
    const second = (await store.reserve({ ...base, operationId: 'request.round.2' }))!;
    const records = await store.forRequest(selector);
    expect(records).toHaveLength(2);
    expect(records).toEqual(expect.arrayContaining([first, second]));
    records[0].intent.signerAddress = hex('9', 20);
    expect((await store.forRequest(selector))[0].intent.signerAddress).toBe(signer.address);
    expect(await store.forRequest({ ...selector, requestIdHash: hex('9') })).toEqual([]);
    expect(await store.forRequest({ ...selector, chainId: 1 })).toEqual([]);
  });

  it.each(['operation_key', 'lane_key', 'revision', 'state'] as const)('rejects corrupted %s projections', async key => {
    const db = new Database(), store = db.store();
    await store.reserve(base);
    const row = [...db.rows.values()][0];
    Object.assign(row, { [key]: key === 'revision' ? 99 : 'corrupt' });
    await expect(store.reserve(base)).rejects.toThrow('issuer_lane_record_invalid');
  });

  it('accepts PostgreSQL BIGINT string revisions and preserves token/revision fences', async () => {
    const db = new Database(), store = db.store();
    const reserved = (await store.reserve(base))!;
    [...db.rows.values()][0].revision = '1';
    const next = await store.append(reserved, signed());
    await expect(store.append(reserved, signed())).rejects.toThrow('issuer_lane_ownership_lost');
    await expect(store.append({ ...next, token: '11111111-1111-4111-8111-111111111111' }, signed(base, '1')))
      .rejects.toThrow('issuer_lane_ownership_lost');
    db.conflictUpdate = true;
    await expect(store.append(next, signed(base, '1'))).rejects.toThrow('issuer_lane_ownership_lost');
  });

  it('append retries are idempotent but never drop saved same-nonce/different-deadline attempts', async () => {
    const { db, store, record } = await fixture();
    expect(await store.append(record, signed())).toEqual(record);
    const next = await store.append(record, signed(base, '0', 2_000_000_010));
    expect(next.attempts).toEqual([signed(), signed(base, '0', 2_000_000_010)]);
    expect(db.updates).toBe(2);
  });

  it('unsigned cancellation retains a tombstone and prevents a stale signed append', async () => {
    const db = new Database(), store = db.store();
    const reserved = (await store.reserve(base))!;
    const cancelled = await store.cancelUnsigned(reserved);
    expect(cancelled.token).toBe(reserved.token);
    expect(await store.cancelUnsigned(cancelled)).toEqual(cancelled);
    expect(await store.reserve(base)).toEqual(cancelled);
    await expect(store.append(reserved, signed())).rejects.toThrow('issuer_lane_ownership_lost');
    expect(await store.reserve({ ...base, operationId: 'next' })).toBeDefined();
  });

  it('lost insert and append replies recover the original owner without a takeover', async () => {
    const db = new Database(), store = db.store();
    db.loseInsertReply = true;
    await expect(store.reserve(base)).rejects.toThrow('synthetic_lost_insert_reply');
    const reserved = (await store.reserve(base))!;
    db.loseUpdateReply = true;
    await expect(store.append(reserved, signed())).rejects.toThrow('synthetic_lost_update_reply');
    await expect(store.cancelUnsigned(reserved)).rejects.toThrow('issuer_lane_ownership_lost');
    const recovered = (await store.reserve(base))!;
    await expect(store.cancelUnsigned(recovered)).rejects.toThrow('issuer_lane_signed_cancellation_requires_evidence');
    expect(await store.reserve({ ...base, operationId: 'competing' })).toBeUndefined();
    expect(await store.append(recovered, signed())).toEqual(recovered);
    expect(db.updates).toBe(1);
  });

  it('caps exact signed history at 32 without accepting sparse or secret-bearing records', async () => {
    const { db, store, record } = await fixture();
    const current: IssuerLaneRecord = { ...record, revision: 32,
      attempts: Array.from({ length: 32 }, (_, index) => signed(base, String(index))) };
    const row = [...db.rows.values()][0];
    row.record = structuredClone(current);
    row.revision = current.revision;
    expect(() => prepareIssuerLaneTargetRequest(current)).not.toThrow();
    await expect(store.append(current, signed(base, '32'))).rejects.toThrow('issuer_lane_attempt_limit');
    const sparse = structuredClone(current);
    delete sparse.attempts[0];
    expect(() => prepareIssuerLaneTargetRequest(sparse)).toThrow('issuer_lane_record_invalid');
    expect(() => prepareIssuerLaneTargetRequest({ ...current, privateKey: secret } as IssuerLaneRecord))
      .toThrow('issuer_lane_record_invalid');
  });
});

describe('strict audited signatures, no crypto substitution', () => {
  it.each([base, revoke])('accepts the real SDK signer for $kind', async intent => {
    const { record } = await fixture(intent);
    expect(record.state).toBe('signed');
  });

  it.each([{ chainId: 1 }, { ledgerAddress: hex('9', 20) }, { issuerIdHash: hex('9') },
    { issuerKeyEpoch: 2 }, { requestIdHash: hex('9') }, { holderRevocationSigner: hex('9', 20) },
    { attestationHash: hex('9') }, { signerAddress: hex('9', 20) }])('rejects a signature over another intent', async change => {
    const store = new Database().store();
    const reserved = (await store.reserve({ ...base, ...change }))!;
    await expect(store.append(reserved, signed())).rejects.toThrow('issuer_lane_signature_invalid');
  });

  it.each(['00', '01', '1d', 'ff'])('rejects noncanonical recovery byte %s', async v => {
    const store = new Database().store(), reserved = (await store.reserve(base))!, attempt = signed();
    await expect(store.append(reserved, { ...attempt, signature: attempt.signature.slice(0, -2) + v }))
      .rejects.toThrow('issuer_lane_signature_invalid');
  });

  it('rejects high-s malleability, compact signatures and zero scalars', async () => {
    const store = new Database().store(), reserved = (await store.reserve(base))!, attempt = signed();
    const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const highS = (order - BigInt('0x' + attempt.signature.slice(66, 130))).toString(16).padStart(64, '0');
    const signature = attempt.signature.slice(0, 66) + highS + (attempt.signature.endsWith('1b') ? '1c' : '1b');
    await expect(store.append(reserved, { ...attempt, signature })).rejects.toThrow('issuer_lane_signature_invalid');
    await expect(store.append(reserved, { ...attempt, signature: attempt.signature.slice(0, -2) })).rejects.toThrow('issuer_lane_record_invalid');
    await expect(store.append(reserved, { ...attempt, signature: '0x' + '00'.repeat(64) + '1b' })).rejects.toThrow('issuer_lane_signature_invalid');
    await expect(store.append(reserved, { ...attempt, nonce: '1' })).rejects.toThrow('issuer_lane_signature_invalid');
    await expect(store.append(reserved, { ...attempt, deadline: attempt.deadline + 1 })).rejects.toThrow('issuer_lane_signature_invalid');
  });

  it.each(['00', '-1', String(1n << 256n)])('rejects malformed or oversized nonce %s', async nonce => {
    const store = new Database().store();
    await expect(store.append((await store.reserve(base))!, { ...signed(), nonce })).rejects.toThrow('issuer_lane_record_invalid');
  });
});

describe('target and expiry evidence binds the exact immutable history', () => {
  it.each([base, revoke])('validates exact audited ABI history/mode for $kind', async intent => {
    const { store, record, evidence } = await fixture(intent);
    expect(validateIssuerLaneTargetEvidence(record, evidence)).toEqual(evidence);
    const expiry = expiryFor(record);
    expect(validateIssuerLaneExpiryEvidence(record, expiry)).toEqual(expiry);
    const { targetStatus: _status, ...target } = evidence;
    expect(() => validateIssuerLaneExpiryEvidence(record, { ...target, blockTimestamp: '2000000001' })).toThrow('issuer_lane_record_invalid');
    const next = await store.append(record, signed(intent, '0', 2_000_000_010));
    expect(() => validateIssuerLaneExpiryEvidence(next, expiry)).toThrow('issuer_lane_record_invalid');
    expect(() => validateIssuerLaneExpiryEvidence(next, { ...expiryFor(next), blockTimestamp: '2000000001' }))
      .toThrow('issuer_lane_record_invalid');
  });

  it.each(['active', 'revoked'] as const)('releases a confirmed anchor target %s, never claims own transaction success', async status => {
    const { db, store, record, evidence } = await fixture();
    evidence.targetStatus = status;
    const terminal = await store.finishTarget(record, evidence);
    expect(terminal.attempts).toEqual(record.attempts);
    expect(terminal.state).toBe('target_nonexecutable');
    expect(terminal.targetEvidence).not.toHaveProperty('transactionHash');
    expect(await store.finishTarget(terminal, evidence)).toEqual(terminal);
    await expect(store.finishTarget(terminal, { ...evidence, blockTimestamp: '1001' })).rejects.toThrow('issuer_lane_evidence_conflict');
    expect(await store.reserve({ ...base, operationId: 'next' })).toBeDefined();
    expect(db.updates).toBe(2);
  });

  it('issuer revocation requires a revoked target', async () => {
    const { store, record, evidence } = await fixture(revoke);
    await expect(store.finishTarget(record, { ...evidence, targetStatus: 'active' })).rejects.toThrow('issuer_lane_record_invalid');
    expect((await store.finishTarget(record, evidence)).targetEvidence?.expectedHolderRevocationSigner).toBeNull();
  });

  it.each([base, revoke])('expiry only releases future execution; preserves history for $kind', async intent => {
    const { db, store, record } = await fixture(intent), evidence = expiryFor(record);
    db.loseUpdateReply = true;
    await expect(store.finishExpired(record, evidence)).rejects.toThrow('synthetic_lost_update_reply');
    const recovered = (await store.reserve(intent))!;
    expect(await store.finishExpired(recovered, evidence)).toEqual(recovered);
    expect(recovered.state).toBe('expired_nonexecutable');
    expect(recovered.attempts).toEqual(record.attempts);
    expect(recovered.expiryEvidence).not.toHaveProperty('targetStatus');
    expect(recovered.expiryEvidence).not.toHaveProperty('transactionHash');
    await expect(store.append(recovered, signed(intent))).rejects.toThrow('issuer_lane_terminal');
    await expect(store.finishExpired(recovered, { ...evidence, blockTimestamp: '2000000002' })).rejects.toThrow('issuer_lane_evidence_conflict');
    expect(await store.reserve({ ...intent, operationId: 'next' })).toBeDefined();
  });

  it('stale observations cannot release a replaced token or a newer saved attempt', async () => {
    const { db, store, record, evidence } = await fixture();
    const next = await store.append(record, signed(base, '1'));
    await expect(store.finishTarget(record, evidence)).rejects.toThrow('issuer_lane_ownership_lost');
    await expect(store.finishTarget(next, evidence)).rejects.toThrow('issuer_lane_record_invalid');
    await expect(store.finishTarget({ ...next, token: '11111111-1111-4111-8111-111111111111' }, evidenceFor(next)))
      .rejects.toThrow('issuer_lane_ownership_lost');
    db.conflictUpdate = true;
    await expect(store.finishExpired(next, expiryFor(next))).rejects.toThrow('issuer_lane_ownership_lost');
  });

  it.each(Object.entries({ kind: 'issuer_revoke', chainId: 1, ledgerAddress: hex('9', 20), issuerIdHash: hex('9'),
    attestationHash: hex('9'), expectedHolderRevocationSigner: null, attemptsDigest: hex('9'), attemptCount: 2,
    maxDeadline: '2000000001', targetStatus: 'unknown', blockHash: hex('0'), blockNumber: -1,
    blockTimestamp: '01', checkedHeadHash: hex('4'), checkedHeadNumber: 100, confirmations: 1,
    requiredConfirmations: 1, codeHash: keccak256('0x'), extra: true }))('rejects target evidence mismatch %s', async (key, value) => {
    const { db, store, record, evidence } = await fixture();
    await expect(store.finishTarget(record, { ...evidence, [key]: value })).rejects.toThrow('issuer_lane_record_invalid');
    expect((await store.reserve(base))!.state).toBe('signed');
    expect(db.updates).toBe(1);
  });

  it.each(Object.entries({ attemptsDigest: hex('9'), attemptCount: 2, maxDeadline: '1999999999',
    blockTimestamp: '2000000000', confirmations: 1, chainId: 1, ledgerAddress: hex('9', 20), issuerIdHash: hex('9'),
    expectedHolderRevocationSigner: null, codeHash: keccak256('0x'), targetStatus: 'active' }))('rejects expiry evidence mismatch %s', async (key, value) => {
    const { store, record } = await fixture();
    await expect(store.finishExpired(record, { ...expiryFor(record), [key]: value })).rejects.toThrow('issuer_lane_record_invalid');
    expect(await store.reserve({ ...base, operationId: 'competing' })).toBeUndefined();
  });
});

describe('read-only evidence transport bounds, snapshots and failure privacy', () => {
  it.each(['target', 'expiry'] as const)('snapshots exact %s requests before fetch and omits local job/token fields', async mode => {
    const { record } = await fixture(), saved = structuredClone(record);
    const evidence = mode === 'target' ? evidenceFor(record) : expiryFor(record);
    const check = mode === 'target' ? checkIssuerLaneTarget : checkIssuerLaneExpiry;
    const prepare = mode === 'target' ? prepareIssuerLaneTargetRequest : prepareIssuerLaneExpiryRequest;
    const observed = await check(record, 'https://ledger.example/prefix/', { fetch: async (url, init) => {
      expect(url).toBe(`https://ledger.example/prefix/v2/operations/issuer/${mode}-evidence`);
      expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store' });
      expect(init?.body).toBe(prepare(saved).body);
      expect(String(init?.body)).not.toContain('operationId');
      expect(String(init?.body)).not.toContain(saved.token);
      record.revision++;
      record.intent.requiredConfirmations = 100;
      record.attempts[0].nonce = '99';
      return response(envelope(evidence, mode));
    } });
    expect(observed).toEqual({ kind: mode === 'target' ? 'target_nonexecutable' : 'expired_nonexecutable',
      evidence, laneRevision: saved.revision, laneToken: saved.token });
  });

  it.each(['target', 'expiry'] as const)('pending %s observations cannot mutate or release the lane', async mode => {
    const { db, record } = await fixture(), check = mode === 'target' ? checkIssuerLaneTarget : checkIssuerLaneExpiry;
    for (const reason of [`${mode}_pending`, 'insufficient_confirmations', 'reorg_detected']) {
      expect(await check(record, 'https://ledger.example', { fetch: async () => response({ success: true,
        protocolVersion: 2, status: 'pending', reason }, 202) })).toEqual({ kind: 'pending' });
    }
    expect(await check(record, 'https://ledger.example', { fetch: async () => response({ success: true,
      protocolVersion: 2, status: 'pending', reason: 'arbitrary' }, 202) })).toEqual({ kind: 'unavailable' });
    expect(db.updates).toBe(1);
  });

  it.each(['http://ledger.example', 'https://user:secret@ledger.example', 'https://ledger.example?cap=secret',
    'https://ledger.example#fragment', 'https://ledger.example\\path', 'https://ledger.example/space path',
    'https://ledger.example/' + 'x'.repeat(4096)])('rejects unsafe endpoints before fetch', async url => {
    const { record } = await fixture(), fetcher = vi.fn<typeof fetch>();
    expect(await checkIssuerLaneTarget(record, url, { fetch: fetcher })).toEqual({ kind: 'unavailable' });
    expect(await checkIssuerLaneExpiry(record, url, { fetch: fetcher })).toEqual({ kind: 'unavailable' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects unsigned input, invalid options and pre-aborted requests without fetch', async () => {
    const db = new Database(), reserved = (await db.store().reserve(base))!, { record } = await fixture();
    const fetcher = vi.fn<typeof fetch>();
    expect(await checkIssuerLaneTarget(reserved, 'https://ledger.example', { fetch: fetcher })).toEqual({ kind: 'unavailable' });
    expect(await checkIssuerLaneExpiry(record, 'https://ledger.example', null as never)).toEqual({ kind: 'unavailable' });
    const controller = new AbortController(); controller.abort();
    expect(await checkIssuerLaneTarget(record, 'https://ledger.example', { fetch: fetcher, signal: controller.signal })).toEqual({ kind: 'unavailable' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns sanitized unavailable for bare status, malformed binding and dependency secrets', async () => {
    const { record, evidence } = await fixture();
    for (const payload of [{ success: true, status: 'revoked' }, envelope({ ...evidence, attemptsDigest: hex('9') }),
      { ...envelope(evidence), privateKey: secret }, envelope(evidence, 'expiry')]) {
      expect(await checkIssuerLaneTarget(record, 'https://ledger.example', { fetch: async () => response(payload) }))
        .toEqual({ kind: 'unavailable' });
    }
    expect(await checkIssuerLaneExpiry(record, 'https://ledger.example', { fetch: async () => { throw new Error('SYNTHETIC_PRIVATE_ERROR'); } }))
      .toEqual({ kind: 'unavailable' });
  });

  it('enforces response byte limits, fatal UTF-8, MIME and redirect refusal', async () => {
    const { record } = await fixture();
    const malformed = [new Response('x'.repeat(64 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
      new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
      new Response('{}', { headers: { 'content-type': 'text/html' } }), Response.redirect('https://other.example'),
      new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } })];
    for (const result of malformed) {
      expect(await checkIssuerLaneTarget(record, 'https://ledger.example', { fetch: async () => result })).toEqual({ kind: 'unavailable' });
    }
  });

  it('bounds fetch implementations that ignore AbortSignal and cancels late headers', async () => {
    const { record, evidence } = await fixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let resolve!: (response: Response) => void;
    const pending = checkIssuerLaneTarget(record, 'https://ledger.example', { fetch: () => new Promise(done => { resolve = done; }) });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toEqual({ kind: 'unavailable' });
    const late = response(envelope(evidence)), cancel = vi.spyOn(late.body!, 'cancel');
    resolve(late);
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds stalled body reads, even when the source ignores cancellation', async () => {
    const { record } = await fixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined) });
    const pending = checkIssuerLaneExpiry(record, 'https://ledger.example', { fetch: async () => new Response(stream, {
      headers: { 'content-type': 'application/json' },
    }) });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toEqual({ kind: 'unavailable' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
