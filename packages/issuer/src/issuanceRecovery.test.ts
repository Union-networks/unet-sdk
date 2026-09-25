import { describe, expect, it } from 'vitest';
import {
  claimRecoveryRecord, createRecoveryRecord, recoveryDigest,
  transitionRecoveryRecord, validateRecoveryRecord,
  type RecoveryAction, type RecoveryInput, type RecoveryPhase,
  type RecoveryPreparation, type RecoveryReceipt, type RecoveryRecord,
  type RecoverySubmission,
} from './issuanceRecovery.js';
import { ledgerV2IssuerIdHash, ledgerV2RequestHash } from './ledgerV2.js';

const NOW = 1_000_000;
const LEASE_MS = 300_000;
const OWNER = 'owner-1';
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const address = (digit: string) => `0x${digit.repeat(40)}`;
const encoded = (length: number, fill = 1) => Buffer.alloc(length, fill).toString('base64url');
// Synthetic signatures and receipts test syntax and binding only, not cryptographic verification.
const SIGNATURE = `0x${'12'.repeat(64)}1b`;

function input(): RecoveryInput {
  return {
    request: {
      requestId: 'request-1', serviceAccountRef: 'account-1', checkId: 'age-check',
      holderBinding: 'holder-1', deliveryPublicKey: 'delivery-key-1',
      holderRevocationSigner: address('a'), idempotencyKey: 'idempotency-1',
      deliveryCapabilityHash: 'b'.repeat(64), state: 'pending',
      claims: { age: 21, ordered: ['first', 'second'], nested: { eligible: true } },
      consent: { text: 'Consent text', acceptedAtIso: '2026-09-25T00:00:00.000Z' },
      createdAtIso: '2026-09-25T00:00:00.000Z', updatedAtIso: '2026-09-25T00:00:00.000Z',
      replacedAttestationHash: 'c'.repeat(64),
    },
    context: {
      chainId: 31337, ledgerAddress: address('d'), issuerId: 'issuer-1',
      issuerIdHash: ledgerV2IssuerIdHash('issuer-1'), issuerKeyEpoch: 2, requiredConfirmations: 1,
      credentialKeyId: 'credential-key-1', credentialKeyFingerprint: hash('e'),
      validFromEpoch: 0, validUntilEpoch: 2_000_000,
    },
  };
}

function preparation(): RecoveryPreparation {
  return {
    attestationHash: 'f'.repeat(64),
    encryptedCredentialEnvelope: {
      version: 2, algorithm: 'x25519-xchacha20poly1305',
      senderPublicKey: encoded(32), nonce: encoded(24), ciphertext: encoded(48),
    },
  };
}

it('freezes the required confirmation depth and rejects a shallower receipt', () => {
  const original = input();
  const stronger = structuredClone(original);
  stronger.context.requiredConfirmations = 2;
  expect(recoveryDigest(original)).not.toBe(recoveryDigest(stronger));
  let record = claimRecoveryRecord(createRecoveryRecord(stronger, NOW), OWNER, NOW)!;
  record = step(record, { kind: 'prepare', preparation: preparation() });
  record = step(record, { kind: 'submit', submission: submission(record) });
  expect(() => step(record, { kind: 'confirm', receipt: receipt(record) })).toThrow('issuance_recovery_receipt_invalid');
  expect(step(record, { kind: 'confirm', receipt: { ...receipt(record), confirmations: 2 } }).phase).toBe('confirmed');
  stronger.context.requiredConfirmations = 0;
  expect(() => createRecoveryRecord(stronger, NOW)).toThrow('issuance_recovery_input_invalid');
});

function submission(record: RecoveryRecord): RecoverySubmission {
  return {
    operation: {
      attestationHash: `0x${record.preparation!.attestationHash}`,
      issuerIdHash: record.input.context.issuerIdHash,
      issuerKeyEpoch: record.input.context.issuerKeyEpoch,
      holderRevocationSigner: record.input.request.holderRevocationSigner,
      requestIdHash: ledgerV2RequestHash(record.requestId), nonce: '0', deadline: 2_000,
    },
    signature: SIGNATURE,
  };
}

function receipt(record: RecoveryRecord): RecoveryReceipt {
  const op = record.submission!.operation;
  return {
    chainId: record.input.context.chainId, ledgerAddress: record.input.context.ledgerAddress,
    attestationHash: op.attestationHash, issuerIdHash: op.issuerIdHash,
    holderRevocationSigner: op.holderRevocationSigner, requestIdHash: op.requestIdHash,
    submissionDigest: recoveryDigest(record.submission), transactionHash: hash('1'),
    blockHash: hash('2'), blockNumber: 0, confirmations: 1,
  };
}

function step(record: RecoveryRecord, action: RecoveryAction, nowMs = NOW): RecoveryRecord {
  return transitionRecoveryRecord(record, record.leaseToken!, record.revision, action, nowMs);
}

