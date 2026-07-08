# @union-networks/issuer

Issuer-side helpers for U-net attestation providers.

Use this package when your service issues attestations, such as an authority,
membership provider, school, event organizer, or other domain that can approve
or revoke claims for a scoped U-net user.

This package is intentionally server-first. Issuer signing keys must stay in
your backend environment and must never be included in frontend bundles.

## Install

```bash
pnpm add @union-networks/issuer
```

## Generate an issuer keypair

```ts
import { generateIssuerKeyPairEnv } from '@union-networks/issuer';

console.log(generateIssuerKeyPairEnv());
```

Store the printed values in your server environment:

```bash
UNET_ISSUER_ID=issuer:authority-portal
UNET_ISSUER_KEY_ID=issuer:authority-portal#main
UNET_ISSUER_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----..."
UNET_ISSUER_PUBLIC_KEY_PEM="-----BEGIN PUBLIC KEY-----..."
```

## Register your issuer key

```ts
import { registerIssuerKey } from '@union-networks/issuer';

await registerIssuerKey({
  serviceId: 'authority-portal',
  issuerId: process.env.UNET_ISSUER_ID!,
  keyId: process.env.UNET_ISSUER_KEY_ID!,
  publicKeyPem: process.env.UNET_ISSUER_PUBLIC_KEY_PEM!,
  providerToken: process.env.UNET_PROVIDER_API_KEY,
});
```

## Create a holder-facing request

In a miniapp, create or receive a scoped service session through the U-net
miniapp bridge. Then ask trust-plane to open an attestation request for that
scoped user:

```ts
import { createAttestationRequest } from '@union-networks/issuer';

const request = await createAttestationRequest({
  serviceId: 'authority-portal',
  scopedUserId,
  requestType: 'age_over_18',
  claims: { source: 'issuer-example' },
});
```

## Approve a request

Approval must happen on your server, because it signs with your issuer private
key:

```ts
import {
  approveAttestationRequest,
  createIssuerSignerFromEnv,
} from '@union-networks/issuer';

await approveAttestationRequest({
  serviceId: 'authority-portal',
  requestId,
  signer: createIssuerSignerFromEnv(),
  claims: { predicate: 'age_over_18', result: true },
  providerToken: process.env.UNET_PROVIDER_API_KEY,
});
```

Trust-plane verifies the issuer signature, checks that the issuer key is
registered for the service/schema, anchors the commitment, and delivers the
attestation to the holder.

## Revoke an attestation

```ts
import { revokeAttestation, createIssuerSignerFromEnv } from '@union-networks/issuer';

await revokeAttestation({
  serviceId: 'authority-portal',
  attestationHash,
  reason: 'Revoked by issuer',
  signer: createIssuerSignerFromEnv(),
  providerToken: process.env.UNET_PROVIDER_API_KEY,
});
```

## Miniapp manifest helper

```ts
import { createIssuerMiniappManifest } from '@union-networks/issuer';

export const manifest = createIssuerMiniappManifest({
  serviceId: 'authority-portal',
  name: 'Authority Portal',
  provider: 'Demo Authority',
  launchUrl: 'https://your-domain.example/miniapp',
  description: 'Request attestations from the issuer.',
});
```

## Security notes

- Keep issuer private keys server-side.
- Use one issuer key per provider/service.
- Rotate keys by registering a new `keyId`, deploying it, then retiring the old
  key after pending requests are complete.
- Browser code can create requests and display status, but approval/revocation
  must happen on the server.
- U-net receives scoped IDs, issuer signatures, and attestation commitments; it
  should not receive unnecessary private user data.
