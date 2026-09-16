# Make a web app miniapp-ready

A U-net miniapp is a same-origin web app with a public manifest. Catalog listing controls discovery, not whether a verified unlisted service can use Direct Login V2.

## Browser login

```ts
import { createDirectProviderLogin, exchangeDirectProviderLogin, renderDirectLoginQrPayload, waitForDirectProviderLogin } from '@u-net/web-login';

const challenge = await createDirectProviderLogin(window.location.origin);
renderQr(renderDirectLoginQrPayload(challenge));
const result = await waitForDirectProviderLogin(window.location.origin, challenge.requestRef);
if (result.state === 'approved') {
  const exchanged = await exchangeDirectProviderLogin(window.location.origin, challenge.requestRef);
  if (!exchanged.success) throw new Error('direct_login_exchange_failed');
}
```

## Well-known routes

Serve both manifests from the verified HTTPS origin:

- `/.well-known/unet-service.json` describes account policy and Direct Login routes.
- `/.well-known/unet-miniapp.json` describes launch URL and requested host permissions.

Generate them with `createUnetServiceManifest` and `createUnetMiniappManifest` from `@u-net/server`. Their service ID, origin, endpoint URLs, and account policy must match the dashboard registration.

## Miniapp login

The WebView must create the provider challenge using `createDirectProviderLogin` so its HTTP-only redemption cookie stays in the WebView. Pass only that public challenge to `host.createServiceSession`. The host validates and approves that exact reference with the selected local service-account key; it must not create a replacement challenge, poll private status, or exchange the browser session.

```ts
const bridge = window.ReactNativeWebView;
if (!bridge) throw new Error('miniapp_bridge_unavailable');
const challenge = await createDirectProviderLogin(window.location.origin);
const requestId = crypto.randomUUID();
bridge.postMessage(JSON.stringify({
  id: requestId,
  action: 'host.createServiceSession',
  payload: { challenge },
}));
const result = await waitForDirectProviderLogin(window.location.origin, challenge.requestRef);
if (result.state === 'approved') {
  const exchanged = await exchangeDirectProviderLogin(window.location.origin, challenge.requestRef);
  if (!exchanged.success) throw new Error('direct_login_exchange_failed');
}
```

The bridge must support this SDK 2 contract before rollout. Native approval alone is not browser login success. Never send cookies or redemption secrets through the bridge. See the [security migration](../migration/security-2.md).

Permissionless miniapps may publish `permissions: []`. They receive no scoped identity and all identity or attestation bridge calls are rejected.

## Checklist

- Use one verified HTTPS origin.
- Keep claim tokens and session secrets server-only.
- Store challenges, accounts, replay records, and sessions in the provider database.
- Keep the browser and miniapp on the same Direct Login implementation.
- Run the dashboard readiness checks before publishing.
