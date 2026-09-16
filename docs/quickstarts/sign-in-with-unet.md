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
  ensureDirectLoginSchema,
} from '@u-net/server';
import { db, createProviderSessionResponse } from './provider-session.js';

const serviceId = process.env.UNET_PROVIDER_SERVICE_ID!;
const origin = process.env.UNET_PROVIDER_ORIGIN!;
await ensureDirectLoginSchema(db);
const accountStore = new PostgresDirectLoginAccountStore(db);
const service = createDirectLoginService({
  serviceId,
  origin,
  challengeStore: new PostgresDirectLoginChallengeStore(db),
  accountStore,
});

export const login = createDirectLoginWebHandlers({
  serviceId, origin, service, accountStore,
  exchange: (session) => createProviderSessionResponse(session),
});
```

`provider-session.js` is your application code: `db` must be a PostgreSQL pool with `connect()`. `createProviderSessionResponse` persists your provider session and returns a `Response` with `{ "success": true }` and a Secure, HTTP-only session cookie. Do not return `sessionId` or scoped identifiers in that response. The callback runs after one-time consumption; failure requires a fresh login.

Mount `challenge`, `challengeDetails`, `approve`, `challengeStatus`, `exchange`, and `retire` at the matching same-origin paths published in `/.well-known/unet-service.json`. Preserve request cookies, the exact HTTPS Origin, JSON content type, and response Set-Cookie headers through your framework or proxy.

## Browser

```ts
import {
  createDirectProviderLogin,
  exchangeDirectProviderLogin,
  renderDirectLoginQrPayload,
  waitForDirectProviderLogin,
} from '@u-net/web-login';

const challenge = await createDirectProviderLogin(window.location.origin);
showQr(renderDirectLoginQrPayload(challenge));
const result = await waitForDirectProviderLogin(window.location.origin, challenge.requestRef);

if (result.state === 'approved') {
  const exchanged = await exchangeDirectProviderLogin(window.location.origin, challenge.requestRef);
  if (!exchanged.success) throw new Error('direct_login_exchange_failed');
  window.location.assign('/account');
}
```

The provider exchanges approval for its own HTTP-only session. The browser never receives a reusable U-net assertion or a global holder identity.

Status exposes lifecycle state only. Exchange accepts `{ requestRef }` and the originating browser's per-attempt cookie, never a session ID. See the [SDK 2 migration](../migration/security-2.md) for retirement workers, session invalidation, and coordinated deployment requirements.
