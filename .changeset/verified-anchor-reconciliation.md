---
"@u-net/contracts": minor
---

Describe the Ledger V2 read-only anchor reconciliation endpoint and generate its
request/response types. Reconciliation checks the original signed operation
against canonical transaction evidence and exact credential status; the chain
index supplies only a candidate transaction, not proof of successful anchoring.

The endpoint does not submit transactions or authorize credential delivery.
Provider recovery still requires durable request processing, fresh policy checks,
and atomic publication. This contract addition does not activate those flows or
approve a production cutover. The private issuer recovery adapter is not exported.
