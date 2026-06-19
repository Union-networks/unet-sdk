# @union-networks/server

Server-side helpers for U-net web integrations.

Use this package in your backend. It verifies login assertions, creates domain-control proof responses, and generates miniapp manifests without exposing provider secrets to browser JavaScript.

## Install

```bash
npm install @union-networks/server@alpha
```

## What Belongs On The Server

Keep these values in server-only environment variables:

- `UNET_WEB_LOGIN_ASSERTION_SECRET`: shared assertion-verification secret for your U-net environment.
- `UNET_PROVIDER_CLAIM_ID`: claim ID from the U-net dashboard.
- `UNET_PROVIDER_CLAIM_CHALLENGE`: challenge from the U-net dashboard.
- `UNET_PROVIDER_CLAIM_TOKEN`: one-time domain-claim token from the U-net dashboard.

Do not expose the claim token in frontend bundles, public config, analytics, logs, or HTML.

## Verify Browser Login Assertions

After a browser QR login or miniapp service session, send `assertionJws` to your backend and verify it before creating a local session.

```ts
import { verifyLoginAssertion } from '@union-networks/server';

export async function POST(request: Request) {
  const { assertionJws } = await request.json();

  const claims = verifyLoginAssertion(assertionJws, {
    secret: process.env.UNET_WEB_LOGIN_ASSERTION_SECRET!,
    serviceId: 'demo-shop',
  });

  // Store/load your account by this scoped ID.
  // It is stable for your service and different for every other service.
  const scopedUserId = claims.scopedUserId!;

  return Response.json({ ok: true, scopedUserId });
}
```

`verifyLoginAssertion` checks:

- the JWS signature;
- the token expiry;
- the expected `serviceId`, when provided;
- required login fields such as `sessionId` and `scopedUserId`.

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

## Recommended Route Layout

```text
app/
  api/
    unet/
      session/route.ts
  .well-known/
    unet-provider-claim.json/route.ts
    unet-miniapp.json/route.ts
```

The `.well-known` routes let U-net verify and launch your origin. The API route verifies login assertions and creates your app session.

## Security Notes

- The claim token is a provider secret. Keep it server-side.
- Domain control is not legal identity verification. Show users your verified origin clearly.
- Always verify login assertions server-side before trusting `scopedUserId`.
- Store your local account by `scopedUserId`; never ask for a global U-net ID.
- Rotate a domain claim if a token is accidentally exposed.
