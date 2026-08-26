# @union-networks/server

`createDirectLoginService` implements U-net Direct Login Protocol V2. The provider creates and stores its own one-time challenge, binds a scoped account to its Ed25519 public key on first login, verifies every later challenge signature, and creates its own service session. `PostgresDirectLoginChallengeStore` and `PostgresDirectLoginAccountStore` provide durable adapters without placing U-net infrastructure on the login data path.

Server-side helpers for U-net web integrations. Providers own their Direct
Login V2 challenges, accounts, sessions, retirement handling, and official
inbox records; U-net is not on the login data path.

## Install

```bash
npm install @union-networks/server@alpha pg
```

## What Belongs On The Server

Keep these values in server-only environment variables:

- `UNET_PROVIDER_DATABASE_URL`: provider-owned Postgres connection string.
- `UNET_PROVIDER_SESSION_SECRET`: random provider session secret containing at least 32 characters.
- `UNET_PROVIDER_CLAIM_ID`: claim ID from the U-net dashboard.
- `UNET_PROVIDER_CLAIM_CHALLENGE`: challenge from the U-net dashboard.
- `UNET_PROVIDER_CLAIM_TOKEN`: one-time domain-claim token from the U-net dashboard.

Do not expose the claim token in frontend bundles, public config, analytics, logs, or HTML.

## Direct Login V2

Create a provider-owned login service with the durable Postgres adapters:

```ts
import { Pool } from 'pg';
import {
  PostgresDirectLoginAccountStore,
  PostgresDirectLoginChallengeStore,
  createDirectLoginService,
  createDirectLoginWebHandlers,
  ensureDirectLoginSchema,
} from '@union-networks/server';

const pool = new Pool({ connectionString: process.env.UNET_PROVIDER_DATABASE_URL });
await ensureDirectLoginSchema(pool);
const accountStore = new PostgresDirectLoginAccountStore(pool);
const service = createDirectLoginService({
  serviceId: 'demo-shop',
  origin: 'https://shop.example',
  accountStore,
  challengeStore: new PostgresDirectLoginChallengeStore(pool),
});

export const unetLogin = createDirectLoginWebHandlers({
  serviceId: 'demo-shop',
  origin: 'https://shop.example',
  service,
  accountStore,
  exchange: async (session) => {
    // Create your own HTTP-only provider session here.
    return { success: true, expiresAtIso: session.expiresAtIso };
  },
});
```

Mount the returned handlers at these canonical routes:

```text
POST /api/unet/login/challenge
GET  /api/unet/login/challenge?requestRef=...
POST /api/unet/login/approve
GET  /api/unet/login/status?requestRef=...
POST /api/unet/login/exchange
POST /api/unet/account/retire
```

Publish `/.well-known/unet-service.json` with
`createUnetServiceManifestHandler`. Browser login and
`host.createServiceSession` use the same provider-hosted challenge flow.
`verifyLoginAssertion` remains exported only for compatibility with legacy
V1 integrations.

## Expose A Domain-Control Claim

Domain verification proves that you control an HTTPS origin. In the U-net dashboard:

1. Log in with U-net.
2. Create a domain claim for your `serviceId` and origin.
3. Copy the claim ID, challenge, and token into server-only environment variables.
4. Deploy a `.well-known` route.
5. Press verify in the dashboard.

### Next.js App Router

Create `app/.well-known/unet-provider-claim.json/route.ts`:

```ts
import { createUnetProviderClaimHandler } from '@union-networks/server';

const getClaim = createUnetProviderClaimHandler({
  serviceId: 'demo-shop',
  origin: 'https://shop.example',
  claimId: process.env.UNET_PROVIDER_CLAIM_ID!,
  challenge: process.env.UNET_PROVIDER_CLAIM_CHALLENGE!,
  claimToken: process.env.UNET_PROVIDER_CLAIM_TOKEN!,
});

export function GET() {
  return Response.json(getClaim(), {
    headers: { 'cache-control': 'no-store' },
  });
}
```

The public response contains a proof derived from the claim token. It does not contain the raw token.

## Generate A Miniapp Manifest

To let U-net open the same web app as an unlisted miniapp, serve a manifest from:

```text
https://your-origin.example/.well-known/unet-miniapp.json
```

Next.js App Router example:

```ts
import { createUnetMiniappManifest } from '@union-networks/server';

export function GET() {
  return Response.json(
    createUnetMiniappManifest({
      serviceId: 'demo-shop',
      name: 'Demo Shop',
      provider: 'Demo Provider',
      origin: 'https://shop.example',
      launchUrl: 'https://shop.example/app',
      permissions: ['identity.scoped'],
      category: 'commerce',
      icon: 'https://shop.example/icon.png',
      domainClaim: {
        serviceId: 'demo-shop',
        origin: 'https://shop.example',
        claimId: process.env.UNET_PROVIDER_CLAIM_ID!,
        challenge: process.env.UNET_PROVIDER_CLAIM_CHALLENGE!,
        claimToken: process.env.UNET_PROVIDER_CLAIM_TOKEN!,
      },
    }),
    { headers: { 'cache-control': 'no-store' } },
  );
}
```

Rules enforced by the helper:

- `origin` is normalized.
- `launchUrl` must be HTTPS.
- `launchUrl` must be on the same origin.
- permissions default to `['identity.scoped']`.

For a permissionless read-only site, explicitly use `permissions: []`. Such a
site receives no scoped identity and cannot invoke identity or attestation
bridge actions. Login-capable unlisted services must also be domain-verified,
publish the Direct Login V2 service manifest, and pass dashboard readiness.

## Emit Official Messaging Automations

Create a scoped Messaging automation key on the domain Keys page, then install it only on your backend. The client resolves the published template, validates variables, renders and encrypts the recipient payload locally, and sends only ciphertext to U-net.

```ts
import { createUnetServerClient } from '@union-networks/server';

const unet = createUnetServerClient({
  issuerBaseUrl: 'https://issuer.egress.live',
  serviceId: 'demo-shop',
  automationKey: process.env.UNET_MESSAGING_AUTOMATION_KEY!,
});

await unet.officialMessaging.emitEvent({
  eventKey: 'order.approved',
  scopedUserId,
  eventId: approvalId,
  processId: orderId,
  variables: { approvedAt: new Date() },
});
```

`eventId` must be a random, stable idempotency identifier. `processId` is optional and is used to update one timeline card; it must be opaque and contain no customer data. Never place message text or sensitive data in push titles, event keys, IDs, or logs.

## Recommended Route Layout

```text
app/
  api/
    unet/
      login/challenge/route.ts
      login/approve/route.ts
      login/status/route.ts
      login/exchange/route.ts
      account/retire/route.ts
  .well-known/
    unet-provider-claim.json/route.ts
    unet-miniapp.json/route.ts
    unet-service.json/route.ts
```

The `.well-known` routes let U-net verify and launch your origin. The API route verifies login assertions and creates your app session.

## Security Notes

- The claim token is a provider secret. Keep it server-side.
- Domain control is not legal identity verification. Show users your verified origin clearly.
- Always verify the signed Direct Login challenge before trusting `scopedUserId`.
- Store your local account by `scopedUserId`; never ask for a global U-net ID.
- Rotate a domain claim if a token is accidentally exposed.
