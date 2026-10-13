import type { VerificationRequestedCheck } from './types.js';

/** Public operator-approved prover witness metadata, not a holder witness value. @public */
export interface VerificationV2WitnessSchemaEntry {
  index: number;
  name: string;
  source?: 'session' | 'credential' | 'claim' | 'predicate' | 'constant';
  path?: string;
  value?: string | number | boolean;
  transform?: 'field' | 'date_year' | 'date_month' | 'date_day' | 'sha256_decimal';
}

/** Full canonical public check metadata, separate from legacy SDK check selectors. @public */
export interface VerificationV2RequestedCheck extends VerificationRequestedCheck {
  issuerId?: string;
  issuerServiceId?: string;
  issuerMiniProgramId?: string;
  status?: 'active' | 'deprecated' | 'revoked';
  schemaId?: string;
  predicateId?: string;
  templateType?: string;
  proofProfileId?: string;
  profileVersion?: string;
  description?: string;
  category?: string;
  icon?: string;
  consentText?: string;
  proofVersion?: string;
  proofEncodingFormat?: 'bb_binary_proof_with_public_inputs_prefix';
  predicateParams?: Record<string, unknown>;
  witnessSchema?: VerificationV2WitnessSchemaEntry[];
  publicInputOrder?: string[];
  issuerKeyHashes?: string[];
  artifactRef?: string;
  minRuntimeVersion?: string;
  proverArtifact?: Record<string, unknown>;
  credentialPolicy?: {
    validityMode: 'none' | 'fixed' | 'issuer_capped';
    defaultValidityDays?: number;
    maximumValidityDays?: number;
    renewalMode: 'none' | 'holder_reissue' | 'silent_reissue';
    renewalWindowDays?: number;
    replacementMode?: 'deny' | 'replace_after_delivery' | 'parallel';
  };
}

/** Immutable approved predicate and its signed credential-expiry binding. @public */
export interface VerificationV2Check extends VerificationV2RequestedCheck {
  schemaId: string;
  issuerId: string;
  proofProfileId: string;
  circuitId: string;
  vkId: string;
  predicateParams: Record<string, unknown>;
  publicInputOrder: string[];
  issuerKeyHashes: string[];
  expiryCheck: VerificationV2RequestedCheck & {
    schemaId: string;
    proofProfileId: 'claim_equals_v1';
    circuitId: string;
    vkId: string;
    publicInputOrder: string[];
    claimPath: 'valid_until';
    matchesCredentialValidUntil: true;
  };
}

/** Public challenge; contains no private result capability or holder identity. @public */
export interface VerificationV2Challenge {
  protocolVersion: 2;
  sessionId: string;
  requestRef: string;
  audience: string;
  nonce: string;
  verificationEpoch: number;
  createdAt: string;
  expiresAt: string;
  requestedChecksDigest: string;
  requestedChecks: VerificationV2Check[];
  title: string;
}

/** Creation response. Keep resultReadCapability private; share only qrPayload. @public */
export interface VerificationV2Session extends VerificationV2Challenge {
  resultReadCapability: string;
  qrPayload: string;
}

/** Approved generic proof, including its bound public inputs. @public */
export interface VerificationV2Proof {
  profileId: string;
  vkId: string;
  publicInputs: string[];
  proofEncoding: 'bb_binary_proof_with_public_inputs_prefix';
  proof: string;
}

/** Consented decision with matching predicate and signed expiry proofs. @public */
export interface VerificationV2CheckResponse {
  requestType: string;
  decision: 'approve' | 'deny';
  credential?: {
    attestationCommitment: string;
    validUntilEpoch: number;
    checkProof: VerificationV2Proof;
    expiryProof: VerificationV2Proof;
  };
}

/** Immutable, retryable proof submission; no global holder registration or JWS. @public */
export interface VerificationV2Submission {
  protocolVersion: 2;
  sessionId: string;
  submissionId: string;
  requestedChecksDigest: string;
  checkResponses: VerificationV2CheckResponse[];
}

/** Sanitized verification outcome, not a wallet lifecycle mutation. @public */
export type VerificationV2Reason = 'verification_succeeded' | 'holder_denied' | 'session_expired'
  | 'invalid_proof' | 'attestation_not_found' | 'attestation_revoked' | 'credential_expired'
  | 'issuer_inactive' | 'check_unavailable' | 'dependency_unavailable';

/** Historical outcome of one explicitly requested check. @public */
export interface VerificationV2CheckResult {
  requestType: string;
  status: 'passed' | 'failed' | 'declined' | 'unavailable';
  reasonCode: VerificationV2Reason;
}

/** Minimal signed historical result; never authorizes a current operation. @public */
export interface VerificationV2ReceiptPayload {
  protocolVersion: 2;
  iss: string;
  aud: string;
  sessionId: string;
  requestRefHash: string;
  nonce: string;
  requestedChecksDigest: string;
  checkedAt: string;
  checkResults: VerificationV2CheckResult[];
}

/** Private polling or submission result, possibly carrying a compact signed receipt. @public */
export interface VerificationV2Status {
  protocolVersion: 2;
  sessionId: string;
  status: 'created' | 'verifying' | 'verified' | 'denied' | 'rejected' | 'expired' | 'unavailable';
  expiresAt: string;
  checkedAt?: string;
  checkResults?: VerificationV2CheckResult[];
  receipt?: string;
  retryable?: boolean;
}

/** Verifier result key; retained keys verify history, revoked keys never do. @public */
export interface VerificationV2Jwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  kid: string;
  alg: 'EdDSA';
  use: 'sig';
  status: 'active' | 'retained' | 'revoked';
}

/** Public verifier key set obtained from an explicitly trusted origin. @public */
export interface VerificationV2Jwks { keys: VerificationV2Jwk[] }

/** Public requested checks for a ten-minute manual session. @public */
export interface CreateVerificationV2SessionInput { requestTypes: string[]; title?: string; }

/** Private polling authority; never put resultReadCapability in a URL or QR. @public */
export interface GetVerificationV2StatusInput { sessionId: string; resultReadCapability: string; }

/** Cancellation for a single bounded HTTP operation. @public */
export interface VerificationV2RequestOptions { signal?: AbortSignal; }
