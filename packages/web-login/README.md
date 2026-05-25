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
