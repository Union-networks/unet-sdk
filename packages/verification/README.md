# @union-networks/verification

High-level helpers for U-net verification flows.

Use this package when your app needs to request checks such as over-18 verification, poll verification results, list available checks, or create checkout-bound verification sessions.

## Install

```bash
npm install @union-networks/verification@alpha
```

## What This Package Does

- Lists dynamic verification checks from trust-plane.
- Creates verification sessions and QR payloads.
- Polls verification results.
- Creates checkout-bound verification sessions that bind a proof to the same holder who logged into your service.
- Lists mini-program catalog entries when needed for app/provider discovery.

## List Available Checks

```ts
import { listVerificationChecks } from '@union-networks/verification';

const catalog = await listVerificationChecks(
  { query: 'age', limit: 20 },
  { verifierBaseUrl: 'https://verifier.egress.live' },
);

for (const check of catalog.checks) {
  console.log(check.requestType, check.label);
}
```

Pagination is cursor-based:

```ts
const first = await listVerificationChecks({ limit: 20 });
if (first.pageInfo?.hasNextPage) {
  const second = await listVerificationChecks({
    limit: 20,
    cursor: first.pageInfo.nextCursor,
  });
}
```

You can also iterate every page:

```ts
import { iterateVerificationChecks } from '@union-networks/verification';

for await (const check of iterateVerificationChecks({ limit: 50 })) {
  console.log(check.requestType);
}
```

## Create A Verification QR

```ts
import {
  createVerificationSession,
  pollVerificationResult,
} from '@union-networks/verification';

const session = await createVerificationSession(
  {
    verifierId: 'shop.example.checkout',
    verifierDisplayName: 'Example Shop',
    requestedChecks: [{ requestType: 'age_over_18' }],
    ttlSeconds: 120,
  },
  { verifierBaseUrl: 'https://verifier.egress.live' },
);

const result = await pollVerificationResult(session.sessionId, {
  verifierBaseUrl: 'https://verifier.egress.live',
});

switch (result.aggregateOutcome) {
  case 'passed':
    break;
  case 'warning':
    break;
  case 'failed':
    break;
}
```

`checkResults` contains per-check details such as `holder_denied`, revoked attestation, or proof failure.

## Checkout-Bound Verification

Use checkout-bound verification when a user is already signed in with U-net and you need to verify a restricted action. This prevents a different phone from satisfying the check for the logged-in account.

```ts
import {
  createCheckoutVerification,
  pollCheckoutVerification,
} from '@union-networks/verification';

const checkout = await createCheckoutVerification(
  {
    serviceId: 'demo-supermarket',
    assertionJws,
    requiredChecks: ['age_over_18'],
    restrictedResourceIds: ['wine-001'],
    ttlSeconds: 120,
  },
  { issuerBaseUrl: 'https://issuer.egress.live' },
);

if (checkout.verification) {
  const finalCheckout = await pollCheckoutVerification(
    {
      checkoutId: checkout.checkout.checkoutId,
      serviceId: 'demo-supermarket',
      assertionJws,
    },
    { issuerBaseUrl: 'https://issuer.egress.live' },
  );

  if (finalCheckout.checkout.status === 'completed') {
    // Continue checkout.
  } else {
    console.log(finalCheckout.checkout.failureReason);
  }
}
```

## Mini-Program Catalog

```ts
import { listMiniPrograms } from '@union-networks/verification';

const page = await listMiniPrograms(
  { query: 'supermarket', limit: 10 },
  { issuerBaseUrl: 'https://issuer.egress.live' },
);
```

## Security Notes

- Verification proves a check result; it does not reveal the underlying document or attestation content to your website.
- Use checkout-bound verification for restricted purchases or account-bound actions.
- Do not cache a reusable `ageVerified` flag for future purchases unless your policy explicitly supports that.
- Always handle `warning`, `failed`, `denied`, and `expired` states in the UI.
