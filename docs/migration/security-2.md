# SDK 2 security migration (2.0.0-rc.1, unpublished)

These interfaces are staged for the coordinated 2.0.0 release-candidate train.
They must not be deployed against unchanged providers or mobile miniapp bridges.
There is no session-ID redemption compatibility fallback.

## Browser login

Use `createDirectLoginWebHandlers` for challenge, details, approval, status, and
exchange routes. Supply an `exchange` callback that sets your HTTP-only provider
session cookie. The callback executes only after atomic consumption. A callback
failure requires a fresh login; it does not restore redemption authority.

The adapter creates a random per-attempt secret, sends it only in a Secure,
HTTP-only, SameSite=Strict, host-only cookie, and stores its S256 hash. Every
attempt has a separate cookie, including simultaneous browser tabs. Challenge
creation and exchange require the exact provider Origin and JSON content type.
Do not forward browser cookies to native bridges or include them in responses.

The public challenge and QR contain no redemption authority. Authenticated
status returns only `state`; it no longer returns a session or scoped identity.
Exchange accepts `{ requestRef }` plus the cookie. Eight failed exchanges lock
the attempt. Edge request-rate limits are still required against resource abuse.

`createDirectProviderLogin` reads the canonical `{ success, challenge }` response.
`exchangeDirectProviderLogin` redeems it using browser cookies. `useUnetLogin`
redeems an approved attempt before returning `state: consumed`.

This is PKCE-style S256 binding for U-net's custom protocol, not a claim of
OAuth or OpenID Connect compliance.

## Miniapps

The WebView, not native code, must create the provider challenge. Pass that
public challenge to `host.createServiceSession`; native code validates and
approves that exact reference. The WebView then exchanges `{ requestRef }`
using its cookie. Native code must not poll private browser status or redeem
sessions. Migrate dashboard Owner/Admin selections to the same login attempt.

## Stores and cleanup

`PostgresDirectLoginChallengeStore` and `PostgresDirectLoginAccountStore` require
a pool with `connect()`. Transactions use one checked-out connection; never
emulate a transaction by issuing BEGIN/COMMIT on unrelated pool queries.

For tests, pass the same `InMemoryDirectLoginAccountStore` to the challenge
store constructor and service options. Custom stores must implement atomic
approval/key binding and authenticated browser access. The old read/update
store interface is intentionally removed.

Run `ensureDirectLoginSchema`, then schedule `retryRetirementCleanup()` from a
durable provider worker or authenticated cron. Retirement and cleanup enqueue
commit together; the callback must be idempotent. Account tombstones and
operation records are permanent. Failed callbacks remain pending. Retain the
registered account public key for verifying delayed retirement signatures.

Custom stores supplied to the login service must implement
`DirectLoginRetirementStore`. Workers must use `claimRetirements(limit)`,
returning `{ operationId, scopedUserId, leaseToken }`, rather than the
non-claiming `pendingRetirements` inspection method.
Both `completeRetirementCleanup(operationId, leaseToken)` and
`failRetirementCleanup(operationId, leaseToken)` must fence obsolete workers.
Claims are exclusive while leased; abandoned claims become eligible again.
The PostgreSQL adapter uses locked claims, expiring leases, and retry backoff.
Do not restore an unfenced cleanup API or delete tombstones after cleanup.

`onAccountRetired(scopedUserId, operationId, signal)` receives an idempotency
identifier and an abort signal. Honor cancellation and make external effects
idempotent by operation ID: a timeout cannot undo effects already in progress.

Old, correctly signed retirement requests remain valid. Future-dated requests
outside the clock allowance, wrong origins, wrong keys, and conflicting
operation IDs fail. Retirement must never reactivate an account.

## Deployment requirements

- Invalidate legacy challenges and provider sessions at the security cutover.
- Authenticate existing sessions against active provider accounts; retirement
  must invalidate their access, not merely stop new logins.
- Migrate all providers and dashboard proxies before publication.
- Configure proxy, tracing, and application logs to omit URLs, cookies, bodies,
  capabilities, and relationship identifiers.
- Run real PostgreSQL tests with `UNET_SECURITY_TEST_POSTGRES_URL` pointing to
  a disposable database named `unet_security_test`. The test creates and drops
  only its own random schema. Never use a provider database.

The messaging proof/policy protocol, client reset, and deployed integration
matrix are separate mandatory release gates; this SDK patch does not complete
those gates.

See the [candidate release record](../releases/2.0.0-rc.1.md) for package artifacts,
validation results, and remaining release blockers.
