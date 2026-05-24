export type VerificationRequestType = 'age_over_18' | 'dutch_citizen';
export type VerificationAggregateOutcome = 'passed' | 'warning' | 'failed';
export type VerificationStatus = 'created' | 'pending_scan' | 'pending_user_action' | 'denied' | 'submitted' | 'verified' | 'rejected' | 'expired' | 'unavailable';

export interface UnetClientOptions { issuerBaseUrl?: string; verifierBaseUrl?: string; fetchImpl?: typeof fetch; defaultTimeoutMs?: number; }
export interface PollOptions { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal; }

export interface WebLoginSession { success: true; sessionId: string; requestRef: string; serviceId: string; origin: string; status: 'pending' | 'approved' | 'denied' | 'expired'; scopedUserId?: string; assertionJws?: string; qrPayload?: string; qrDataUrl?: string; createdAt: string; expiresAt: string; decidedAt?: string; service?: { serviceId: string; name: string; origin: string; redirectUrl?: string; icon?: string; status: string }; }
export interface CreateWebLoginSessionInput { serviceId: string; origin: string; expiresInSeconds?: number; }

export interface VerificationRequestedCheck { requestType: VerificationRequestType; circuitId?: string; vkId?: string; proofFormat?: 'noir-barretenberg-v1'; oracleHash?: 'poseidon2' | 'keccak'; label?: string; }
export interface VerificationCheckResult { requestType: VerificationRequestType; status: 'passed' | 'warning' | 'failed'; reasonCode?: string; reason?: string; attestationStatus?: 'active' | 'revoked' | 'unknown'; issuerId?: string; }
export interface VerificationCheckCatalogResponse { checks: VerificationRequestedCheck[]; }
export interface CreateVerificationSessionInput { verifierId: string; verifierDisplayName: string; requestType?: VerificationRequestType; requestedChecks?: VerificationRequestedCheck[]; ttlSeconds?: number; }
export interface VerificationSession { sessionId: string; sessionRef: string; createdAt: string; expiresAt: string; status: VerificationStatus; qrPayload: string; requestedChecks?: VerificationRequestedCheck[]; }
export interface VerificationSessionStatus { sessionId: string; status: VerificationStatus; checkedAt: string; expiresAt: string; resultCode?: string; reasonCode?: string; aggregateOutcome?: VerificationAggregateOutcome; checkResults?: VerificationCheckResult[]; }

export interface CreateCheckoutVerificationInput { serviceId: string; assertionJws: string; requiredChecks: VerificationRequestType[]; restrictedResourceIds?: string[]; ttlSeconds?: number; }
export interface CheckoutVerification { checkoutId: string; serviceId: string; scopedUserId: string; status: 'completed' | 'pending_verification' | 'failed' | 'expired'; requiredChecks: VerificationRequestType[]; restrictedResourceIds: string[]; verificationSessionId?: string; verificationSessionRef?: string; failureReason?: string; createdAt: string; updatedAt: string; expiresAt?: string; }
export interface CheckoutVerificationResponse { success: true; requiresVerification?: boolean; checkout: CheckoutVerification; verification?: { sessionId: string; sessionRef: string; qrPayload: string; qrDataUrl?: string; requestedChecks: VerificationRequestedCheck[]; expiresAt: string }; }
