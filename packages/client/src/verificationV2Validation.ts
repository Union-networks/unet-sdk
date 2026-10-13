import { UnetContractError } from './errors.js';
import type { CreateVerificationV2SessionInput } from './verificationV2Types.js';

type Obj = Record<string, unknown>;
function invalid(): never { throw new UnetContractError('verification_v2_contract_invalid'); }
const object = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : invalid();
const keys = (v: Obj, required: string[], optional: string[] = []) => {
  if (required.some(k => !Object.hasOwn(v, k)) || Object.keys(v).some(k => !required.includes(k) && !optional.includes(k))) invalid();
};
const strings = (v: Obj, names: string[]) => { for (const k of names) if (typeof v[k] !== 'string' || !(v[k] as string).length) invalid(); };
export const isVerificationV2Timestamp = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const date = (v: unknown) => { if (!isVerificationV2Timestamp(v)) invalid(); };
export const isVerificationV2Reference = (v: unknown): v is string => typeof v === 'string' && v.length >= 20 && v.length <= 160 && /^[A-Za-z0-9_-]+$/.test(v);
export const isVerificationV2RequestType = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 160 && /^[A-Za-z0-9._:/-]+$/.test(v);
export const isVerificationV2Capability = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
const arrayStrings = (v: unknown) => { if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || !x)) invalid(); };
const hash = (v: unknown) => { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) invalid(); };
export function validateV2CreateInput(value: unknown): asserts value is CreateVerificationV2SessionInput {
  const v = object(value); keys(v, ['requestTypes'], ['title']);
  if (!Array.isArray(v.requestTypes) || v.requestTypes.length < 1 || v.requestTypes.length > 8 || v.requestTypes.some(t => !isVerificationV2RequestType(t))
    || new Set(v.requestTypes).size !== v.requestTypes.length || (v.title !== undefined && (typeof v.title !== 'string' || v.title.length < 1 || v.title.length > 160))) invalid();
}
const checkOptional = ['proofFormat', 'oracleHash', 'label', 'issuerId', 'issuerServiceId', 'issuerMiniProgramId', 'status', 'schemaId', 'predicateId', 'templateType', 'proofProfileId', 'profileVersion', 'description', 'category', 'icon', 'consentText', 'proofVersion', 'proofEncodingFormat', 'predicateParams', 'witnessSchema', 'publicInputOrder', 'issuerKeyHashes', 'artifactRef', 'minRuntimeVersion', 'proverArtifact', 'credentialPolicy'];
const check = (value: unknown, expiry = false) => {
  const v = object(value);
  const required = expiry
    ? ['requestType', 'schemaId', 'proofProfileId', 'circuitId', 'vkId', 'publicInputOrder', 'claimPath', 'matchesCredentialValidUntil']
    : ['requestType', 'schemaId', 'issuerId', 'proofProfileId', 'circuitId', 'vkId', 'predicateParams', 'publicInputOrder', 'issuerKeyHashes', 'expiryCheck'];
  keys(v, required, checkOptional);
  strings(v, required.filter(k => !['predicateParams', 'publicInputOrder', 'issuerKeyHashes', 'expiryCheck', 'matchesCredentialValidUntil'].includes(k)));
  if (!isVerificationV2RequestType(v.requestType) || !isVerificationV2RequestType(v.proofProfileId) || !isVerificationV2RequestType(v.vkId)) invalid();
  arrayStrings(v.publicInputOrder);
  if (v.proofFormat !== undefined && v.proofFormat !== 'noir-barretenberg-v1') invalid();
  if (v.oracleHash !== undefined && !['poseidon2', 'keccak'].includes(v.oracleHash as string)) invalid();
  if (v.label !== undefined && typeof v.label !== 'string') invalid();
  for (const k of ['issuerId', 'issuerServiceId', 'issuerMiniProgramId', 'predicateId', 'templateType', 'profileVersion', 'description', 'category', 'icon', 'consentText', 'proofVersion', 'artifactRef', 'minRuntimeVersion']) if (v[k] !== undefined && typeof v[k] !== 'string') invalid();
  if (v.status !== undefined && !['active', 'deprecated', 'revoked'].includes(v.status as string)) invalid();
  if (v.proofEncodingFormat !== undefined && v.proofEncodingFormat !== 'bb_binary_proof_with_public_inputs_prefix') invalid();
  if (v.predicateParams !== undefined) object(v.predicateParams);
  if (v.proverArtifact !== undefined) object(v.proverArtifact);
  if (v.issuerKeyHashes !== undefined) arrayStrings(v.issuerKeyHashes);
  if (v.witnessSchema !== undefined) {
    if (!Array.isArray(v.witnessSchema)) invalid();
    for (const item of v.witnessSchema) {
      const w = object(item); keys(w, ['index', 'name'], ['source', 'path', 'value', 'transform']); strings(w, ['name']);
      if (!Number.isSafeInteger(w.index) || (w.index as number) < 0 || (w.path !== undefined && typeof w.path !== 'string')) invalid();
      if (w.source !== undefined && !['session', 'credential', 'claim', 'predicate', 'constant'].includes(w.source as string)) invalid();
      if (w.transform !== undefined && !['field', 'date_year', 'date_month', 'date_day', 'sha256_decimal'].includes(w.transform as string)) invalid();
      if (w.value !== undefined && !['string', 'number', 'boolean'].includes(typeof w.value)) invalid();
    }
  }
  if (v.credentialPolicy !== undefined) {
    const p = object(v.credentialPolicy); keys(p, ['validityMode', 'renewalMode'], ['defaultValidityDays', 'maximumValidityDays', 'renewalWindowDays', 'replacementMode']);
    if (!['none', 'fixed', 'issuer_capped'].includes(p.validityMode as string) || !['none', 'holder_reissue', 'silent_reissue'].includes(p.renewalMode as string)) invalid();
    if (p.replacementMode !== undefined && !['deny', 'replace_after_delivery', 'parallel'].includes(p.replacementMode as string)) invalid();
    for (const k of ['defaultValidityDays', 'maximumValidityDays', 'renewalWindowDays']) if (p[k] !== undefined && (typeof p[k] !== 'number' || !Number.isFinite(p[k]))) invalid();
  }
  if (expiry) {
    if (v.proofProfileId !== 'claim_equals_v1' || v.claimPath !== 'valid_until' || v.matchesCredentialValidUntil !== true) invalid();
  } else { object(v.predicateParams); arrayStrings(v.issuerKeyHashes); check(v.expiryCheck, true); }
};
const challengeKeys = ['protocolVersion', 'sessionId', 'requestRef', 'audience', 'nonce', 'verificationEpoch', 'createdAt', 'expiresAt', 'requestedChecksDigest', 'requestedChecks', 'title'];

