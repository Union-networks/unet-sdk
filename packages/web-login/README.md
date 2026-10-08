# @u-net/web-login

Browser-safe helpers for creating, polling, and exchanging browser-bound Direct Login V2 challenges. SDK 2 requires a coordinated provider and miniapp migration; it has no session-ID redemption fallback.

```bash
npm install @u-net/web-login@next
```

```ts
import { createDirectProviderLogin, exchangeDirectProviderLogin, waitForDirectProviderLogin } from '@u-net/web-login';

const challenge = await createDirectProviderLogin(window.location.origin);
const result = await waitForDirectProviderLogin(window.location.origin, challenge.requestRef);
if (result.state === 'approved') {
  const exchanged = await exchangeDirectProviderLogin(window.location.origin, challenge.requestRef);
  if (!exchanged.success) throw new Error('direct_login_exchange_failed');
}
```

Status contains only lifecycle state. Exchange sends `{ requestRef }` with the originating browser's HTTP-only cookie. Approval alone does not establish your provider session. Native miniapp bridges approve the public WebView-created challenge; only the WebView exchanges it.

See [docs.egress.live](https://docs.egress.live) for guides and the versioned API reference.
