# Make a web app miniapp-ready

A U-net miniapp is a same-origin web app with a public manifest. Catalog listing controls discovery, not whether a verified unlisted service can use Direct Login V2.

## Browser login

```ts
import { createDirectProviderLogin, renderDirectLoginQrPayload, waitForDirectProviderLogin } from '@u-net/web-login';

const challenge = await createDirectProviderLogin(window.location.origin);
renderQr(renderDirectLoginQrPayload(challenge));
const result = await waitForDirectProviderLogin(window.location.origin, challenge.requestRef);
```

## Well-known routes

Serve both manifests from the verified HTTPS origin:

- `/.well-known/unet-service.json` describes account policy and Direct Login routes.
- `/.well-known/unet-miniapp.json` describes launch URL and requested host permissions.

Generate them with `createUnetServiceManifest` and `createUnetMiniappManifest` from `@u-net/server`. Their service ID, origin, endpoint URLs, and account policy must match the dashboard registration.

## Miniapp login

Inside U-net, call `host.createServiceSession`. The host obtains the provider challenge, signs it with the selected local service-account key, submits approval directly to the provider, and returns the provider exchange result. The miniapp does not receive a central assertion.

```ts
const requestId = crypto.randomUUID();
window.ReactNativeWebView?.postMessage(JSON.stringify({
  id: requestId,
  action: 'host.createServiceSession',
  payload: {},
}));
```

Permissionless miniapps may publish `permissions: []`. They receive no scoped identity and all identity or attestation bridge calls are rejected.

## Checklist

- Use one verified HTTPS origin.
- Keep claim tokens and session secrets server-only.
- Store challenges, accounts, replay records, and sessions in the provider database.
- Keep the browser and miniapp on the same Direct Login implementation.
- Run the dashboard readiness checks before publishing.
