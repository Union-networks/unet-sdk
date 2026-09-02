# @u-net/react

Browser-safe React hooks and components for provider-hosted Direct Login V2 and hosted verification. This package does not depend on issuer or proving code.

```bash
npm install @u-net/react@next
```

```ts
import { UnetLoginQr, useUnetLogin } from '@u-net/react';

const login = useUnetLogin(window.location.origin);
```

See [docs.egress.live](https://docs.egress.live) for guides and the versioned API reference.
