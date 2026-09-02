# U-net SDK

The canonical TypeScript SDK, examples, and documentation for U-net Sovereign Core V2.

Providers own scoped profiles, login sessions, attestation applications, encrypted credential delivery, and official inbox records. U-net publishes verified service metadata and proof definitions, operates optional verification infrastructure, and relays cryptographically authorized Ledger V2 operations.

## Packages

- `@u-net/client`: service discovery, hosted verification, exact Ledger V2 reads, and holder revocation.
- `@u-net/contracts`: generated TypeScript contracts for public V2 interfaces.
- `@u-net/server`: provider-owned Direct Login, sessions, manifests, inboxes, messaging, and metrics.
- `@u-net/web-login`: browser helpers for provider-hosted Direct Login V2.
- `@u-net/react`: browser-safe React hooks and status components.
- `@u-net/verification`: hosted verifier and public catalog helpers.
- `@u-net/issuer`: provider-owned issuance, delivery, renewal, replacement, and Ledger V2 signing.
- `@u-net/setup`: local private-key and provider environment generation.

## Install

Release candidates use the `next` tag:

```bash
npm install @u-net/server@next @u-net/web-login@next
```

Stable releases use the normal command:

```bash
npm install @u-net/server @u-net/web-login
```

## Direct Login V2

Your server stores challenges and sessions in its own database and exposes the standard routes from `createDirectLoginWebHandlers`. The browser asks that same origin for a challenge:

```ts
import {
  createDirectProviderLogin,
  renderDirectLoginQrPayload,
  waitForDirectProviderLogin,
} from '@u-net/web-login';

const challenge = await createDirectProviderLogin(window.location.origin);
showQr(renderDirectLoginQrPayload(challenge));
const result = await waitForDirectProviderLogin(window.location.origin, challenge.requestRef);
```

The wallet signs a fresh provider challenge with the service-account key. A scoped ID alone is never a bearer credential, and the control plane is not on the login data path.

## Provider Setup

The dashboard provides a setup manifest containing public U-net configuration. Generate private keys and a local environment file on provider infrastructure:

```bash
npx @u-net/setup@next configure --manifest unet-setup.json --out .env.local --public-out unet-registration.json
```

Import only `unet-registration.json` into the dashboard. Never upload `.env.local` or private keys.

## Verification

```ts
import { createVerificationSession, pollVerificationResult } from '@u-net/verification';

const session = await createVerificationSession({
  verifierId: 'example.checkout',
  verifierDisplayName: 'Example Shop',
  requestType: 'age_over_18',
});
const result = await pollVerificationResult(session.sessionId);
```

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm api:check
pnpm docs:build
pnpm pack:dry
```

Public API changes require a Changeset and an updated API Extractor report. Documentation is published at [docs.egress.live](https://docs.egress.live), with release-candidate documentation at [next.docs.egress.live](https://next.docs.egress.live). Support and design discussion live in [GitHub Discussions](https://github.com/orgs/Union-networks/discussions).
