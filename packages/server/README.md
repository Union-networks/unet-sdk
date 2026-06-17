# @union-networks/server

Server-side helpers for U-net integrations.

## Verify browser login assertions

```ts
import { verifyLoginAssertion } from '@union-networks/server';

const claims = verifyLoginAssertion(assertion, {
  secret: process.env.UNET_WEB_LOGIN_ASSERTION_SECRET!,
  serviceId: 'demo-shop',
});
```

## Expose a domain-control claim

Create a domain claim in the U-net partner dashboard, store the returned token
only in your server environment, then expose a well-known endpoint from your
backend. Browser bundles must never include the claim token.

```ts
import { createUnetProviderClaimHandler } from '@union-networks/server';

export const GET = () => Response.json(createUnetProviderClaimHandler({
  serviceId: 'demo-shop',
  origin: 'https://shop.example',
  claimId: process.env.UNET_PROVIDER_CLAIM_ID!,
  challenge: process.env.UNET_PROVIDER_CLAIM_CHALLENGE!,
  claimToken: process.env.UNET_PROVIDER_CLAIM_TOKEN!,
})());
```

## Generate a miniapp manifest

```ts
import { createUnetMiniappManifest } from '@union-networks/server';

export const GET = () => Response.json(createUnetMiniappManifest({
  serviceId: 'demo-shop',
  name: 'Demo Shop',
  provider: 'Demo Provider',
  origin: 'https://shop.example',
  launchUrl: 'https://shop.example/app',
  permissions: ['identity.scoped'],
  domainClaim: {
    serviceId: 'demo-shop',
    origin: 'https://shop.example',
    claimId: process.env.UNET_PROVIDER_CLAIM_ID!,
    challenge: process.env.UNET_PROVIDER_CLAIM_CHALLENGE!,
    claimToken: process.env.UNET_PROVIDER_CLAIM_TOKEN!,
  },
}));
```
