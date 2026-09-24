# Domain-Admin Callback Security

This note describes the source candidate, not a published package or deployed
provider. The changeset is scoped to `@u-net/issuer`; it does not change package
versions, installed dependencies, provider configuration or existing credentials.

## Callback Contract

- `validateDomainAdminCallbackRequest` and the callback handlers reject protocol
  `version: 1` with `protocol_upgrade_required`. The maintained Safety and
  Supermarket routes return HTTP 426 for that rejection, before signer access,
  encryption, ledger anchoring or callback storage work.
- `createDomainAdminCallbackHandlerV2` and its general implementation require
  verified V2 asymmetric control authorization. HMAC `v1=...` authorization is
  not accepted, even if the general implementation receives its legacy
  `controlAuthorizationSecret` option. No unauthorized fallback is available.
- Existing HMAC helper symbols remain in their existing source export surface.
  This patch neither removes helper exports nor adds them to the package's
  curated public entrypoint. A retained helper does not authorize a callback.
- V2 issuance requires `clientRequestId` and a valid `holderRevocationSigner`.
  Invitation expiry must parse to a finite future timestamp. The SDK rejects
  non-finite/missing authorization timestamps, array/combined challenge headers,
  and array/combined or trailing authorization values.
- The maintained revoke routes already required V2. They now also reject v1
  with HTTP 426, reject non-finite expiry, and defer issuer signer/runtime work
  until after control authorization. This does not introduce a holder-signer
  requirement on issuer-authorized revocation.

Callback protocol `version: 2` is independent of the credential schema ID
`unet.provider.domain-admin.v1`. Keep that schema ID unchanged. This patch does
not invalidate, migrate, revoke or reissue existing credentials, and does not
change signed successful response payloads.

## Required Nonce Consumer

The V2 adapter's `consumeControlNonce(nonce): Promise<boolean>` callback is
required. The general implementation also fails closed if it is absent at
runtime. It runs after signature and request-binding verification, before
challenge consumption and credential issuance.

The provider must implement all of the following:

1. Atomically consume each nonce once, returning `true` only to the winner and
   `false` when it has already been consumed. A database unique constraint with
   insert-on-conflict is suitable; a read followed by an unguarded insert is not.
2. Persist consumption across process restarts and share it across all replicas.
   An in-memory Set is sufficient only for a unit-test fixture.
3. Retain the consumed nonce throughout the complete accepted authorization
   window, including permitted future timestamps and clock skew. Premature
   expiration can make an old signed authorization replayable.
4. Fail closed on storage failure. Do not substitute `true` or an in-memory
   fallback when durable storage is unavailable. Do not log raw authorization
   headers, request capabilities or storage exceptions.

The SDK can require the callback and its boolean result; it cannot prove the
storage behind a caller-supplied callback is durable. Deployment review and
cross-process/database acceptance must establish that property separately.

Nonce consumption is not a transaction spanning credential construction, ledger
submission and response delivery. This fix does not provide exactly-once
issuance or automatic recovery after a consumed nonce and downstream failure.
Maintained provider challenge sets are process-local; Safety additionally checks
challenge presence before awaiting authorization. Separate transactional
idempotence work is required for concurrent requests, retries, restarts, and an
anchor that succeeds before encryption or response signing fails.

## Installed Providers And Rollout

The maintained providers currently pin `@u-net/issuer@2.0.0-rc.2`. That installed
release does not acquire this fix merely because SDK source was edited. Upgrade
the package and lockfile to a released candidate containing the fix, rebuild,
and verify the actual installed/bundled package and source identity. This note
does not prescribe an unpublished version number or claim that a release exists.

The local Safety and Supermarket route guards independently enforce V2-only
callbacks, finite invitation expiry and rejection of HMAC/duplicate control
headers even with the installed RC2 dependency. Safety verifies control
authorization in its provider helper; Supermarket performs early route guards
before the installed V2 adapter and supplies public keys plus nonce consumption,
not a HMAC secret. Both defer sensitive signer work until authorization.
These defenses do not substitute for upgrading other SDK consumers or prove
that all new SDK validation is present in the old installed package.

Do not deploy current provider HEAD merely to obtain emergency containment:
other candidate changes, including strict database TLS, require their own
production acceptance. A separate matcher-only containment proposal exists in
the parent workspace's `audit-2026-09-24/domain-admin-containment/` directory.
It is based on historically recorded deployed commits, which must be confirmed
before any rollout. Login-only maintenance does not cover domain-admin routes.

## Exact Local Commands

Use existing dependencies; these commands do not install or publish packages.
Run the following from the SDK repository root:

```powershell
node node_modules/vitest/vitest.mjs run packages/issuer/src/domain-admin-auth.test.ts packages/issuer/src/index.test.ts
node node_modules/vitest/vitest.mjs run packages/issuer/src
node node_modules/typescript/bin/tsc -p packages/issuer/tsconfig.json --noEmit
```

The focused run passed 41 tests, including 28 dedicated auth regressions. The
broader issuer run passed 64 tests. Issuer typecheck passed.

Run these commands separately from each maintained provider repository root,
`safety-current` and `supermarket-current`, using Node 24 and installed deps:

```powershell
node --import tsx --experimental-test-module-mocks --test tests/callback-privacy.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Focused results: Safety 51 tests; Supermarket 35 tests; both typechecks passed.
The test file also works through each provider's ordinary test command: it
starts an isolated child with module mocking enabled and a minimal test
environment. Direct commands above expose the individual regression counts.

From the parent workspace root, optional read-only containment-proposal tests:

```powershell
node --test audit-2026-09-24/domain-admin-containment/containment.test.mjs
```

Those 4 tests use pinned Git objects and Next matcher/response helpers. They do
not start a server or establish deployed containment.

## Real Crypto And Mocked Effects

| Test surface | Real execution | Fixture or mock boundary |
| --- | --- | --- |
| SDK auth regressions | SDK source handlers; fresh Ed25519 signatures and verification; request binding; genuine signed nonce reuse; HMAC rejection; signed malformed timestamps | In-memory nonce Set; callback spies; stub credential issuance; no durable database or ledger |
| Provider route regressions | Actual route exports; provider control helpers; installed SDK verification where used; fresh Ed25519 signed control messages; wrong key/path/audience/body rejection; signed nonce reuse; response signing and signature verification | Synthetic control-key discovery; in-memory nonce callback or mocked SQL pool; signer configuration, credential construction/encryption, ledger calls, issuer service and inbox storage mocked |
| Provider privacy regressions | Actual response/error boundaries, exact expected status codes, no-store headers, no cookie, canary exclusion from responses and captured logs | Injected synthetic database/catalog/issuer/ledger/crypto failures; no production requests or credentials |

The replay regressions exercise real cryptography and a stateful nonce consumer,
not a verifier mock returning `true`. They do not prove PostgreSQL durability,
replica-wide serialization, process-crash recovery or deployed behavior.

Earlier actual Next production browser/TLS passes refer to snapshots taken
before this auth/privacy patch. They must not be relabeled as acceptance of the
new candidate. No new runtime resources, remote fixtures, production calls,
package publication or deployment were needed for this documentation update.