function at(phase: RecoveryPhase): RecoveryRecord {
  let record = claimRecoveryRecord(createRecoveryRecord(input(), NOW), OWNER, NOW)!;
  if (phase === 'reserved') return record;
  if (phase === 'blocked') return step(record, { kind: 'block', category: 'policy_denied' });
  record = step(record, { kind: 'prepare', preparation: preparation() });
  if (phase === 'prepared') return record;
  record = step(record, { kind: 'submit', submission: submission(record) });
  if (phase === 'submitted') return record;
  record = step(record, { kind: 'confirm', receipt: receipt(record) });
  return phase === 'confirmed' ? record : step(record, { kind: 'complete' });
}

describe('untrusted JSON scalar types', () => {
  it.each([
    ['request', 'deliveryCapabilityHash'], ['request', 'holderRevocationSigner'],
    ['context', 'ledgerAddress'], ['context', 'credentialKeyFingerprint'],
  ] as const)('rejects array-valued %s.%s before reservation', (section, field) => {
    const candidate = input();
    const fields = candidate[section] as unknown as Record<string, unknown>;
    fields[field] = [fields[field]];
    expect(() => createRecoveryRecord(candidate, NOW)).toThrow('issuance_recovery_input_invalid');
  });

  it('rejects an array-valued preparation commitment', () => {
    const candidate = preparation();
    Reflect.set(candidate, 'attestationHash', [candidate.attestationHash]);
    expect(() => step(at('reserved'), { kind: 'prepare', preparation: candidate }))
      .toThrow('issuance_recovery_preparation_invalid');
  });

  it('rejects an array-valued signature before durable submission', () => {
    const record = at('prepared');
    const candidate = submission(record);
    Reflect.set(candidate, 'signature', [candidate.signature]);
    expect(() => step(record, { kind: 'submit', submission: candidate }))
      .toThrow('issuance_recovery_submission_invalid');
  });

  it.each(['transactionHash', 'blockHash'] as const)('rejects array-valued receipt %s', field => {
    const record = at('submitted');
    const candidate = receipt(record);
    Reflect.set(candidate, field, [candidate[field]]);
    expect(() => step(record, { kind: 'confirm', receipt: candidate }))
      .toThrow('issuance_recovery_receipt_invalid');
  });
});

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]));
  }
  return value;
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

