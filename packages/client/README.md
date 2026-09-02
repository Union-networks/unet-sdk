# @u-net/client

Framework-neutral browser and Node client for verified service discovery, hosted verification, exact Ledger V2 reads, and holder-authorized revocation.

```bash
npm install @u-net/client@next
```

```ts
import { createUnetClient } from '@u-net/client';

const service = await createUnetClient().resolveService({
  serviceId: 'example-shop',
  origin: 'https://shop.example',
});
```

See [docs.egress.live](https://docs.egress.live) for guides and the versioned API reference.
