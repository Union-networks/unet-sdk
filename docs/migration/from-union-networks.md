# Migrate to `@u-net`

U-net 1.0 moves every public package from `@union-networks/*` to `@u-net/*` and makes Sovereign Core V2 the only supported protocol surface.

## Change the namespace

Replace each dependency and import directly:

```diff
- import { createDirectLoginService } from '@union-networks/server';
+ import { createDirectLoginService } from '@u-net/server';
```

All eight packages use the same ecosystem version. During the release-candidate period, install with the `next` tag:

```bash
npm install @u-net/server@next @u-net/client@next
```

## Remove V1 login

Delete calls to central login-session and signed-assertion APIs. Host Direct Login V2 challenge, approval, status, exchange, and retirement handlers in the provider application with `@u-net/server`.

## Move issuer state

Issuer applications, encrypted delivery envelopes, acknowledgements, renewals, and replacements belong in provider infrastructure. Use `@u-net/issuer` for provider-owned storage and Ledger V2 operations.

The deprecated old-scope compatibility release changes package resolution only. It does not restore V1 APIs.