describe('private issuance recovery canonical input', () => {
  it('creates a reserved snapshot and ignores object insertion order, not array order', () => {
    const original = freezeDeep(input());
    const record = createRecoveryRecord(original, NOW);
    expect(record).toEqual({
      requestId: original.request.requestId, input: original, inputDigest: recoveryDigest(original),
      phase: 'reserved', revision: 1, attempts: 0, nextAttemptAtMs: NOW, createdAtMs: NOW, updatedAtMs: NOW,
    });
    expect(record.input).not.toBe(original);
    expect(createRecoveryRecord(reverseKeys(original) as RecoveryInput, NOW)).toEqual(record);
    expect(recoveryDigest(['first', 'second'])).not.toBe(recoveryDigest(['second', 'first']));
    expect(recoveryDigest({ absent: undefined, kept: null })).toBe(recoveryDigest({ kept: null }));
    expect(recoveryDigest(Object.assign(Object.create(null), { b: 2, a: 1 })))
      .toBe(recoveryDigest({ a: 1, b: 2 }));
  });

  const bindingCases: [string, (value: RecoveryInput) => void][] = [
    ...(['requestId', 'serviceAccountRef', 'checkId', 'holderBinding', 'deliveryPublicKey',
      'idempotencyKey', 'createdAtIso', 'updatedAtIso'] as const).map(key =>
      [key, (value: RecoveryInput) => { value.request[key] += '-changed'; }] as [string, (value: RecoveryInput) => void]),
    ['holderRevocationSigner', value => { value.request.holderRevocationSigner = address('1'); }],
    ['deliveryCapabilityHash', value => { value.request.deliveryCapabilityHash = '1'.repeat(64); }],
    ['replacedAttestationHash', value => { value.request.replacedAttestationHash = '2'.repeat(64); }],
    ['claims', value => { value.request.claims!.age = 22; }],
    ['claims array order', value => { (value.request.claims!.ordered as string[]).reverse(); }],
    ['consent text', value => { value.request.consent!.text += ' changed'; }],
    ['consent time', value => { value.request.consent!.acceptedAtIso = '2026-09-26T00:00:00.000Z'; }],
    ['chainId', value => { value.context.chainId++; }],
    ['ledgerAddress', value => { value.context.ledgerAddress = address('2'); }],
    ['issuer identity', value => {
      value.context.issuerId = 'issuer-2'; value.context.issuerIdHash = ledgerV2IssuerIdHash('issuer-2');
    }],
    ['issuerKeyEpoch', value => { value.context.issuerKeyEpoch++; }],
    ['credentialKeyId', value => { value.context.credentialKeyId += '-changed'; }],
    ['credentialKeyFingerprint', value => { value.context.credentialKeyFingerprint = hash('3'); }],
    ['validFromEpoch', value => { value.context.validFromEpoch++; }],
    ['validUntilEpoch', value => { value.context.validUntilEpoch++; }],
  ];
  it.each(bindingCases)('binds %s into the immutable input digest', (_name, mutate) => {
    const original = createRecoveryRecord(input(), NOW);
    const changed = input();
    mutate(changed);
    expect(createRecoveryRecord(changed, NOW).inputDigest).not.toBe(original.inputDigest);
    original.input = changed;
    expect(() => validateRecoveryRecord(original)).toThrow('issuance_recovery_record_invalid');
  });

  it('isolates caller mutations in both directions', () => {
    const original = input();
    const snapshot = structuredClone(original);
    const record = createRecoveryRecord(original, NOW);
    original.request.claims!.age = 99;
    original.request.consent!.text = 'changed';
    original.context.chainId++;
    expect(record.input).toEqual(snapshot);
    (record.input.request.claims!.ordered as string[]).push('third');
    expect(original.request.claims!.ordered).toEqual(['first', 'second']);
  });

  it.each(['anchoring', 'ready', 'delivered', 'denied', 'failed', 'revoked', '', null])
    ('rejects non-pending state %s', state => {
      const value = input();
      Object.assign(value.request, { state });
      expect(() => createRecoveryRecord(value, NOW)).toThrow('issuance_recovery_input_invalid');
    });

  it.each([
    ['request', undefined], ['request', null], ['context', undefined], ['context', null],
  ])('rejects missing %s (%s)', (key, value) => {
    expect(() => createRecoveryRecord({ ...input(), [key as string]: value }, NOW))
      .toThrow('issuance_recovery_data_invalid');
  });

  it.each([
    ['requestId', ''], ['serviceAccountRef', null], ['checkId', 1], ['holderBinding', ''],
    ['deliveryPublicKey', ''], ['idempotencyKey', ''], ['deliveryCapabilityHash', hash('a')],
    ['deliveryCapabilityHash', 'A'.repeat(64)], ['holderRevocationSigner', '0x123'],
    ['attestationHash', 'a'.repeat(64)], ['encryptedCredentialEnvelope', {}],
    ['ledgerTransactionHash', hash('1')], ['failureCategory', 'failed'],
  ])('rejects invalid pending request %s=%s', (key, value) => {
    const candidate = input();
    Object.assign(candidate.request, { [key as string]: value });
    expect(() => createRecoveryRecord(candidate, NOW)).toThrow('issuance_recovery_input_invalid');
  });

  it.each([
    ['chainId', 0], ['chainId', 1.5], ['chainId', Number.MAX_SAFE_INTEGER + 1],
    ['ledgerAddress', '0x123'], ['issuerId', ''], ['issuerIdHash', hash('1')],
    ['issuerKeyEpoch', 0], ['credentialKeyId', ''], ['credentialKeyFingerprint', 'a'.repeat(64)],
    ['credentialKeyFingerprint', hash('A')], ['validFromEpoch', -1], ['validUntilEpoch', 0],
    ['validUntilEpoch', Infinity],
  ])('rejects invalid context %s=%s', (key, value) => {
    const candidate = input();
    Object.assign(candidate.context, { [key as string]: value });
    expect(() => createRecoveryRecord(candidate, NOW)).toThrow('issuance_recovery_input_invalid');
  });

  it.each([1, 2])('rejects validity end at or before start (%s)', end => {
    const candidate = input();
    Object.assign(candidate.context, { validFromEpoch: 2, validUntilEpoch: end });
    expect(() => createRecoveryRecord(candidate, NOW)).toThrow('issuance_recovery_input_invalid');
  });

  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid creation time %s', now => {
    expect(() => createRecoveryRecord(input(), now)).toThrow('issuance_recovery_time_invalid');
  });

  it.each([undefined, NaN, Infinity, 1n, Symbol('value'), () => 1, new Date(0), new Map(), [undefined]])
    ('rejects noncanonical data %s', value => {
      expect(() => recoveryDigest(value)).toThrow('issuance_recovery_data_invalid');
    });

  it('rejects cycles and excessive nesting', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    let deep: unknown = null;
    for (let i = 0; i < 34; i++) deep = { child: deep };
    for (const value of [cycle, deep]) {
      expect(() => recoveryDigest(value)).toThrow('issuance_recovery_data_invalid');
      const candidate = input();
      candidate.request.claims = { value };
      expect(() => createRecoveryRecord(candidate, NOW)).toThrow('issuance_recovery_data_invalid');
    }
  });

  it.each(['input', 'request', 'context'] as const)('rejects unknown %s keys, including private key material', location => {
    const candidate = input();
    const target = location === 'input' ? candidate : candidate[location];
    Object.assign(target, { privateKey: 'synthetic-private-material' });
    expect(() => createRecoveryRecord(candidate, NOW)).toThrow('issuance_recovery_data_invalid');
  });

  it('rejects sparse arrays instead of hashing them as a different array', () => {
    expect(() => recoveryDigest(new Array(1))).toThrow('issuance_recovery_data_invalid');
  });

  it('does not silently drop sparse-array claims when reserving input', () => {
    const candidate = input();
    candidate.request.claims = { values: new Array(1) };
    expect(() => createRecoveryRecord(candidate, NOW)).toThrow('issuance_recovery_data_invalid');
  });
});

