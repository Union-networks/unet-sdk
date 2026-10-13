---
"@u-net/client": patch
"@u-net/contracts": patch
"@u-net/verification": patch
---

Add the manual Verification V2 sidecar with public immutable challenges,
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
