---
"@u-net/issuer": major
---

Require wallet-owned delivery capability hashes and authenticated provider
accounts for direct issuance admission. Identical retries return the same
opaque request reference without returning a bearer. Serialize admission and
renewal with transactional request-store methods and reject conflicting intent
or unfinished replacement delivery. Coordinate this breaking SDK 2 change with
native pending-intent storage and provider recovery integration before rollout.
