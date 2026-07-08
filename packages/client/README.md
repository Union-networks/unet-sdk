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

## Service And Miniapp Helpers

```ts
const service = await unet.resolveWebLoginService({
  serviceId: 'demo-shop',
  origin: 'https://shop.example',
});

const serviceSession = await unet.createServiceSession({
  serviceId: 'demo-shop',
  origin: 'https://shop.example',
  scopedUserId: 'm_demo-shop_...',
  proofJws: 'holder-proof-from-unet-host',
});
```

Most browser apps should not call `createServiceSession` directly. Inside U-net, use the native bridge action `host.createServiceSession`; outside U-net, use QR login. This low-level method is exposed for tests, custom runtimes, and platform integrations.

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

Catalog methods accept `limit`, `cursor`, and `query` where supported:

```ts
const firstPage = await unet.listMiniPrograms({ query: 'shop', limit: 20 });
const nextPage = firstPage.pageInfo?.nextCursor
  ? await unet.listMiniPrograms({ cursor: firstPage.pageInfo.nextCursor, limit: 20 })
  : undefined;
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

## Production issuer default

The SDK defaults to `https://issuer.egress.live`. You only need to pass `issuerBaseUrl` when targeting a local or staging trust-plane. Keep `origin` explicit: in browser code this is usually `window.location.origin`, and on the server it should be your configured public deployment origin. An `origin_mismatch` means the registered U-net service/domain claim does not match the current site origin.