export const validateV2Challenge = (value: unknown, session = false): void => {
  const v = object(value);
  keys(v, session ? [...challengeKeys, 'resultReadCapability', 'qrPayload'] : challengeKeys);
  strings(v, ['sessionId', 'requestRef', 'audience', 'nonce']);
  if (!isVerificationV2Reference(v.sessionId) || !isVerificationV2Reference(v.requestRef) || !/^[a-f0-9]{62}$/.test(v.nonce as string)
    || typeof v.title !== 'string' || !v.title || v.title.length > 160 || v.protocolVersion !== 2 || !Number.isSafeInteger(v.verificationEpoch) || (v.verificationEpoch as number) < 0) invalid();
  date(v.createdAt); date(v.expiresAt); hash(v.requestedChecksDigest);
  if (Date.parse(v.expiresAt as string) - Date.parse(v.createdAt as string) !== 600_000 || v.verificationEpoch !== Math.floor(Date.parse(v.createdAt as string) / 1000)) invalid();
  if (!Array.isArray(v.requestedChecks) || !v.requestedChecks.length || v.requestedChecks.length > 8) invalid();
  v.requestedChecks.forEach(c => check(c));
  if (new Set(v.requestedChecks.map(c => object(c).requestType)).size !== v.requestedChecks.length) invalid();
  if (session) {
    strings(v, ['resultReadCapability', 'qrPayload']);
    const capability = v.resultReadCapability as string;
    if (!isVerificationV2Capability(capability) || v.qrPayload !== `unet://verify?session_ref=${encodeURIComponent(v.requestRef as string)}&version=2`) invalid();
  }
};

