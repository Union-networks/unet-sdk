/** @public */
export type VerificationRequestType = string;
/** @public */
export type VerificationAggregateOutcome = 'passed' | 'warning' | 'failed';
/** @public */
export type VerificationStatus = 'created' | 'pending_scan' | 'pending_user_action' | 'denied' | 'submitted' | 'verified' | 'rejected' | 'expired' | 'unavailable';

/** Runtime configuration for public U-net control-plane and verifier calls.
 * @public
 */
export interface UnetClientOptions {
  controlPlaneUrl?: string;
  verifierBaseUrl?: string;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
}
/** @public */
export interface PollOptions { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal; }

/** @public */
export interface PageInfo { limit: number; hasNextPage: boolean; nextCursor?: string; totalCount?: number; }
/** @public */
export interface ListPageOptions { limit?: number; cursor?: string; query?: string; category?: string; }


/** Public Direct Login metadata for one verified service origin.
 * @public
 */
export interface VerifiedService {
  serviceId: string;
  name: string;
  provider: string;
  origin: string;
  icon?: string;
  status: 'active';
  accountPolicy: { mode: 'single' | 'multiple'; maxAccounts: number; policyVersion: 2 };
  endpoints: { challenge: string; approval: string; status: string; exchange: string; retirement: string };
}
/** @public */
export interface ResolveServiceInput { serviceId: string; origin: string; }
/** @public */
export interface ServiceResolution { success: true; registryRevision: string; service: VerifiedService; }
/** @public */
export interface UnetMiniAppManifest { serviceId: string; name: string; provider: string; description: string; icon?: string; launchUrl: string; permissions: string[]; notificationCategories?: string[]; }

/** @public */
export interface VerificationRequestedCheck { requestType: VerificationRequestType; circuitId?: string; vkId?: string; proofFormat?: 'noir-barretenberg-v1'; oracleHash?: 'poseidon2' | 'keccak'; label?: string; }
/** @public */
export interface VerificationCheckResult { requestType: VerificationRequestType; status: 'passed' | 'warning' | 'failed'; reasonCode?: string; reason?: string; attestationStatus?: 'active' | 'revoked' | 'unknown'; issuerId?: string; }
/** @public */
export interface VerificationCheckCatalogResponse { checks: VerificationRequestedCheck[]; pageInfo?: PageInfo; }
/** @public */
export type ListVerificationChecksOptions = ListPageOptions & { status?: 'active' | 'deprecated' | 'revoked'; };

/** @public */
export interface MiniProgramDefinition {
  id: string;
  serviceId?: string;
  name: string;
  provider: string;
  description: string;
  category: string;
  status: string;
  icon: string;
  origin: string;
  launchUrl: string;
  permissions: string[];
  notificationCategories?: string[];
  updatedAt?: string;
}
/** @public */
export interface MiniProgramCatalogResponse { success: true; programs: MiniProgramDefinition[]; pageInfo?: PageInfo; }
/** @public */
export type ListMiniProgramsOptions = ListPageOptions;

/** @public */
export interface CreateVerificationSessionInput { verifierId: string; verifierDisplayName: string; requestType?: VerificationRequestType; requestedChecks?: VerificationRequestedCheck[]; ttlSeconds?: number; }
/** @public */
export interface VerificationSession { sessionId: string; sessionRef: string; createdAt: string; expiresAt: string; status: VerificationStatus; qrPayload: string; requestedChecks?: VerificationRequestedCheck[]; }
/** @public */
export interface VerificationSessionStatus { sessionId: string; status: VerificationStatus; checkedAt: string; expiresAt: string; resultCode?: string; reasonCode?: string; aggregateOutcome?: VerificationAggregateOutcome; checkResults?: VerificationCheckResult[]; }