describe('private issuance recovery phases and artifact binding', () => {
  it('advances prepare, submit, confirm, complete with independent immutable snapshots', () => {
    let record = at('reserved');
    const built = preparation();
    const actions: RecoveryAction[] = [{ kind: 'prepare', preparation: built }];
    const expectedPhases = ['prepared', 'submitted', 'confirmed', 'completed'];
    for (let i = 0; i < expectedPhases.length; i++) {
      const previous = freezeDeep(record);
      const before = structuredClone(previous);
      const action = actions[i]!;
      record = step(previous, action, NOW + i + 1);
      expect(previous).toEqual(before);
      expect(record).toMatchObject({
        phase: expectedPhases[i], revision: previous.revision + 1, attempts: 1,
        inputDigest: previous.inputDigest, createdAtMs: NOW, updatedAtMs: NOW + i + 1,
      });
      expect(record.input).not.toBe(previous.input);
      expect(() => validateRecoveryRecord(record)).not.toThrow();
      if (i === 0) actions.push({ kind: 'submit', submission: submission(record) });
      if (i === 1) actions.push({ kind: 'confirm', receipt: receipt(record) });
      if (i === 2) actions.push({ kind: 'complete' });
      if (i < 3) expect(record.leaseUntilMs).toBe(NOW + LEASE_MS);
    }
    expect(record.leaseToken).toBeUndefined();
    expect(record.leaseUntilMs).toBeUndefined();
    expect(record.preparation).toEqual(built);
    expect(record.submission).toEqual((actions[1] as { submission: RecoverySubmission }).submission);
    expect(record.receipt).toEqual((actions[2] as { receipt: RecoveryReceipt }).receipt);
  });

  it('clones each caller-owned artifact and all prior artifacts', () => {
    const reserved = at('reserved');
    const built = preparation();
    const prepared = step(reserved, { kind: 'prepare', preparation: built });
    built.encryptedCredentialEnvelope.senderPublicKey = encoded(32, 2);
    expect(prepared.preparation).toEqual(preparation());
    const signed = submission(prepared);
    const submitted = step(prepared, { kind: 'submit', submission: signed });
    signed.operation.nonce = '99';
    signed.signature = 'changed';
    prepared.preparation!.encryptedCredentialEnvelope.ciphertext = encoded(48, 2);
    expect(submitted.submission).toEqual(submission(submitted));
    expect(submitted.preparation).toEqual(preparation());
    const evidence = receipt(submitted);
    const confirmed = step(submitted, { kind: 'confirm', receipt: evidence });
    evidence.transactionHash = hash('9');
    submitted.submission!.operation.nonce = '99';
    expect(confirmed.receipt!.transactionHash).toBe(hash('1'));
    expect(confirmed.submission!.operation.nonce).toBe('0');
  });

  const activePhases = ['reserved', 'prepared', 'submitted', 'confirmed'] as const;
  const actionKinds = ['prepare', 'submit', 'confirm', 'complete'] as const;
  const conflicts = activePhases.flatMap((phase, index) => actionKinds
    .filter((_kind, actionIndex) => index !== actionIndex).map(kind => ({ phase, kind })));
  it.each(conflicts)('rejects $kind in $phase without changing the record', ({ phase, kind }) => {
    const record = freezeDeep(at(phase));
    const before = structuredClone(record);
    const actions: Record<typeof kind, RecoveryAction> = {
      prepare: { kind: 'prepare', preparation: preparation() },
      submit: { kind: 'submit', submission: submission(at('prepared')) },
      confirm: { kind: 'confirm', receipt: receipt(at('submitted')) },
      complete: { kind: 'complete' },
    };
    const action = actions[kind];
    expect(() => step(record, action)).toThrow('issuance_recovery_phase_conflict');
    expect(record).toEqual(before);
  });

  it.each([hash('a'), 'A'.repeat(64), '', 'abc'])('rejects invalid preparation hash %s', attestationHash => {
    expect(() => step(at('reserved'), { kind: 'prepare', preparation: { ...preparation(), attestationHash } }))
      .toThrow('issuance_recovery_preparation_invalid');
  });

  it.each([null, undefined, [], 'envelope'])('rejects non-object preparation %s', candidate => {
    expect(() => step(at('reserved'), { kind: 'prepare', preparation: candidate as unknown as RecoveryPreparation }))
      .toThrow('issuance_recovery_data_invalid');
  });

  it.each([
    ['version', 1], ['version', '2'], ['algorithm', 'other'], ['senderPublicKey', encoded(31)],
    ['senderPublicKey', encoded(33)], ['nonce', encoded(23)], ['nonce', encoded(25)],
    ['ciphertext', encoded(15)], ['ciphertext', ''], ['ciphertext', 'AA=='],
    ['ciphertext', '+'.repeat(32)], ['ciphertext', '/'.repeat(32)],
    ['senderPublicKey', `${encoded(32)}=`], ['nonce', null], ['ciphertext', undefined],
    ['ciphertext', 'A'.repeat(3_000_001)],
  ])('rejects invalid encryptedV2 field %s (case %#)', (key, value) => {
    const candidate = preparation();
    candidate.encryptedCredentialEnvelope[key as string] = value;
    expect(() => step(at('reserved'), { kind: 'prepare', preparation: candidate }))
      .toThrow('issuance_recovery_preparation_invalid');
  });

  it('accepts canonical unpadded base64url including URL-safe characters and the minimum tag length', () => {
    const candidate = preparation();
    candidate.encryptedCredentialEnvelope.senderPublicKey = encoded(32, 255);
    candidate.encryptedCredentialEnvelope.nonce = encoded(24, 251);
    candidate.encryptedCredentialEnvelope.ciphertext = encoded(16);
    expect(step(at('reserved'), { kind: 'prepare', preparation: candidate }).phase).toBe('prepared');
  });

  it.each(['version', 'algorithm', 'senderPublicKey', 'nonce', 'ciphertext'])('requires encryptedV2 field %s', key => {
    const candidate = preparation();
    delete candidate.encryptedCredentialEnvelope[key];
    expect(() => step(at('reserved'), { kind: 'prepare', preparation: candidate }))
      .toThrow('issuance_recovery_preparation_invalid');
  });

  it('rejects base64url with noncanonical trailing padding bits', () => {
    const candidate = preparation();
    const canonical = encoded(32, 0);
    candidate.encryptedCredentialEnvelope.senderPublicKey = `${canonical.slice(0, -1)}B`;
    expect(Buffer.from(candidate.encryptedCredentialEnvelope.senderPublicKey as string, 'base64url'))
      .toEqual(Buffer.from(canonical, 'base64url'));
    expect(() => step(at('reserved'), { kind: 'prepare', preparation: candidate }))
      .toThrow('issuance_recovery_preparation_invalid');
  });

  it.each(['preparation', 'envelope', 'submission', 'operation', 'receipt'] as const)
    ('rejects unknown keys in %s payloads', location => {
      let record: RecoveryRecord;
      let action: RecoveryAction;
      let target: object;
      if (location === 'preparation' || location === 'envelope') {
        record = at('reserved');
        const candidate = preparation();
        action = { kind: 'prepare', preparation: candidate };
        target = location === 'preparation' ? candidate : candidate.encryptedCredentialEnvelope;
      } else if (location === 'submission' || location === 'operation') {
        record = at('prepared');
        const candidate = submission(record);
        action = { kind: 'submit', submission: candidate };
        target = location === 'submission' ? candidate : candidate.operation;
      } else {
        record = at('submitted');
        const candidate = receipt(record);
        action = { kind: 'confirm', receipt: candidate };
        target = candidate;
      }
      Object.assign(target, { privateKey: 'synthetic-private-material' });
      expect(() => step(record, action)).toThrow('issuance_recovery_data_invalid');
    });

  it.each([
    ['attestationHash', hash('1')], ['issuerIdHash', hash('1')], ['issuerKeyEpoch', 3],
    ['requestIdHash', ledgerV2RequestHash('other-request')], ['holderRevocationSigner', address('1')],
    ['holderRevocationSigner', null], ['nonce', '-1'], ['nonce', '01'], ['nonce', '1.5'],
    ['nonce', '1e3'], ['nonce', ''], ['nonce', 1], ['nonce', (1n << 256n).toString()],
    ['deadline', 0], ['deadline', 1.5], ['deadline', Infinity],
  ])('rejects mismatched or invalid operation %s=%s', (key, value) => {
    const record = freezeDeep(at('prepared'));
    const candidate = submission(record);
    Object.assign(candidate.operation, { [key as string]: value });
    expect(() => step(record, { kind: 'submit', submission: candidate }))
      .toThrow('issuance_recovery_submission_invalid');
  });

  it.each(['', '0x12', `0x${'12'.repeat(64)}00`, `0x${'12'.repeat(64)}1d`,
    `0x${'gg'.repeat(64)}1b`, `${'12'.repeat(64)}1b`])('rejects malformed signature %s', signature => {
    const record = at('prepared');
    expect(() => step(record, { kind: 'submit', submission: { ...submission(record), signature } }))
      .toThrow('issuance_recovery_submission_invalid');
  });

  it.each(['1b', '1c'])('accepts synthetic signature syntax ending in %s, without cryptographic verification', suffix => {
    const record = at('prepared');
    const candidate = submission(record);
    candidate.signature = `0x${'AB'.repeat(64)}${suffix}`;
    candidate.operation.nonce = ((1n << 256n) - 1n).toString();
    candidate.operation.holderRevocationSigner = `0x${'A'.repeat(40)}`;
    expect(step(record, { kind: 'submit', submission: candidate }).phase).toBe('submitted');
  });

  it('rejects submission at its exact deadline, but accepts one millisecond before', () => {
    const record = at('prepared');
    const candidate = submission(record);
    candidate.operation.deadline = (NOW + 1_000) / 1_000;
    expect(step(record, { kind: 'submit', submission: candidate }, NOW + 999).phase).toBe('submitted');
    expect(() => step(record, { kind: 'submit', submission: candidate }, NOW + 1_000))
      .toThrow('issuance_recovery_submission_expired');
  });

  it.each([
    ['chainId', 1], ['ledgerAddress', address('1')], ['ledgerAddress', null],
    ['attestationHash', hash('1')], ['issuerIdHash', hash('1')],
    ['holderRevocationSigner', address('1')], ['holderRevocationSigner', null],
    ['requestIdHash', hash('1')], ['submissionDigest', '0'.repeat(64)],
    ['transactionHash', 'bad'], ['blockHash', hash('A')], ['blockNumber', -1],
    ['blockNumber', 0.5], ['blockNumber', Number.MAX_SAFE_INTEGER + 1],
    ['confirmations', 0], ['confirmations', 1.5], ['confirmations', Infinity],
  ])('rejects mismatched or invalid receipt %s=%s', (key, value) => {
    const record = freezeDeep(at('submitted'));
    const candidate = receipt(record);
    Object.assign(candidate, { [key as string]: value });
    expect(() => step(record, { kind: 'confirm', receipt: candidate }))
      .toThrow('issuance_recovery_receipt_invalid');
  });

  it.each(['nonce', 'deadline', 'signature'])('binds the receipt to submission %s', field => {
    const record = at('submitted');
    const candidate = receipt(record);
    const other = structuredClone(record.submission!);
    if (field === 'signature') other.signature = `0x${'34'.repeat(64)}1c`;
    else if (field === 'deadline') other.operation.deadline++;
    else other.operation.nonce = '1';
    candidate.submissionDigest = recoveryDigest(other);
    expect(() => step(record, { kind: 'confirm', receipt: candidate })).toThrow('issuance_recovery_receipt_invalid');
  });

  it('compares receipt addresses case-insensitively', () => {
    const record = at('submitted');
    const candidate = receipt(record);
    candidate.ledgerAddress = `0x${'D'.repeat(40)}`;
    candidate.holderRevocationSigner = `0x${'A'.repeat(40)}`;
    expect(step(record, { kind: 'confirm', receipt: candidate }).phase).toBe('confirmed');
  });
});

