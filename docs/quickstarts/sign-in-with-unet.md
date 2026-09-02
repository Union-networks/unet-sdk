# Sign in with U-net

Direct Login V2 is provider-hosted. Your service owns its challenges, scoped profiles, replay protection, and HTTP-only sessions.

## Server

Install `@u-net/server`, create the Direct Login service with provider-owned Postgres stores, and expose the standard handlers:

```ts
import {
  PostgresDirectLoginAccountStore,
  PostgresDirectLoginChallengeStore,
  createDirectLoginService,
  createDirectLoginWebHandlers,
} from '@u-net/server';

const service = createDirectLoginService({
  serviceId: process.env.UNET_PROVIDER_SERVICE_ID!,
  origin: process.env.UNET_PROVIDER_ORIGIN!,
  challengeStore: new PostgresDirectLoginChallengeStore(db),
  accountStore: new PostgresDirectLoginAccountStore(db),
});

export const login = createDirectLoginWebHandlers({ service });
```

Mount `challenge`, `approval`, `status`, `exchange`, and `retirement` at the same-origin paths published in `/.well-known/unet-service.json`.

## Browser

```ts
import {
  createDirectProviderLogin,
  renderDirectLoginQrPayload,
  waitForDirectProviderLogin,
} from '@u-net/web-login';

const challenge = await createDirectProviderLogin(window.location.origin);
showQr(renderDirectLoginQrPayload(challenge));
const result = await waitForDirectProviderLogin(window.location.origin, challenge.requestRef);

if (result.state === 'approved') window.location.assign('/account');
```

The provider exchanges approval for its own HTTP-only session. The browser never receives a reusable U-net assertion or a global holder identity.
