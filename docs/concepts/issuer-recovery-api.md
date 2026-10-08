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

The reconciler submits exact durable signed operations to the configured HTTPS
gateway. In `submitted`, it builds a newest-first list (latest, then history in
reverse append order), including expired signatures, and cyclically rotates it by
`Math.max(0, record.attempts - 1) % savedAttemptCount`. The first claim starts newest;
successive worker claims give older attempts fair starting positions, wrapping
around the saved list. It stops at the first exact confirmed
receipt or the gateway's exact request-specific revocation response. Pending,
invalid or unavailable responses allow older attempts to be checked while budget
remains. Without definitive evidence, all-pending returns `pending`; any failed
check or exhausted budget returns `unavailable`. Ordinary `active` status is never
confirmation evidence.

All attempts share one monotonic **10-second total transport budget**, including
headers, streaming bodies and parsing, not 10 seconds per attempt. The existing
64 KiB response limit, exact gateway response schema, confirmation arithmetic,
redirect rejection and cancellation cleanup apply to every attempt. There are no
fractional per-attempt budgets. One stalled request can consume an entire pass;
callers must defer and reacquire the lease for each worker retry so the durable
claim count advances. Repeated reconciliation of the same immutable snapshot does
not advance traversal and is not retry progress. With a fixed saved list, successive
claims rotate through every starting position without a persisted cursor, schema
change or API option. Escalate persistent unavailability, never infer revocation or
completion. Current staged Safety recovery already reacquires the lease per retry;
this SDK change does not modify or activate that consumer.

In `confirmed`, only the attempt matching the saved receipt's `submissionDigest`
is rechecked, even when it is historical. The transaction hash, block hash and
block number must still match exactly. Confirmation depth may increase or decrease
provided all gateway and reserved minimum checks pass. Reorg/insufficient-depth
pending responses do not mutate the journal or permit publication. The reconciler
does not replace a confirmed receipt or fall back to a different attempt.

It does not refresh or re-sign attempts, independently verify RPC evidence, or act
as a provider coordinator. Its options allow an injected `fetch` and an
`AbortSignal`. It snapshots and validates the entire record before any transport.

Results are `confirmed` with a `RecoveryReceipt`, `revoked`, `pending`, or
`unavailable`. Only the configured request-specific gateway is trusted for this
evidence; generic status reads and transaction hashes alone are not sufficient.
Transport, malformed-evidence and validation failures remain `unavailable`.
The provider still owns scheduling, fresh authorization and atomic publication.

## Append-Only Attempts

`RecoveryRecord.submission` is the latest saved attempt. Optional
`previousSubmissions` contains all earlier signed attempts in oldest-first append
order. Legacy candidate records with no history remain accepted; an empty history
is also accepted when a latest submission exists. This is a candidate-only, new
provider journal that has never been deployed, not a production-data migration.

Use the existing store `transition` method with
`{ kind: 'resubmit', submission: newSignedAttempt }` only from `submitted`, under
the current lease token and revision. The original `submit` still only accepts
`prepared`. Resubmission appends the previous latest operation and signature
without changing their bytes, then saves an isolated copy of the new attempt.
The phase remains `submitted`; claim/retry `attempts` is not a submission count.
Preparation (commitment and encrypted envelope), the entire reserved input,
issuer/key epoch, holder, request, chain and ledger domain remain unchanged.
Only nonce, deadline and signature can meaningfully change; address case is
compared semantically but preserved in the saved bytes.

The new signature must have valid syntax and a deadline strictly after the
database-sampled transition time. Every saved attempt is validated against the
same immutable context. Repeating an operation already in latest/history is
rejected with `issuance_recovery_submission_duplicate`, even with a different
signature or holder address hex case. A deadline-only replacement or nonce change
is supported. `confirm` accepts a receipt bound to **one exact saved submission
digest**, not necessarily the latest. The digest covers the operation and original
signature spelling; substituting or normalizing bytes does not match that receipt.

The SDK does not establish that an old attempt is unmined, expired on the canonical
chain, or nonce-conflicted. Wall-clock expiry only rejects an expired *new*
signature; it does not retire historical attempts or release their nonces. The
provider must recheck policy before signing, sign for the reserved domain, commit
the new attempt before broadcasting, and coordinate issuer nonces separately.
Signature syntax/context validation here is not cryptographic signer verification;
exact inclusion evidence remains the configured gateway's responsibility.
No nonce-lane activation or cancellation protocol is introduced. Safe lane
cancellation requires canonical expired-unmined proof or an equivalent safe
protocol, not this journal transition. Safety remains staged disabled.

## History Limit

At most **32 total signed attempts** are accepted: latest plus up to 31 previous
submissions. A 33rd `resubmit` throws `issuance_recovery_submission_limit` without
writing, dropping signatures, changing phase or marking anything revoked. Oversize,
malformed, duplicate and context-mismatched persisted histories fail validation.

On the limit error, roll back the failed provider transaction, keep the request
pending, and flag manual intervention. Further resubmission must stop; reconciliation
of all saved attempts and exact receipt confirmation/completion remain supported.
Providers can use the existing `receipt_pending` defer/backoff transition in a fresh
owned transaction. Do not reset the journal or silently prune attempts to bypass
the limit. Missing evidence and policy suspension are not revocation evidence.

A separate append-only attempt table with bounded, resumable reconciliation pages
could avoid a hard lifetime cap. It would require additional storage ownership,
cursor and atomicity contracts. For this never-deployed candidate, the
explicit cap and manual escalation keep the contract smaller without discarding
evidence; pagination or concurrent reconciliation are not implemented here.

## Acceptance Boundary

This change adds append-only attempts, historical receipt binding and bounded
multi-attempt reconciliation while retaining lease fencing, retry backoff and
transaction ownership. Build, API Extractor, typechecks and offline regression
tests validate the package candidate, not a deployed Safety consumer or real
PostgreSQL/RPC acceptance. Consumer integration,
crash/restart and policy-race coverage, durable scheduling, shared nonce/signed
attempt coordination and native-wallet recovery remain separate acceptance work.
See [recoverable admission](/concepts/issuer-request-admission) for the broader gates.
