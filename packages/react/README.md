# @union-networks/react

React hooks and lightweight components for U-net login and verification.

Use this package for React, Next.js client components, Vite, Remix browser components, or any React app that wants a faster integration than wiring the lower-level packages manually.

## Install

```bash
npm install @union-networks/react@alpha
```

`react` is a peer dependency. React 18 or newer is supported.

## Login Hook

```tsx
'use client';

import { UnetLoginQr, useUnetLogin } from '@union-networks/react';

export function LoginPanel() {
  const login = useUnetLogin(
    {
      serviceId: 'demo-supermarket',
      origin: window.location.origin,
      expiresInSeconds: 120,
    },
    );

  return (
    <section>
      <button onClick={() => void login.start()}>Sign in with U-net</button>
      {login.session ? <UnetLoginQr session={login.session} /> : null}
      {login.error ? <p>{login.error.message}</p> : null}
    </section>
  );
}
```

`login.start()` resolves with the terminal login session. When it is approved, send `assertionJws` to your server and verify it with `@union-networks/server`.

```tsx
async function onLogin() {
  const result = await login.start();
  if (result.status !== 'approved' || !result.assertionJws) return;

  await fetch('/api/unet/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assertionJws: result.assertionJws }),
  });
}
```

## Verification Hook

```tsx
import {
  UnetVerificationQr,
  UnetVerificationStatus,
  useUnetVerification,
} from '@union-networks/react';

export function AgeCheckPanel() {
  const verification = useUnetVerification(
    {
      verifierId: 'shop.example',
      verifierDisplayName: 'Example Shop',
      requestedChecks: [{ requestType: 'age_over_18' }],
      ttlSeconds: 120,
    },
    { verifierBaseUrl: 'https://verifier.egress.live' },
  );

  return (
    <section>
      <button onClick={() => void verification.start()}>Request age check</button>
      {verification.session ? <UnetVerificationQr session={verification.session} /> : null}
      <UnetVerificationStatus result={verification.result} />
    </section>
  );
}
```

`UnetVerificationQr` currently renders the QR payload as text so you can plug in your own QR component.

## Paginated Catalog Hooks

```tsx
import { useVerificationChecks, useMiniPrograms } from '@union-networks/react';

const checks = useVerificationChecks(
  { query: searchText, limit: 20 },
  { verifierBaseUrl: 'https://verifier.egress.live' },
);

const miniPrograms = useMiniPrograms(
  { query: searchText, limit: 20 },
);
```

Both hooks expose:

- `catalog`
- `error`
- `isLoading`
- `load(cursor?)`
- `loadMore()`
- `hasNextPage`

Use these with virtualized or infinite lists when your app may have many checks or miniapps.

## QR Rendering

`UnetLoginQr` renders `session.qrDataUrl` as an image when trust-plane provides one. Otherwise it renders the QR payload text so you can pass it to your own QR component.

`UnetVerificationQr` renders the verification QR payload as text. Most production UIs should pass `session.qrPayload` into their preferred QR-code component for visual rendering.

## Security Notes

- React components help with UI state only. They do not create a trusted server session.
- Verify login assertions on your backend.
- Keep assertion secrets out of React code.
- Treat `denied`, `expired`, and `failed` as normal UI states.

## Production issuer default

The SDK defaults to `https://issuer.egress.live`. You only need to pass `issuerBaseUrl` when targeting a local or staging trust-plane. Keep `origin` explicit: in browser code this is usually `window.location.origin`, and on the server it should be your configured public deployment origin. An `origin_mismatch` means the registered U-net service/domain claim does not match the current site origin.
