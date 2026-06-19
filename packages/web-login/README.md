# @union-networks/web-login

High-level browser helpers for Sign in with U-net.

Use this package when a website wants to show a one-time U-net QR code and receive a service-scoped identity after the user approves in the U-net mobile app.

## Install

```bash
npm install @union-networks/web-login@alpha
```

## What This Package Does

- Creates a web-login session with U-net trust-plane.
- Produces the QR payload for the mobile app to scan.
- Polls the session until the user approves, denies, or the QR expires.
- Exposes a small helper to detect approved results.

It does not verify the login assertion on your server. Use `@union-networks/server` for that.

## Basic Usage

```ts
import {
  createLoginSession,
  isApprovedLoginResult,
  pollLoginSession,
  renderLoginQrPayload,
} from '@union-networks/web-login';

const session = await createLoginSession(
  {
    serviceId: 'demo-supermarket',
    origin: window.location.origin,
    expiresInSeconds: 120,
  },
  { issuerBaseUrl: 'https://issuer.egress.live' },
);

const qrPayload = renderLoginQrPayload(session);

const result = await pollLoginSession(session.sessionId, {
  issuerBaseUrl: 'https://issuer.egress.live',
  intervalMs: 1500,
  timeoutMs: 120000,
});

if (isApprovedLoginResult(result)) {
  await fetch('/api/unet/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assertionJws: result.assertionJws }),
  });
}
```

## API

### `createLoginSession(input, options?)`

Creates a one-time QR login session.

`input`:

- `serviceId`: registered U-net service ID.
- `origin`: browser origin making the request. This must match the registered service origin.
- `expiresInSeconds`: optional QR lifetime.

`options`:

- `issuerBaseUrl`: trust-plane issuer endpoint. Defaults to the public demo issuer URL.
- `fetchImpl`: optional custom fetch implementation.

### `pollLoginSession(sessionId, options?)`

Polls until the session is no longer `pending`.

Possible terminal statuses are `approved`, `denied`, and `expired`.

### `renderLoginQrPayload(session)`

Returns a `unet://web-login?...` payload. Use this when you render your own QR code.

If `session.qrDataUrl` is present, you can also render that directly as an image.

### `isApprovedLoginResult(result)`

Returns `true` when the result has `status === 'approved'`, a `scopedUserId`, and an `assertionJws`.

## Response Shape

An approved login session includes:

```ts
{
  sessionId: string;
  requestRef: string;
  serviceId: string;
  origin: string;
  status: 'approved';
  scopedUserId: string;
  assertionJws: string;
  expiresAt: string;
}
```

The `scopedUserId` is the account identifier your service should store. It is stable for your service and different for other services.

## Security Notes

- Do not trust `scopedUserId` directly from browser JavaScript.
- Send `assertionJws` to your backend and verify it with `@union-networks/server`.
- Never ask for or store a public U-net ID to implement login.
- Handle `denied` and `expired` as normal user outcomes, not server errors.


## Miniapp Service Sessions

When the same web app is opened inside U-net as a miniapp, do not show a QR code. Use the native host bridge action `host.createServiceSession` to receive the same kind of `assertionJws` that QR login returns.

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

const miniappSession = await callUnetHost<{ scopedUserId: string; assertionJws: string }>(
  'host.createServiceSession',
);

await fetch('/api/unet/session', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ assertionJws: miniappSession.assertionJws }),
});
```

Your server verifies this assertion with `@union-networks/server`, the same as browser QR login.

## Service Registration Checks

Use `resolveWebLoginService` when you need to confirm that U-net knows a `serviceId + origin`, for example before showing setup status in a developer dashboard.

```ts
import { resolveWebLoginService } from '@union-networks/web-login';

const service = await resolveWebLoginService({
  serviceId: 'demo-shop',
  origin: 'https://shop.example',
});
```

Normal application login code usually does not need this call; `createLoginSession` will fail with a typed API error if the origin is not registered or verified.

## Browser And Miniapp Pattern

Most apps should implement this shape:

```ts
async function signInWithUnet() {
  if (window.ReactNativeWebView) {
    return callUnetHost('host.createServiceSession');
  }

  const session = await createLoginSession({
    serviceId: 'demo-shop',
    origin: window.location.origin,
  });

  renderQr(renderLoginQrPayload(session));
  return pollLoginSession(session.sessionId);
}
```

That gives one web app that works both as a normal website and as a U-net miniapp.