describe('private issuance recovery ownership, retry, and terminal states', () => {
  it('claims a deep clone and rejects claims before the lease boundary', () => {
    const reserved = freezeDeep(createRecoveryRecord(input(), NOW));
    const claimed = claimRecoveryRecord(reserved, OWNER, NOW)!;
    expect(claimed).toMatchObject({ revision: 2, attempts: 1, leaseToken: OWNER, leaseUntilMs: NOW + LEASE_MS });
    expect(reserved.leaseToken).toBeUndefined();
    expect(claimed.input.request.claims).not.toBe(reserved.input.request.claims);
    claimed.input.request.claims!.age = 99;
    expect(reserved.input.request.claims!.age).toBe(21);
    const current = at('reserved');
    expect(claimRecoveryRecord(current, 'owner-2', NOW + LEASE_MS - 1)).toBeUndefined();
    expect(claimRecoveryRecord(current, 'owner-2', NOW + LEASE_MS)).toMatchObject({
      revision: 3, attempts: 2, leaseToken: 'owner-2', leaseUntilMs: NOW + 2 * LEASE_MS,
    });
  });

  it.each(['', OWNER])('rejects empty or reused lease token %s', token => {
    expect(() => claimRecoveryRecord(at('reserved'), token, NOW + LEASE_MS))
      .toThrow('issuance_recovery_claim_invalid');
  });

  it.each([NaN, Infinity, -1, 0.5])('rejects invalid claim and transition time %s', now => {
    const record = at('reserved');
    expect(() => claimRecoveryRecord(record, 'owner-2', now)).toThrow('issuance_recovery_claim_invalid');
    expect(() => step(record, { kind: 'prepare', preparation: preparation() }, now)).toThrow('issuance_recovery_lease_lost');
  });

  it('requires an owned lease and current revision, expiring exactly at the boundary', () => {
    const reserved = createRecoveryRecord(input(), NOW);
    const record = at('reserved');
    const action: RecoveryAction = { kind: 'prepare', preparation: preparation() };
    expect(() => transitionRecoveryRecord(reserved, OWNER, reserved.revision, action, NOW))
      .toThrow('issuance_recovery_lease_lost');
    expect(() => transitionRecoveryRecord(record, 'wrong-owner', record.revision, action, NOW))
      .toThrow('issuance_recovery_lease_lost');
    expect(() => transitionRecoveryRecord(record, OWNER, record.revision - 1, action, NOW))
      .toThrow('issuance_recovery_lease_lost');
    expect(() => transitionRecoveryRecord(record, OWNER, record.revision + 1, action, NOW))
      .toThrow('issuance_recovery_lease_lost');
    expect(step(record, action, NOW + LEASE_MS - 1).phase).toBe('prepared');
    expect(() => step(record, action, NOW + LEASE_MS)).toThrow('issuance_recovery_lease_lost');
    const next = step(record, action);
    expect(() => transitionRecoveryRecord(next, OWNER, record.revision, { kind: 'submit', submission: submission(next) }, NOW))
      .toThrow('issuance_recovery_lease_lost');
  });

  it.each(['reserved', 'prepared', 'submitted', 'confirmed'] as const)
    ('preserves all durable artifacts during %s takeover and retry', phase => {
      const original = freezeDeep(at(phase));
      const takeover = claimRecoveryRecord(original, 'owner-2', NOW + LEASE_MS)!;
      for (const key of ['input', 'inputDigest', 'preparation', 'submission', 'receipt', 'phase', 'createdAtMs'] as const) {
        expect(takeover[key]).toEqual(original[key]);
      }
      expect(() => transitionRecoveryRecord(takeover, OWNER, takeover.revision,
        { kind: 'defer', category: 'dependency_unavailable' }, NOW + LEASE_MS)).toThrow('issuance_recovery_lease_lost');
      const deferred = step(takeover, { kind: 'defer', category: 'dependency_unavailable' }, NOW + LEASE_MS);
      expect(deferred.leaseToken).toBeUndefined();
      expect(deferred.leaseUntilMs).toBeUndefined();
      expect(claimRecoveryRecord(deferred, 'owner-3', deferred.nextAttemptAtMs - 1)).toBeUndefined();
      const retried = claimRecoveryRecord(deferred, 'owner-3', deferred.nextAttemptAtMs)!;
      expect(retried.attempts).toBe(3);
      for (const key of ['input', 'inputDigest', 'preparation', 'submission', 'receipt', 'phase'] as const) {
        expect(retried[key]).toEqual(original[key]);
        if (typeof retried[key] === 'object') expect(retried[key]).not.toBe(original[key]);
      }
    });

  it('confirms a preserved submission after its signing deadline has elapsed', () => {
    const original = at('submitted');
    const late = original.submission!.operation.deadline * 1_000 + 1;
    const takeover = claimRecoveryRecord(original, 'owner-2', late)!;
    expect(step(takeover, { kind: 'confirm', receipt: receipt(takeover) }, late).phase).toBe('confirmed');
  });

  it.each(['dependency_unavailable', 'receipt_pending', 'policy_unavailable'] as const)
    ('accepts finite retry category %s and clears it on progress', category => {
      const deferred = step(at('reserved'), { kind: 'defer', category });
      expect(deferred).toMatchObject({ phase: 'reserved', failureCategory: category, nextAttemptAtMs: NOW + 15_000 });
      const claimed = claimRecoveryRecord(deferred, 'owner-2', deferred.nextAttemptAtMs)!;
      expect(claimed.failureCategory).toBe(category);
      const progressed = step(claimed, { kind: 'prepare', preparation: preparation() }, deferred.nextAttemptAtMs);
      expect(progressed.failureCategory).toBeUndefined();
    });

  it('uses exponential backoff capped at one hour across actual retry claims', () => {
    let record = at('reserved');
    let now = NOW;
    const delays = [15_000, 30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000];
    for (const [index, delay] of delays.entries()) {
      const deferred = step(record, { kind: 'defer', category: 'receipt_pending' }, now);
      expect(deferred.nextAttemptAtMs).toBe(now + delay);
      expect(deferred.attempts).toBe(index + 1);
      expect(deferred.revision).toBe(record.revision + 1);
      now += delay;
      record = claimRecoveryRecord(deferred, `retry-owner-${index}`, now)!;
    }
  });

  it.each([
    ['defer', 'policy_denied'], ['defer', 'artifact_invalid'], ['defer', 'arbitrary'],
    ['block', 'receipt_pending'], ['block', 'dependency_unavailable'], ['block', 'arbitrary'],
    ['defer', null], ['block', undefined],
  ])('rejects %s category %s', (kind, category) => {
    expect(() => step(at('reserved'), { kind, category } as RecoveryAction)).toThrow('issuance_recovery_failure_invalid');
  });

  it('rejects unknown actions', () => {
    expect(() => step(at('reserved'), { kind: 'unknown' } as unknown as RecoveryAction))
      .toThrow('issuance_recovery_action_invalid');
  });

  it.each([null, undefined, [], 'prepare', {}, { kind: 1 }])('rejects malformed action %s', action => {
    expect(() => step(at('reserved'), action as unknown as RecoveryAction)).toThrow('issuance_recovery_action_invalid');
  });

  it.each(['prepare', 'submit', 'confirm', 'complete', 'defer', 'block'] as const)
    ('rejects unknown keys on a %s action', kind => {
      const record = at(kind === 'submit' ? 'prepared' : kind === 'confirm' ? 'submitted'
        : kind === 'complete' ? 'confirmed' : 'reserved');
      const action: RecoveryAction = kind === 'prepare' ? { kind, preparation: preparation() }
        : kind === 'submit' ? { kind, submission: submission(record) }
          : kind === 'confirm' ? { kind, receipt: receipt(record) }
            : kind === 'defer' ? { kind, category: 'dependency_unavailable' }
              : kind === 'block' ? { kind, category: 'artifact_invalid' } : { kind };
      Object.assign(action, { privateKey: 'synthetic-private-material' });
      expect(() => step(record, action)).toThrow('issuance_recovery_data_invalid');
    });

  it.each(['policy_denied', 'artifact_invalid'] as const)('blocks terminally with %s, preserving artifacts', category => {
    const original = at('confirmed');
    const blocked = step(original, { kind: 'block', category });
    expect(blocked).toMatchObject({
      phase: 'blocked', failureCategory: category, preparation: original.preparation,
      submission: original.submission, receipt: original.receipt,
    });
    expect(blocked.leaseToken).toBeUndefined();
    expect(blocked.leaseUntilMs).toBeUndefined();
    expect(claimRecoveryRecord(blocked, 'owner-2', NOW + LEASE_MS)).toBeUndefined();
    for (const action of [
      { kind: 'complete' }, { kind: 'defer', category: 'dependency_unavailable' },
      { kind: 'prepare', preparation: preparation() },
    ] as RecoveryAction[]) expect(() => transitionRecoveryRecord(blocked, OWNER, blocked.revision, action, NOW))
      .toThrow('issuance_recovery_lease_lost');
  });

  it('does not reclaim or transition completed records', () => {
    const record = at('completed');
    expect(claimRecoveryRecord(record, 'owner-2', NOW + LEASE_MS)).toBeUndefined();
    expect(() => transitionRecoveryRecord(record, OWNER, record.revision, { kind: 'complete' }, NOW))
      .toThrow('issuance_recovery_lease_lost');
  });
});

