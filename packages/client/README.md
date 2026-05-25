# @union-networks/client

Framework-neutral low-level client for U-net public APIs.

Most applications should use `@union-networks/web-login`, `@union-networks/verification`, or `@union-networks/react`. Use this package directly when you want one client instance, custom fetch behavior, low-level API access, or shared error classes.

## Install

```bash
npm install @union-networks/client@alpha
```

## Create A Client

```ts
import { createUnetClient } from '@union-networks/client';

const unet = createUnetClient({
  issuerBaseUrl: 'https://issuer.egress.live',
  verifierBaseUrl: 'https://verifier.egress.live',
});
```

## Web Login

```ts
const session = await unet.createLoginSession({
  serviceId: 'demo-supermarket',
  origin: window.location.origin,
  expiresInSeconds: 120,
});

const result = await unet.getLoginSession(session.sessionId);
```

For polling and nicer helpers, use `@union-networks/web-login`.

## Verification

```ts
const checks = await unet.listVerificationChecks({ query: 'age', limit: 20 });

const session = await unet.createVerificationSession({
  verifierId: 'shop.example',
  verifierDisplayName: 'Example Shop',
  requestedChecks: [{ requestType: 'age_over_18' }],
});

const status = await unet.getVerificationSession(session.sessionId);
```

## Pagination

```ts
for await (const check of unet.iterateVerificationChecks({ limit: 50 })) {
  console.log(check.requestType);
}
```

## Custom Fetch

```ts
const unet = createUnetClient({
  fetchImpl: async (input, init) => {
    console.log(input);
    return fetch(input, init);
  },
});
```

## Errors

```ts
import {
  UnetApiError,
  UnetContractError,
  UnetTimeoutError,
} from '@union-networks/client';
```

- `UnetApiError`: non-2xx response from U-net.
- `UnetContractError`: response did not match the SDK contract.
- `UnetTimeoutError`: polling aborted or timed out.

## Utilities

```ts
import { parseUnetQrPayload, verificationQrPayload } from '@union-networks/client';

const qr = verificationQrPayload('session_ref_here');
const parsed = parseUnetQrPayload(qr);
```
