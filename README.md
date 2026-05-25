# U-net SDK

Developer-facing TypeScript and React packages for integrating U-net web login and attestation verification.

## Packages

- `@union-networks/contracts`: generated TypeScript types from the public OpenAPI snapshot.
- `@union-networks/client`: framework-neutral HTTP client, polling helpers, QR helpers, and shared errors.
- `@union-networks/web-login`: high-level Sign in with U-net helpers.
- `@union-networks/verification`: high-level verification and checkout-bound verification helpers.
- `@union-networks/react`: React hooks and QR/status components.
- `@union-networks/server`: Node helpers for verifying signed login assertions.

## Quickstart

```ts
import { createLoginSession, pollLoginSession } from '@union-networks/web-login';

const session = await createLoginSession({
  serviceId: 'demo-supermarket',
  origin: window.location.origin,
});

const result = await pollLoginSession(session.sessionId);
```

The SDK is alpha software. Public contracts are snapshotted under `contracts/openapi/` and generated with `pnpm contracts:generate`.
