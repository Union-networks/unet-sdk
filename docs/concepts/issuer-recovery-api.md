# Staged Core Issuer Recovery API

This is a supported package-entry-point candidate for provider integration in the
coordinated SDK 2 release-candidate train only. It is not approved stable, published
or deployed by this change. The declarations use `@beta` to retain that distinction.
It is core recovery, not an experimental standards prototype; no standards
prototype exports are added.

Promotion lets Safety and other providers consume the built, packaged
`@u-net/issuer` module instead of local private source imports. Existing installed
`2.0.0-rc.2` packages do not gain these exports from source edits. Consumer
integration must use a locally built candidate package containing this API;
publication, deployment and stable approval remain separate coordinated gates.

## Package Surface

```ts
import {
  ensureIssuanceRecoverySchema,
  PostgresIssuanceRecoveryStore,
  TransactionalIssuanceRecoveryStore,
  reconcileRecoveryAnchor,
} from '@u-net/issuer';
import type {
  IssuanceRecoverySqlPool,
  RecoveryAction,
  RecoveryAnchorReconciliationOptions,
  RecoveryAnchorReconciliationResult,
  RecoveryFailure,
  RecoveryInput,
  RecoveryPhase,
  RecoveryPreparation,
  RecoveryReceipt,
  RecoveryRecord,
  RecoverySubmission,
  SqlClient,
} from '@u-net/issuer';
```

`IssuanceRecoverySqlPool` is the unambiguous public name for the recovery module's
`SqlPool`. `SqlClient`, `DirectIssuerRequestRecord` and `LedgerV2AnchorOperation`
are already exported dependencies of these signatures. Kernel record creation,
claim, transition, validation and digest helpers are intentionally not exported
from the package entry point. Providers use the stores and reconciler, not deep
imports or locally copied private helpers.

## Transaction Ownership

- Run `ensureIssuanceRecoverySchema` before entering provider transactions. The
  caller owns the supplied SQL client's lifecycle.
- `TransactionalIssuanceRecoveryStore` requires one pinned SQL client in an
  already-open transaction, never a pool. The provider owns `BEGIN`, timeouts,
  policy/account locking, `COMMIT`/`ROLLBACK` and connection release. Compose
  request, journal and application publication writes on that same transaction.
  Roll back on any adapter or publication error, await every operation, and
  discard the adapter when the transaction ends. Returned records are not
  committed until the caller commits. No network work belongs in this transaction.
- `PostgresIssuanceRecoveryStore` owns a pinned connection and transaction per
  operation, including timeouts, commit/rollback and release. It does not compose
  separate calls atomically with provider policy or publication writes.
- `reconcileRecoveryAnchor` performs network reconciliation outside the provider
  transaction. It neither mutates the journal nor authorizes publication. Recheck
  current provider policy and apply transitions using the current lease token and
  revision inside the owned transaction before publication.

## Reconciliation Boundary

The reconciler submits the exact durable signed operation to the configured
HTTPS gateway. It does not refresh or re-sign expired attempts, independently
verify RPC evidence, or act as a provider coordinator. Its options allow an
injected `fetch` and an `AbortSignal`.

Results are `confirmed` with a `RecoveryReceipt`, `revoked`, `pending`, or
`unavailable`. Only the configured request-specific gateway is trusted for this
evidence; generic status reads and transaction hashes alone are not sufficient.
Transport, malformed-evidence and validation failures remain `unavailable`.
The provider still owns scheduling, fresh authorization and atomic publication.

## Acceptance Boundary

This export/declaration change leaves validation, lease fencing, retry behavior,
transaction handling and reconciliation semantics unchanged. Build, API Extractor,
typechecks and offline regression tests validate the package candidate, not a
deployed Safety consumer or real PostgreSQL/RPC acceptance. Consumer integration,
crash/restart and policy-race coverage, durable scheduling, shared nonce/signed
attempt coordination and native-wallet recovery remain separate acceptance work.
See [recoverable admission](./issuer-request-admission.md) for the broader gates.
