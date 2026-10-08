# Changelog

## 2.0.0-rc.3

### Major Changes

- daeabb2: Require wallet-owned delivery capability hashes and authenticated provider
  accounts for direct issuance admission. Identical retries return the same
  opaque request reference without returning a bearer. Serialize admission and
  renewal with transactional request-store methods and reject conflicting intent
  or unfinished replacement delivery. Coordinate this breaking SDK 2 change with
  native pending-intent storage and provider recovery integration before rollout.

### Minor Changes

- b336237: Stage the transactional provider-owned issuer operation lane and exact target/
  expiry evidence helpers for the coordinated SDK 2 release-candidate train.
  Public and private credential writers share chain, ledger contract and issuer
  authority ownership, immutable operation records and replay-safe confirmation.
  The lane accepts only predefined storage configurations, including the existing
  Safety Center table identities. Declare the pinned ethers dependency explicitly.

  This is a candidate API, not production activation or stable-release approval.
  Providers must verify database-locking and chain-confirmation acceptance before
  switching their existing writer paths. The extraction does not migrate or erase
  persisted provider operation history.
- f39ef49: Stage the core issuance recovery API for the coordinated SDK 2 release-candidate
  train only, not as an approved stable API. Export schema initialization, pooled
  and transaction-bound recovery stores, gateway reconciliation, their recovery
  contracts and named reconciliation options/result, and IssuanceRecoverySqlPool.

  This promotion lets Safety and other providers consume the built, packaged
  @u-net/issuer module instead of local private source imports. Kernel mutation,
  validation and digest helpers remain private. Recovery semantics are unchanged;
  this is core recovery, not an experimental standards prototype.

  Providers must compose policy/account locks, requests, journal and publication
  on one owned, pinned transaction. This staging does not publish or deploy any
  package, approve stable release, or establish completed provider integration.

### Patch Changes

- 3626690: Extend the coordinated SDK 2 RC-only beta recovery journal with append-only signed
  anchor attempts. Add a lease-fenced `resubmit` action from `submitted`, preserve all
  previous signed bytes and immutable context, reject duplicate operations, and bind
  receipts to any exact saved attempt. Limit history to 32 total attempts, failing
  closed with pending/manual intervention instead of dropping evidence.

  Reconcile saved attempts under one total 10-second transport budget with unchanged
  strict gateway validation. Rotate unconfirmed traversal by durable claim count so
  successive lease claims give older attempts fair starting positions; repeated use
  of the same snapshot does not advance traversal. Confirmed rechecks use only the receipt-bound attempt
  and preserve transaction/block binding while allowing confirmation depth changes.
  This is a never-deployed provider-journal candidate, not a production migration,
  nonce cancellation mechanism, publication approval or Safety/ledger/mobile change.
- 9f97630: Security fix for the SDK 2 release-candidate domain-admin callback contract:
  reject callback protocol version 1 with `protocol_upgrade_required` and require
  signed V2 control authorization for issuance. The maintained provider routes map
  the protocol-upgrade rejection to HTTP 426. The general callback implementation
  no longer accepts HMAC authorization, even when its legacy secret option is
  supplied. Existing helper exports are preserved; they are not a callback
  authentication fallback.

  `consumeControlNonce` is required at runtime as well as by the V2 adapter type.
  Providers must implement atomic, durable nonce consumption shared across
  replicas and retained across restarts. Missing nonce consumption, invalid
  authorization and replay fail closed before credential issuance. This also
  rejects malformed expiry/timestamps, duplicate authorization/challenge headers,
  and missing V2 holder-revocation context.

  This is an intentional security-related behavior break for legacy callback
  callers. The credential schema ID `unet.provider.domain-admin.v1` is unchanged;
  its suffix is not the callback protocol version. No existing credential is
  changed, revoked or reissued by this patch.

  Providers pinned to `@u-net/issuer@2.0.0-rc.2` must upgrade to a released package
  containing this fix and verify their installed/bundled version. Unpublished SDK
  source changes do not update those installations. Maintained Safety and
  Supermarket route guards independently reject protocol v1 and HMAC callbacks
  while using the installed RC2 dependency; they do not replace the SDK upgrade.

  See `docs/concepts/domain-admin-callback-security.md` for migration requirements,
  exact local test commands and fixture-versus-runtime coverage limits. No package
  publication, deployment, nonce-store migration or production operation is
  performed by this changeset.
- 4060424: Security fix for the SDK 2 release-candidate delivery contract: credential
  delivery now requires `Authorization: Bearer <deliveryCapability>`. Keep only the
  opaque `requestId` in the URL. This is a breaking transport change for legacy
  query-capability clients: any `deliveryCapability` query parameter is rejected,
  including an empty parameter or one accompanied by a valid header. No query
  fallback remains. Public exports and successful delivery payloads are unchanged.

  Issuer web adapters expose only exact known service/adapter error codes. Unknown
  store/provider exceptions return a generic no-store 503 without exception text.

  This prevents new capability-bearing URLs from updated clients; it does not
  sanitize historical URLs or invalidate previously exposed capabilities. Existing
  capabilities also authorize acknowledgement and revocation fallback. Historical
  exposure remains an open coordinated recovery gate; this release change performs
  no capability rotation, credential reset, or production operation.
- d6cc170: Preserve provider policy and publication hooks in pinned PostgreSQL account
  transactions. Validate the bound-store factory and close escaped SQL clients.
  Freeze schema selection in private issuance recovery records.
- @u-net/client@2.0.0-rc.3

## 2.0.0-rc.2

### Patch Changes

- @u-net/client@2.0.0-rc.2

## 2.0.0-rc.1

### Patch Changes

- @u-net/client@2.0.0-rc.1

## 2.0.0-rc.0

### Patch Changes

- @u-net/client@2.0.0-rc.0

## 1.0.0

### Major Changes

- 5489e6a: Publish the Sovereign Core V2-only U-net SDK under the permanent `@u-net` namespace.

### Patch Changes

- Updated dependencies [5489e6a]
  - @u-net/client@1.0.0

## 1.0.0-rc.2

- Published the Apache-2.0 release candidate through npm Trusted Publishing with provenance.

## 1.0.0-rc.1

- Published under the permanent `@u-net` namespace.
- Adopted the Sovereign Core V2 public API.
- Removed central V1 relationship APIs.
