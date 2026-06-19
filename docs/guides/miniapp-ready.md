# Make Your Web App Miniapp-Ready

A U-net miniapp can be the same web app you already run in the browser. In a normal browser it uses QR login. Inside U-net it uses the native bridge to receive a scoped identity without showing a QR.

Unlisted miniapps are meant for development and self-serve integrations. They do not appear in the official app catalog. In v1, unlisted apps can request `identity.scoped`; catalog listing, official account messaging, notifications, and attestation-studio features require higher tiers and platform approval where applicable.

## Overview

1. Build normal browser login with `@union-networks/web-login`.
2. Verify login assertions on your server with `@union-networks/server`.
3. Create a domain claim in the U-net dashboard.
4. Serve a same-origin `.well-known` claim or manifest.
5. Open the URL in U-net with Apps -> Open by URL.
6. Inside U-net, call `host.createServiceSession` instead of showing a QR.

## 1. Build Browser QR Login

```ts
import { createLoginSession, pollLoginSession, renderLoginQrPayload } from '@union-networks/web-login';

const login = await createLoginSession({
  serviceId: 'example-shop',
  origin: window.location.origin,
  expiresInSeconds: 120,
});

renderQr(renderLoginQrPayload(login));
const approved = await pollLoginSession(login.sessionId);
```

Send `approved.assertionJws` to your backend and verify it with `@union-networks/server`.

## 2. Verify Your Domain

In the U-net dashboard, create a domain claim for:

- `serviceId`, such as `example-shop`;
- HTTPS origin, such as `https://shop.example.com`;
- manifest URL, usually `https://shop.example.com/.well-known/unet-miniapp.json`.

The dashboard returns a claim ID, challenge, and one-time claim token. Store those in server-only environment variables:

```bash
UNET_PROVIDER_CLAIM_ID=claim_...
UNET_PROVIDER_CLAIM_CHALLENGE=...
UNET_PROVIDER_CLAIM_TOKEN=...
```

The token must never be bundled into client-side JavaScript.

## 3. Serve A Claim Endpoint

```ts
import { createUnetProviderClaimHandler } from '@union-networks/server';

const getClaim = createUnetProviderClaimHandler({
  serviceId: 'example-shop',
  origin: 'https://shop.example.com',
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

Serve it at:

```text
https://shop.example.com/.well-known/unet-provider-claim.json
```

## 4. Serve A Miniapp Manifest

You can also embed the domain claim in the miniapp manifest:

```ts
import { createUnetMiniappManifest } from '@union-networks/server';

export function GET() {
  return Response.json(
    createUnetMiniappManifest({
      serviceId: 'example-shop',
      name: 'Example Shop',
      provider: 'Example',
      description: 'A web shop that supports U-net scoped login.',
      origin: 'https://shop.example.com',
      launchUrl: 'https://shop.example.com',
      icon: 'https://shop.example.com/icon.png',
      permissions: ['identity.scoped'],
      domainClaim: {
        serviceId: 'example-shop',
        origin: 'https://shop.example.com',
        claimId: process.env.UNET_PROVIDER_CLAIM_ID!,
        challenge: process.env.UNET_PROVIDER_CLAIM_CHALLENGE!,
        claimToken: process.env.UNET_PROVIDER_CLAIM_TOKEN!,
      },
    }),
    { headers: { 'cache-control': 'no-store' } },
  );
}
```

Serve it at:

```text
https://shop.example.com/.well-known/unet-miniapp.json
```

Rules:

- `launchUrl` must be HTTPS.
- `launchUrl` must be on the same origin as the entered URL.
- `serviceId + origin` must pass U-net domain verification.
- unlisted v1 permissions are limited to `identity.scoped`.

## 5. Login Inside U-net

When your app runs inside U-net, call the host bridge action `host.createServiceSession`.

```ts
type BridgeResponse<T> = { id: string; ok: boolean; result?: T; error?: string };

function callUnetHost<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const bridge = window.ReactNativeWebView;
  if (!bridge) throw new Error('not_running_inside_unet');

  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<BridgeResponse<T>>) => {
      if (event.data?.id !== id) return;
      window.removeEventListener('message', onMessage as EventListener);
      event.data.ok ? resolve(event.data.result as T) : reject(new Error(event.data.error ?? 'unet_bridge_failed'));
    };

    window.addEventListener('message', onMessage as EventListener);
    bridge.postMessage(JSON.stringify({ id, action, payload }));
  });
}

const session = await callUnetHost<{ scopedUserId: string; assertionJws: string }>('host.createServiceSession');

await fetch('/api/unet/session', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ assertionJws: session.assertionJws }),
});
```

Your server verifies `assertionJws` exactly like a browser QR login assertion.

## 6. Browser Fallback

If `window.ReactNativeWebView` is missing, show the normal QR login flow. The same app can therefore work as:

- a normal website;
- an unlisted U-net miniapp opened by URL;
- a catalog-listed miniapp after approval and tier activation.

## Development Checklist

- Your app is served over HTTPS.
- `serviceId` is stable and lowercase-friendly.
- `origin` exactly matches the deployed site origin.
- `.well-known/unet-miniapp.json` is reachable without authentication.
- claim token exists only in server environment variables.
- login assertions are verified on the server.
- local accounts are keyed by `scopedUserId`.
