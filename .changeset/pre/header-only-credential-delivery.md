---
"@u-net/issuer": patch
---

Security fix for the SDK 2 release-candidate delivery contract: credential
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
