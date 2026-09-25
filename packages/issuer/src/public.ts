/** Sovereign Core V2 issuer APIs. */
export * from './directIssuer.js';
export * from './directIssuerPostgres.js';
export * from './ledgerV2.js';
export * from './webAdapters.js';

// Core recovery candidate for the coordinated SDK 2 RC train, not approved stable.
export {
  ensureIssuanceRecoverySchema,
  PostgresIssuanceRecoveryStore,
  TransactionalIssuanceRecoveryStore,
} from './issuanceRecoveryPostgres.js';
export type { SqlPool as IssuanceRecoverySqlPool } from './issuanceRecoveryPostgres.js';
export { reconcileRecoveryAnchor } from './issuanceRecoveryLedger.js';
export type {
  RecoveryAnchorReconciliationOptions,
  RecoveryAnchorReconciliationResult,
} from './issuanceRecoveryLedger.js';
export type {
  RecoveryAction,
  RecoveryFailure,
  RecoveryInput,
  RecoveryPhase,
  RecoveryPreparation,
  RecoveryReceipt,
  RecoveryRecord,
  RecoverySubmission,
} from './issuanceRecovery.js';

export {
  anchorLedgerV2CredentialFromEnv,
  buildFieldMerkleProofV2,
  createCredentialEnvelopeV2,
  createDomainAdminCallbackHandlerV2,
  createDomainAdminControlAuthorizationV2,
  createDomainAdminSignerFromEnv,
  createHolderRelinquishmentCallbackHandler,
  createIssuerMiniappManifest,
  createIssuerSignerFromEnv,
  deriveClaimLeafV2,
  deriveCredentialPublicKeyHash,
  deriveHolderBindingV2,
  deriveNullifierV2,
  derivePredicateV2,
  encryptCredentialEnvelopeV2,
  fetchUnetControlPublicKeys,
  generateAttestationIssuerEnv,
  generateCredentialSigningKeyPair,
  generateDomainAdminSignerEnv,
  generateIssuerKeyPair,
  generateIssuerKeyPairEnv,
  revokeLedgerV2CredentialFromEnv,
  resolveCredentialValidity,
  signDomainAdminCredentialResponse,
  validateDomainAdminCallbackRequest,
  verifyDomainAdminControlAuthorizationV2,
} from './index.js';

export type {
  AttestationCredentialPolicy,
  CredentialClaimProofV2,
  CredentialClaimV2,
  CredentialEnvelopeV2,
  CredentialRenewalMode,
  CredentialValidityMode,
  CredentialValidityWindow,
  DomainAdminCallbackRequest,
  DomainAdminControlAuthorizationPayload,
  DomainAdminCredentialIssueResult,
  DomainAdminRole,
  EncryptedCredentialEnvelopeV2,
  HolderRelinquishmentCallbackRequest,
  IssuerAction,
  IssuerActionEnvelope,
  IssuerMiniappManifestInput,
  IssuerSigner,
  SignedDomainAdminCredentialResponse,
} from './index.js';
