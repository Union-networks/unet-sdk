# Make Your Web App Miniapp-Ready

A U-net miniapp can be the same web app you already run in the browser. The app opens inside the U-net WebView shell, receives a scoped identity through the native bridge, and can fall back to QR login when opened in a normal browser.

Unlisted miniapps are meant for development and partner testing. They do not appear in the official app catalog, and in v1 they can request only `identity.scoped`. Notifications, official-account messaging, and other privileged features require catalog review later.

## 1. Register Your Service

Ask U-net to register a service record with:

- `serviceId`, such as `example-shop`
- allowed HTTPS origin, such as `https://shop.example.com`
- display name, provider, icon, and allowed scopes

The origin in the registration must exactly match the origin that serves your app and manifest.

## 2. Serve A Miniapp Manifest

Serve this file from the same origin as your app:

```text
https://shop.example.com/.well-known/unet-miniapp.json
```

Example:

```json
{
  "serviceId": "example-shop",
  "name": "Example Shop",
  "provider": "Example Inc",
  "description": "Shop with a U-net scoped identity.",
  "icon": "basket-outline",
  "launchUrl": "https://shop.example.com/app",
  "permissions": ["identity.scoped"]
}
```

Rules for unlisted miniapps:

- `launchUrl` must use HTTPS.
- `launchUrl` must be on the same origin as the entered URL.
- `serviceId + origin` must resolve to an active registered U-net service.
- `permissions` must be limited to `identity.scoped` for now.

## 3. Login Inside U-net

When your app runs inside U-net, call the host bridge action `host.createServiceSession`. U-net derives the service-scoped ID locally, signs a holder proof, and returns a short-lived login assertion. Your page never sees the public U-net ID, holder ID, FCM token, or private keys.

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
await fetch('/api/session', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ assertionJws: session.assertionJws })
});
```

On your server, verify `assertionJws` with `@union-networks/server` before creating the web session.

## 4. Fall Back To QR Login In Browsers

If `window.ReactNativeWebView` is missing, use normal QR login from `@union-networks/web-login`:

```ts
import { createLoginSession, pollLoginSession, renderLoginQrPayload } from '@union-networks/web-login';

const login = await createLoginSession({
  serviceId: 'example-shop',
  origin: window.location.origin,
  expiresInSeconds: 120
});

renderQr(renderLoginQrPayload(login));
const approved = await pollLoginSession(login.sessionId);
```

## 5. Open During Development

In U-net mobile, go to Apps, tap **Open by URL**, and enter any HTTPS URL on your app origin. U-net fetches the manifest, checks the trust-plane service registration, asks for consent, then opens the app in the normal miniapp shell.
