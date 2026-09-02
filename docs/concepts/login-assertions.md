# Direct Login proofs

Sovereign Core V2 does not issue central login assertions.

The provider creates a short-lived challenge. The wallet submits a scoped ID, the matching service-account public key, and a signature directly to that provider. First login binds the account key; later logins must prove the same key. Challenges are same-origin, expiring, and single-use.

The control plane is used only to resolve signed public service metadata before the wallet contacts the provider. It never receives the scoped ID, account key, challenge approval, or provider session.
