# @u-net/web-login

Browser-safe helpers for creating and polling provider-owned Direct Login V2 challenges.

```bash
npm install @u-net/web-login@next
```

```ts
import { createDirectProviderLogin, waitForDirectProviderLogin } from '@u-net/web-login';

const challenge = await createDirectProviderLogin(window.location.origin);
const result = await waitForDirectProviderLogin(window.location.origin, challenge.requestRef);
```

See [docs.egress.live](https://docs.egress.live) for guides and the versioned API reference.
