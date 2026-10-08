# Direct Login proofs

Sovereign Core V2 does not issue central login assertions.

The provider creates a short-lived challenge. The wallet submits a scoped ID, the matching service-account public key, and a signature directly to that provider. First login binds the account key; later logins must prove the same key. Challenges are same-origin, expiring, and single-use.

In the intended provider-hosted flow, the control plane resolves public service
metadata and the provider receives the scoped account and approval. The current
dashboard still has a proxy-backed implementation with shared infrastructure;
do not interpret this architecture as a universal claim that U-net infrastructure
cannot observe relationship data. Dashboard storage extraction remains follow-up
work. See [security and privacy boundaries](./security-threat-model).

The [unreleased Security 2 SDK](../migration/security-2) separates public challenge
data from browser redemption using an HTTP-only per-attempt cookie and S256
binding. Providers and mobile bridges must migrate together. This uses the
binding technique described by [PKCE](https://www.rfc-editor.org/rfc/rfc7636),
but is not itself an OAuth/OIDC implementation.
