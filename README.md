# U-net SDK

TypeScript packages for adding U-net login and verification to web apps.

U-net lets a user approve actions in the mobile app and gives your service a stable service-scoped ID. Your app does not receive the user's public U-net ID, email, phone number, Firebase token, holder ID, private keys, or attestation data. For checks such as over-18 verification, your app receives a pass/warning/fail result from U-net instead of the underlying personal data.

The SDK is currently alpha. APIs are usable for demos and early integrations, but breaking changes can still happen before a stable `1.0` release.

## Packages

- `@union-networks/web-login`: high-level browser helpers for Sign in with U-net.
- `@union-networks/verification`: high-level helpers for verification sessions, check catalogs, mini-program catalogs, and checkout-bound verification.
- `@union-networks/react`: React hooks and small QR/status components.
- `@union-networks/server`: Node helpers for verifying U-net login assertions on your server.
- `@union-networks/client`: lower-level fetch client, polling helpers, QR parsing, and shared errors.
- `@union-networks/contracts`: generated TypeScript types from the public OpenAPI snapshot.

Most web apps should start with `@union-networks/web-login`, `@union-networks/verification`, and optionally `@union-networks/react`.

## Install

```bash
npm install @union-networks/web-login@alpha @union-networks/verification@alpha @union-networks/server@alpha
```

For React apps:

```bash
npm install @union-networks/react@alpha
```

## Required Setup

Before a production service can use U-net login, the service must be registered with U-net trust-plane. A service registration contains:

- `serviceId`, for example `demo-supermarket`
- allowed browser origin, for example `https://shop.example.com`
- display name and optional icon
- redirect URL
- allowed scopes, starting with `identity.scoped`

For local demos you can use the public demo endpoints:

```ts
const issuerBaseUrl = 'https://issuer.egress.live';
const verifierBaseUrl = 'https://verifier.egress.live';
```

In production, point the SDK at the U-net trust-plane endpoints assigned to your environment.

## Sign In With U-net

This is the normal browser flow:

1. Your page creates a one-time login session.
2. You render the returned QR code.
3. The user scans it with U-net mobile and approves with biometrics.
4. Your page polls until approved, denied, or expired.
5. Your server verifies the returned login assertion.
6. Your app creates or loads an account keyed by `scopedUserId`.

```ts
import {
  createLoginSession,
  isApprovedLoginResult,
  pollLoginSession,
  renderLoginQrPayload,
} from '@union-networks/web-login';

const session = await createLoginSession(
  {
    serviceId: 'demo-supermarket',
    origin: window.location.origin,
    expiresInSeconds: 120,
  },
  { issuerBaseUrl: 'https://issuer.egress.live' },
);

const qrPayload = renderLoginQrPayload(session);

const result = await pollLoginSession(session.sessionId, {
  issuerBaseUrl: 'https://issuer.egress.live',
  intervalMs: 1500,
  timeoutMs: 120000,
});

if (isApprovedLoginResult(result)) {
  console.log(result.scopedUserId);
  console.log(result.assertionJws);
}
```

Do not treat the browser result alone as a trusted login. Send `assertionJws` to your server and verify it there.

## Verify Login Assertions On Your Server

```ts
import { verifyLoginAssertion } from '@union-networks/server';

export async function POST(request: Request) {
  const { assertionJws } = await request.json();

  const claims = verifyLoginAssertion(assertionJws, {
    secret: process.env.UNET_WEB_LOGIN_ASSERTION_SECRET!,
    serviceId: 'demo-supermarket',
  });

  const account = await findOrCreateAccount({
    scopedUserId: claims.scopedUserId!,
  });

  return Response.json({ ok: true, accountId: account.id });
}
```

The scoped ID is stable for your service but different for other services. That is the privacy boundary: two providers cannot join their account tables by a shared global user ID.

## Request An Over-18 Verification

Use this when you want a standalone verification QR, for example at a venue, checkout screen, or admin flow.

```ts
import {
  createVerificationSession,
  listVerificationChecks,
  pollVerificationResult,
} from '@union-networks/verification';

const catalog = await listVerificationChecks(
  { query: 'age', limit: 20 },
  { verifierBaseUrl: 'https://verifier.egress.live' },
);

const ageCheck = catalog.checks.find((check) => check.requestType === 'age_over_18');
if (!ageCheck) throw new Error('age_over_18 is not available');

const session = await createVerificationSession(
  {
    verifierId: 'shop.example.checkout',
    verifierDisplayName: 'Example Shop',
    requestedChecks: [ageCheck],
    ttlSeconds: 120,
  },
  { verifierBaseUrl: 'https://verifier.egress.live' },
);

const result = await pollVerificationResult(session.sessionId, {
  verifierBaseUrl: 'https://verifier.egress.live',
});

if (result.aggregateOutcome === 'passed') {
  // The user proved the requested check.
}
```

## Checkout-Bound Verification

Checkout-bound verification protects against the classic parent-phone problem. The user must be logged into your service with U-net first. When you request a checkout verification, trust-plane binds the verification session to the same private holder that owns the logged-in scoped ID. A different phone can scan the QR, but the checkout will fail with holder mismatch.

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

if (checkout.requiresVerification && checkout.verification) {
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
  }
}
```

## React Example

```tsx
import { UnetLoginQr, useUnetLogin } from '@union-networks/react';

export function LoginPanel() {
  const login = useUnetLogin(
    {
      serviceId: 'demo-supermarket',
      origin: window.location.origin,
      expiresInSeconds: 120,
    },
    { issuerBaseUrl: 'https://issuer.egress.live' },
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

## Error Handling

All SDK packages use the shared error classes from `@union-networks/client`:

- `UnetApiError`: trust-plane returned a non-2xx API response.
- `UnetTimeoutError`: polling timed out or was aborted.
- `UnetContractError`: trust-plane returned a malformed response for the public contract.

```ts
import { UnetApiError, UnetTimeoutError } from '@union-networks/client';

try {
  await pollLoginSession(sessionId);
} catch (error) {
  if (error instanceof UnetTimeoutError) {
    // Show an expired QR message.
  } else if (error instanceof UnetApiError) {
    // Show a service error or retry option.
  } else {
    throw error;
  }
}
```

## Security Notes

- Verify login assertions on your server. Do not trust browser-only state.
- Store accounts by `scopedUserId`, not by public U-net ID.
- Do not ask U-net users for passwords, emails, phone numbers, or global IDs just to use scoped login.
- For restricted purchases, use checkout-bound verification instead of storing a reusable `ageVerified` flag.
- QR sessions are short-lived and one-time use. Always handle `denied` and `expired` states.

## Repository Layout

```text
packages/contracts     Generated OpenAPI types
packages/client        Low-level HTTP client and shared errors
packages/web-login     Browser login helpers
packages/verification  Verification and checkout helpers
packages/react         React hooks/components
packages/server        Server-side assertion helpers
examples/              Minimal integration examples
contracts/openapi/     Versioned public API snapshots
```

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

The public contract snapshot lives at `contracts/openapi/unet-public-api.v1.json`. Regenerate generated TypeScript contract types with:

```bash
pnpm contracts:generate
```