describe('private issuance recovery persisted record validation', () => {
  it('rejects unknown record keys', () => {
    const record = at('reserved');
    Object.assign(record, { privateKey: 'synthetic-private-material' });
    expect(() => validateRecoveryRecord(record)).toThrow('issuance_recovery_data_invalid');
  });

  it.each(['revision', 'attempts'] as const)('rejects claim %s overflow without mutating its input', key => {
    const record = createRecoveryRecord(input(), NOW);
    record[key] = Number.MAX_SAFE_INTEGER;
    freezeDeep(record);
    expect(() => claimRecoveryRecord(record, OWNER, NOW)).toThrow('issuance_recovery_record_invalid');
    expect(record[key]).toBe(Number.MAX_SAFE_INTEGER);
    expect(record.leaseToken).toBeUndefined();
  });

  it('rejects lease time overflow on claim', () => {
    const record = createRecoveryRecord(input(), Number.MAX_SAFE_INTEGER);
    expect(() => claimRecoveryRecord(record, OWNER, Number.MAX_SAFE_INTEGER))
      .toThrow('issuance_recovery_record_invalid');
  });

  it('rejects revision overflow on transition', () => {
    const record = at('reserved');
    record.revision = Number.MAX_SAFE_INTEGER;
    expect(() => step(record, { kind: 'prepare', preparation: preparation() }))
      .toThrow('issuance_recovery_record_invalid');
  });

  it('rejects retry time overflow on defer', () => {
    const now = Number.MAX_SAFE_INTEGER - 1;
    const record = at('reserved');
    record.leaseUntilMs = Number.MAX_SAFE_INTEGER;
    expect(() => step(record, { kind: 'defer', category: 'receipt_pending' }, now))
      .toThrow('issuance_recovery_record_invalid');
  });

  it.each([
    ['requestId', 'other'], ['inputDigest', '0'.repeat(64)], ['revision', 0], ['revision', 0.5],
    ['attempts', -1], ['attempts', Infinity], ['nextAttemptAtMs', -1], ['createdAtMs', NaN],
    ['updatedAtMs', 0.5], ['phase', 'unknown'], ['leaseToken', ''], ['leaseUntilMs', -1],
  ])('rejects invalid record %s=%s', (key, value) => {
    const record = at('reserved');
    Object.assign(record, { [key as string]: value });
    expect(() => validateRecoveryRecord(record)).toThrow('issuance_recovery_record_invalid');
  });

  it.each(['leaseToken', 'leaseUntilMs'] as const)('rejects a lease missing %s', key => {
    const record = at('reserved');
    delete record[key];
    expect(() => validateRecoveryRecord(record)).toThrow('issuance_recovery_record_invalid');
  });

  it.each(['prepared', 'submitted', 'confirmed', 'completed'] as const)('rejects missing required artifacts in %s', phase => {
    const record = at(phase);
    if (phase === 'prepared') delete record.preparation;
    else if (phase === 'submitted') delete record.submission;
    else delete record.receipt;
    expect(() => validateRecoveryRecord(record)).toThrow('issuance_recovery_record_invalid');
  });

  it.each(['reserved', 'prepared', 'submitted'] as const)('rejects artifacts ahead of phase %s', phase => {
    const record = at('confirmed');
    record.phase = phase;
    expect(() => validateRecoveryRecord(record)).toThrow('issuance_recovery_record_invalid');
  });

  it.each(['blocked', 'completed'] as const)('rejects a lease on terminal phase %s', phase => {
    const record = at(phase);
    record.leaseToken = OWNER;
    record.leaseUntilMs = NOW + LEASE_MS;
    expect(() => validateRecoveryRecord(record)).toThrow('issuance_recovery_record_invalid');
  });

  it.each(['arbitrary', '', null, 42])('rejects non-enumerated persisted failure category %s', category => {
    const record = step(at('reserved'), { kind: 'defer', category: 'dependency_unavailable' });
    Object.assign(record, { failureCategory: category });
    expect(() => validateRecoveryRecord(record)).toThrow('issuance_recovery_record_invalid');
  });

  it('rechecks submission and receipt binding when loading persisted records', () => {
    const changedOperation = at('submitted');
    changedOperation.submission!.operation.requestIdHash = ledgerV2RequestHash('other');
    expect(() => validateRecoveryRecord(changedOperation)).toThrow('issuance_recovery_submission_invalid');
    const changedReceipt = at('confirmed');
    changedReceipt.receipt!.transactionHash = 'bad';
    expect(() => validateRecoveryRecord(changedReceipt)).toThrow('issuance_recovery_receipt_invalid');
  });
});
