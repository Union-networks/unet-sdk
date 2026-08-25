# @union-networks/issuer

Server-side helpers for providers that issue U-net credentials. Sovereign Core V2 keeps requests, encrypted delivery, replacement state, and issuer private keys on provider infrastructure. Trust-plane remains the signed schema, check, issuer-profile, and proof-release control plane.

## Install

```bash
pnpm add @union-networks/issuer
```

## Key separation

Every issuer uses three independent private keys:

- Ed25519 API authorization key for provider callbacks and management actions.
- secp256k1 credential key for signatures verified inside generic Noir profiles.
- secp256k1 Ledger V2 key for EIP-712 anchor, revoke, rotate, and retire operations.

Generate the Ledger V2 key with `generateLedgerV2SignerEnv`. Private keys remain server-only. Relayers receive signed operations and pay gas, but cannot change the issuer, commitment, holder revocation address, request hash, nonce, or deadline.

## Provider-owned issuance

Use `createDirectIssuerService` with `PostgresDirectIssuerRequestStore` behind same-origin provider routes. The wallet submits a credential-specific holder binding, delivery public key, and holder revocation address directly to the provider.

The provider must:

1. Apply its issuance and replacement policy.
2. Build and sign credential-envelope v2.
3. Encrypt it to the wallet's delivery key.
4. Persist the ciphertext before anchoring.
5. Call `anchorLedgerV2CredentialFromEnv` through two or more relayers.
6. Expose delivery only after Ledger V2 confirms the commitment.

Acknowledgement and replacement are provider-owned. With `replace_after_delivery`, revoke the previous commitment only after the new encrypted envelope is acknowledged. Issuer revocation uses `revokeLedgerV2CredentialFromEnv`; holders can revoke independently with the credential-specific holder key.

## Domain administration credentials

Paid domains issue private Owner and Admin credentials from same-origin server callbacks. Run this once on the provider server:

```ts
import { generateDomainAdminSignerEnv } from '@union-networks/issuer';

console.log(await generateDomainAdminSignerEnv({ serviceId: 'your-service' }));
```

Install the returned environment block as server secrets. Register only the callback public key, credential key ID/hash, Ledger V2 key ID/address, and callback URL from the dashboard Keys page.

Use `createDomainAdminSignerFromEnv` and `createDomainAdminCallbackHandler` for issuance. Ledger V2 issue and revoke callbacks must validate `x-unet-control-authorization` with the server-only control secret before signing an operation. `generateDomainAdminSignerEnv` emits the dedicated domain-admin ledger signer under `UNET_DOMAIN_ADMIN_LEDGER_*`.

## Miniapp manifest

```ts
import { createIssuerMiniappManifest } from '@union-networks/issuer';

export const manifest = createIssuerMiniappManifest({
  serviceId: 'your-service',
  name: 'Example Issuer',
  provider: 'Example Organization',
  launchUrl: 'https://issuer.example/miniapp',
});
```

## Security

- Never put API, credential, or ledger private keys in browser bundles.
- Persist encrypted delivery before submitting an anchor operation.
- Require chain confirmation before making delivery ready.
- Keep callback challenges replay-protected and validate body-bound control authorization.
- Do not log claims, holder bindings, delivery capabilities, private keys, or credential envelopes.
- Browser code may submit holder-authorized requests and display status; issuance and issuer revocation stay server-side.
- U-net control-plane services do not receive scoped IDs, request records, or encrypted credential envelopes in Sovereign Core V2.
