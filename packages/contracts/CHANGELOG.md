# Changelog

## 2.0.0-rc.5

### Patch Changes

- Add the manual Verification V2 sidecar with public immutable challenges,
  header-only private result polling, native predicate and signed expiry proof
  submissions, and independently bound historical Ed25519 result receipts.
  No holder registration, holder JWS, issuer keys, or proof backend is added to
  browser packages. Existing V1 helpers remain explicit legacy interfaces.

  Preserve only fully validated, session-bound retryable unavailable responses.
  Align fixed error codes, eight-check limits, route and proof bounds, canonical
  timestamps and nonces, receipt outcome consistency, and strict key metadata with
  the trust-plane sidecar. Update contracts, API reports, and migration guidance.

  This fixed RC train is for coordinated integration. Stable promotion, deployment,
  publication, and physical-device acceptance remain separate gates.

## 2.0.0-rc.4

## 2.0.0-rc.3

### Minor Changes

- 3e3ca90: Describe the Ledger V2 read-only anchor reconciliation endpoint and generate its
  request/response types. Reconciliation checks the original signed operation
  against canonical transaction evidence and exact credential status; the chain
  index supplies only a candidate transaction, not proof of successful anchoring.

  The endpoint does not submit transactions or authorize credential delivery.
  Provider recovery still requires durable request processing, fresh policy checks,
  and atomic publication. This contract addition does not activate those flows or
  approve a production cutover. The private issuer recovery adapter is not exported.

## 2.0.0-rc.2

## 2.0.0-rc.1

## 2.0.0-rc.0

## 1.0.0

### Major Changes

- 5489e6a: Publish the Sovereign Core V2-only U-net SDK under the permanent `@u-net` namespace.

## 1.0.0-rc.2

- Published the Apache-2.0 release candidate through npm Trusted Publishing with provenance.

## 1.0.0-rc.1

- Published under the permanent `@u-net` namespace.
- Adopted the Sovereign Core V2 public API.
- Removed central V1 relationship APIs.
