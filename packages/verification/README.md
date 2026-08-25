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
- Supports provider-owned action and checkout records through expiring hosted verifier sessions.
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

The QR payload is intentionally compact. It contains a session reference, not the full list of requested checks.

`checkResults` contains per-check details such as `holder_denied`, revoked attestation, or proof failure.

## Provider-Owned Checkout Verification

Keep the checkout in your own database. Create a hosted verifier session, store only its random session ID/reference with the checkout, and mark the checkout complete after the verifier reports `verified` and `passed`.

```ts
import {
  createVerificationSession,
  pollVerificationResult,
} from '@union-networks/verification';

const verification = await createVerificationSession({
  verifierId: 'shop.example',
  verifierDisplayName: 'Example Shop',
  requestedChecks: [{ requestType: 'age_over_18' }],
  ttlSeconds: 120,
});
await saveCheckout({ verificationSessionId: verification.sessionId });
const result = await pollVerificationResult(verification.sessionId);
if (result.status === 'verified' && result.aggregateOutcome === 'passed') await completeCheckout();
```

The verifier stores only an expiring session and sanitized outcome. It does not need a holder ID or a trust-plane scoped-account relationship. The legacy central checkout helpers remain exported only for staged migration and stop working after V2 enforcement.

## Mini-Program Catalog

```ts
import { listMiniPrograms } from '@union-networks/verification';

const page = await listMiniPrograms(
  { query: 'supermarket', limit: 10 },
);
```

## Security Notes

- Verification proves a check result; it does not reveal the underlying document or attestation content to your website.
- Use checkout-bound verification for restricted purchases or account-bound actions.
- Do not cache a reusable `ageVerified` flag for future purchases unless your policy explicitly supports that.
- Always handle `warning`, `failed`, `denied`, and `expired` states in the UI.

## Production issuer default

The SDK defaults to `https://issuer.egress.live`. You only need to pass `issuerBaseUrl` when targeting a local or staging trust-plane. Keep `origin` explicit: in browser code this is usually `window.location.origin`, and on the server it should be your configured public deployment origin. An `origin_mismatch` means the registered U-net service/domain claim does not match the current site origin.
