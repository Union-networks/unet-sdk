# Sign in with U-net

Install the SDK package you need:

```bash
pnpm add @union-networks/web-login
```

```ts
import { createLoginSession, pollLoginSession, renderLoginQrPayload } from '@union-networks/web-login';

const session = await createLoginSession({
  serviceId: 'demo-supermarket',
  origin: window.location.origin,
});

showQr(renderLoginQrPayload(session));

const result = await pollLoginSession(session.sessionId);
if (result.status === 'approved') {
  // Store result.assertionJws server-side and create a scoped account using result.scopedUserId.
}
```

The browser receives only the service-scoped ID and signed login assertion. It never receives the holder public U-net ID, holder ID, FCM token, or private keys.
