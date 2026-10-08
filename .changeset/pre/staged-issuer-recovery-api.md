---
"@u-net/issuer": minor
---

Stage the core issuance recovery API for the coordinated SDK 2 release-candidate
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
