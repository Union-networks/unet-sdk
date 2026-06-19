# @union-networks/contracts

Generated TypeScript types from the snapshotted U-net public OpenAPI contract.

Most application developers do not need to import this package directly. It is mainly useful when you want exact request/response types for the public U-net API or you are building your own client wrapper.

## Install

```bash
npm install @union-networks/contracts@alpha
```

## Usage

```ts
import type { components, paths } from '@union-networks/contracts';

type WebLoginSession = components['schemas']['WebLoginSession'];
type VerificationSession = components['schemas']['VerificationSession'];
```

The generated types come from `contracts/openapi/unet-public-api.v1.json` in the SDK repository.

## What Is Included

The public contract currently covers stable external integration APIs:

- web login session creation and polling
- verification check catalog
- verification session creation and polling
- checkout-bound verification
- mini-program catalog discovery where public enough for SDK use

Demo, admin, issuer-fixture, and internal trust-plane APIs are intentionally excluded.

## When To Use This Package

Use it when:

- you are writing your own fetch client
- you want typed route responses in tests
- you are validating that your integration matches a specific U-net public contract version

For normal integrations, prefer:

- `@union-networks/web-login`
- `@union-networks/verification`
- `@union-networks/react`


## Miniapp Manifest Type

The public OpenAPI snapshot includes `UnetMiniAppManifest`, the JSON shape a web app serves from `/.well-known/unet-miniapp.json` to become openable as an unlisted U-net miniapp during development.

For most apps, generate the manifest with `createUnetMiniappManifest` from `@union-networks/server` instead of writing the JSON by hand. That helper keeps `launchUrl`, `origin`, permissions, and optional domain-claim data in the shape U-net expects.

## Domain Claims

Domain-control claim responses are public JSON documents served from your origin. The raw claim token is not part of the public contract and must stay server-side. Use `@union-networks/server` to generate the response from server environment variables.
