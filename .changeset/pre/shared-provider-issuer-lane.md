---
"@u-net/issuer": minor
---

Stage the transactional provider-owned issuer operation lane and exact target/
expiry evidence helpers for the coordinated SDK 2 release-candidate train.
Public and private credential writers share chain, ledger contract and issuer
authority ownership, immutable operation records and replay-safe confirmation.
The lane accepts only predefined storage configurations, including the existing
Safety Center table identities. Declare the pinned ethers dependency explicitly.

This is a candidate API, not production activation or stable-release approval.
Providers must verify database-locking and chain-confirmation acceptance before
switching their existing writer paths. The extraction does not migrate or erase
persisted provider operation history.
