# @u-net/issuer

Node-only provider SDK for direct credential requests, encrypted delivery, renewal, replacement, and provider-signed Ledger V2 operations.

```bash
npm install @u-net/issuer@next
```

```ts
import { createDirectIssuerService, PostgresDirectIssuerRequestStore } from '@u-net/issuer';
```

See [docs.egress.live](https://docs.egress.live) for guides and the versioned API reference.

## Domain-Admin Callback Security

Domain-admin issuance callbacks require protocol version 2, signed V2 control
authorization and a durable, atomic `consumeControlNonce` callback. Protocol v1
and HMAC callback authorization are rejected; existing helper exports remain.
The credential schema ID `unet.provider.domain-admin.v1` is unchanged and must
not be rewritten to match the callback protocol number.

Providers installed on `2.0.0-rc.2` need a released SDK upgrade containing this
fix; editing SDK source alone does not update installed dependencies. Maintained
provider route guards provide separate protection against legacy callbacks.
See the [behavior and migration note](../../docs/concepts/domain-admin-callback-security.md)
for required nonce-store semantics, test commands and coverage boundaries.
