# `@u-net/issuer`

Provider-owned issuance, encrypted delivery, renewal, replacement, and Ledger V2 signing.

```bash
npm install @u-net/issuer
```

[Open the generated API reference](/api/generated/@u-net/issuer/README)

Core issuance recovery stores, reconciliation and their types are a staged,
coordinated SDK 2 RC-only public API candidate, not approved stable. Providers
consume the built, packaged module rather than private source imports. See the
[recovery API and transaction ownership contract](../concepts/issuer-recovery-api.md).

Credential delivery requires a Bearer authorization header; query capabilities
are rejected even when a valid header is also present. See the
[breaking transport contract and open historical-exposure gate](../concepts/delivery-capability-transport.md).