const proof = (value: unknown) => {
  const v = object(value);
  keys(v, ['profileId', 'vkId', 'publicInputs', 'proofEncoding', 'proof']);
  strings(v, ['profileId', 'vkId', 'proof']); arrayStrings(v.publicInputs);
  if (!isVerificationV2RequestType(v.profileId) || !isVerificationV2RequestType(v.vkId) || (v.publicInputs as string[]).length > 256
    || (v.publicInputs as string[]).some(input => input.length > 160) || (v.proof as string).length > 262_144
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.proof as string) || v.proofEncoding !== 'bb_binary_proof_with_public_inputs_prefix') invalid();
};
export const validateV2Submission = (value: unknown): void => {
  const v = object(value);
  keys(v, ['protocolVersion', 'sessionId', 'submissionId', 'requestedChecksDigest', 'checkResponses']);
  if (v.protocolVersion !== 2) invalid();
  strings(v, ['sessionId', 'submissionId']); hash(v.requestedChecksDigest);
  if (!isVerificationV2Reference(v.sessionId) || !isVerificationV2Reference(v.submissionId)) invalid();
  if (!Array.isArray(v.checkResponses) || !v.checkResponses.length || v.checkResponses.length > 8) invalid();
  for (const item of v.checkResponses) {
    const r = object(item); keys(r, ['requestType', 'decision'], ['credential']); strings(r, ['requestType']);
    if (!isVerificationV2RequestType(r.requestType)) invalid();
    if (r.decision === 'deny') { if (r.credential !== undefined) invalid(); }
    else if (r.decision === 'approve') {
      const c = object(r.credential); keys(c, ['attestationCommitment', 'validUntilEpoch', 'checkProof', 'expiryProof']);
      strings(c, ['attestationCommitment']);
      if (!/^(0x)?[a-fA-F0-9]{64}$/.test(c.attestationCommitment as string) || !Number.isSafeInteger(c.validUntilEpoch) || (c.validUntilEpoch as number) <= 0) invalid();
      proof(c.checkProof); proof(c.expiryProof);
    } else invalid();
  }
  if (new Set(v.checkResponses.map(r => object(r).requestType)).size !== v.checkResponses.length) invalid();
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 4 * 1024 * 1024) invalid();
};
const reasons = ['verification_succeeded', 'holder_denied', 'session_expired', 'invalid_proof', 'attestation_not_found', 'attestation_revoked', 'credential_expired', 'issuer_inactive', 'check_unavailable', 'dependency_unavailable'];
export const validateV2CheckResults = (value: unknown, terminal = false): void => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) invalid();
  const seen = new Set<string>();
  for (const result of value) {
    const r = object(result); keys(r, ['requestType', 'status', 'reasonCode']);
    if (!isVerificationV2RequestType(r.requestType) || seen.has(r.requestType) || !['passed', 'failed', 'declined', 'unavailable'].includes(r.status as string) || !reasons.includes(r.reasonCode as string)
      || (r.status === 'passed') !== (r.reasonCode === 'verification_succeeded') || (r.status === 'declined') !== (r.reasonCode === 'holder_denied')
      || (r.status === 'unavailable') !== ['check_unavailable', 'dependency_unavailable'].includes(r.reasonCode as string) || (terminal && r.status === 'unavailable')) invalid();
    seen.add(r.requestType);
  }
};
export const validateV2Status = (value: unknown): void => {
  const v = object(value);
  keys(v, ['protocolVersion', 'sessionId', 'status', 'expiresAt'], ['checkedAt', 'checkResults', 'receipt', 'retryable']);
  if (v.protocolVersion !== 2 || !['created', 'verifying', 'verified', 'denied', 'rejected', 'expired', 'unavailable'].includes(v.status as string)) invalid();
  if (!isVerificationV2Reference(v.sessionId)) invalid(); date(v.expiresAt);
  if (v.checkedAt !== undefined) date(v.checkedAt);
  if (v.receipt !== undefined && (typeof v.receipt !== 'string' || !v.receipt || v.receipt.length > 32_768)) invalid();
  if (v.retryable !== undefined && typeof v.retryable !== 'boolean') invalid();
  const terminal = ['verified', 'denied', 'rejected'].includes(v.status as string);
  if (terminal) {
    if (!v.receipt || !v.checkedAt) invalid();
    validateV2CheckResults(v.checkResults, true);
    const results = v.checkResults as Array<{ status: string }>;
    const outcome = results.every(r => r.status === 'passed') ? 'verified' : results.every(r => r.status === 'declined') ? 'denied' : 'rejected';
    if (v.status !== outcome || Date.parse(v.checkedAt as string) > Date.parse(v.expiresAt as string) || v.retryable !== undefined) invalid();
  } else {
    if (v.receipt !== undefined || v.checkedAt !== undefined || v.checkResults !== undefined) invalid();
    if (v.status === 'unavailable' ? v.retryable !== true : v.retryable !== undefined) invalid();
  }
};
export const validateV2Jwks = (value: unknown): void => {
  const v = object(value); keys(v, ['keys']);
  if (!Array.isArray(v.keys)) invalid();
  const seen = new Set<string>();
  for (const key of v.keys) {
    const k = object(key); keys(k, ['kty', 'crv', 'x', 'kid', 'alg', 'use', 'status']); strings(k, ['kid', 'x']);
    if (k.kty !== 'OKP' || k.crv !== 'Ed25519' || k.alg !== 'EdDSA' || k.use !== 'sig' || !['active', 'retained', 'revoked'].includes(k.status as string)
      || !/^[A-Za-z0-9_-]{43}$/.test(k.x as string) || (k.kid as string).length > 160 || seen.has(k.kid as string)) invalid();
    seen.add(k.kid as string);
  }
};
