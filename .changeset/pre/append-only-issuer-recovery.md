---
"@u-net/issuer": patch
---

Extend the coordinated SDK 2 RC-only beta recovery journal with append-only signed
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
