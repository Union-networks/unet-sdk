# Make a web app miniapp-ready

A U-net miniapp is a same-origin web app with a public manifest. Catalog listing controls discovery, not whether a verified unlisted service can use Direct Login V2.

## Browser login

```ts
import { createDirectProviderLogin, exchangeDirectProviderLogin, renderDirectLoginQrPayload, waitForDirectProviderLogin } from '@u-net/web-login';

const challenge = await createDirectProviderLogin(window.location.origin);
renderQr(renderDirectLoginQrPayload(challenge));
const result = await waitForDirectProviderLogin(window.location.origin, challenge.requestRef);
if (result.state === 'approved') {
  const exchanged = await exchangeDirectProviderLogin(window.location.origin, challenge.requestRef);
  if (!exchanged.success) throw new Error('direct_login_exchange_failed');
}
```

## Well-known routes

Serve both manifests from the verified HTTPS origin:

- `/.well-known/unet-service.json` describes account policy and Direct Login routes.
- `/.well-known/unet-miniapp.json` describes launch URL and requested host permissions.

Generate them with `createUnetServiceManifest` and `createUnetMiniappManifest` from `@u-net/server`. Their service ID, origin, endpoint URLs, and account policy must match the dashboard registration.

## Miniapp login

The WebView must create the provider challenge using `createDirectProviderLogin` so its HTTP-only redemption cookie stays in the WebView. Pass only that public challenge to `host.createServiceSession`. The host validates and approves that exact reference with the selected local service-account key; it must not create a replacement challenge, poll private status, or exchange the browser session.

Use `runMiniappLogin` from `@u-net/web-login` to coordinate one launch. It is generic over your authenticated account type and does not implement a particular host bridge or provider route. The callback API is:

```ts
import type { MiniappLoginOptions } from '@u-net/web-login';
import { createDirectProviderLogin, runMiniappLogin } from '@u-net/web-login';

type Account = { scopedUserId: string; displayName: string };

// hostRequest correlates bridge responses, rejects host errors, and supports AbortSignal.
// exchangeAndReadAccount and loadInitialStatus are your same-origin authenticated adapters.
const login: MiniappLoginOptions<Account> = {
  origin: window.location.origin,
  signal: launchController.signal,
  timeoutMs: 60_000,
  createChallenge: (signal) => createDirectProviderLogin(window.location.origin, { signal }),
  approve: (challenge, signal, context) => hostRequest('host.createServiceSession', {
    requestRef: challenge.requestRef,
    publicChallenge: challenge,
    loginDeadlineMs: context.expiresAtMs,
  }, signal),
  exchange: (challenge, signal) => exchangeAndReadAccount(challenge.requestRef, signal),
  initialize: (account, signal) => loadInitialStatus(account, signal),
  complete: (payload, signal) => hostRequest('host.completeLaunch', payload, signal),
};
const account = await runMiniappLogin(login);
// Update the current document's view; do not redirect to continue this launch.
```

`approve(challenge, signal, context)` receives `MiniappLoginApprovalContext`, a frozen `{ expiresAtMs: number }` immediately before approval. This is the original overall/challenge deadline, not a fresh 60-second budget. Forward it as `loginDeadlineMs` with the exact `requestRef` and `publicChallenge`. The host must validate the finite safe-integer timestamp (future and at most 60 seconds away), fence picker/authentication/proofs/approval against it, and never extend it after biometrics or proof loops. Existing two-argument callbacks remain TypeScript-compatible but must adopt this handshake to work with a deadline-enforcing host.

The approval callback must return the host's response for that exact challenge:

```ts
{
  requestRef: challenge.requestRef,
  approved: true,
  scopedUserId: 'service-scoped-account-id',
  launchReadiness: { version: 1, launchToken: '0123456789abcdef'.repeat(4), expiresAtMs: Date.now() + 30_000 },
}
```

The readiness object has exactly the three V1 fields shown. Its native-issued `launchToken` must be exactly 64 hexadecimal characters. `expiresAtMs` is a safe-integer Unix timestamp in milliseconds, strictly in the future and no more than 30 seconds after receipt. The token above is a synthetic documentation example, not a capability to generate in provider code. Unsupported versions, extra capability fields, malformed tokens, arbitrary initialization-cap overrides, and invalid or overlong expiry are rejected before exchange.

`exchange(challenge, signal)` redeems `{ requestRef }` in the initiating WebView with its HTTP-only cookie and returns the provider's authoritative authenticated account. If your exchange response contains only `{ success: true }`, fetch the authenticated account in the same callback. Do not substitute the host's scoped ID or a cached/pre-existing account. `initialize(account, signal)` loads authenticated initial status and returns its authoritative account, not `void`. Both returned accounts must match the approved `scopedUserId` or the helper fails the launch. Lifecycle-only challenge status is not an account response.

The helper waits for initialization before calling `complete(payload, signal)` with exactly:

```ts
{ requestRef, launchToken, state: 'ready', stage: 'initial_status', outcome: 'success' }
```

The `complete` adapter must return the actual host response. A ready account is returned only when the response is an object containing its own `completed: true` field. Missing acknowledgement, `void`, `{ success: true }`, or `completed: false` rejects with `miniapp_login_complete_unconfirmed`.

After a valid approval, exchange, initialization, or identity failures instead report `state: 'failed'` and `outcome: 'unavailable'`, with the same reference/token and stage. No account fields, exception details, or provider session data are sent. Failed completion is best-effort and preserves the original login error. An attempted ready completion is never followed by a contradictory failed completion or automatically retried; failed or ambiguous ready acknowledgements do not constitute login success.

All normal callbacks share one signal. `timeoutMs` is a positive integer up to 60,000 milliseconds (the default), bounded further by challenge expiry and readiness expiry. After approval, exchange, initialization, and the ready acknowledgement share the native maximum initial-status deadline of 15 seconds; this budget cannot be increased by options or capability fields. Earlier expiry or a shorter overall timeout still wins. External cancellation or deadline expiry stops progression even if an adapter ignores cancellation. Adapters must also honor the signal to stop their own late side effects. A failure report uses a separate signal, bounded to five seconds and the remaining readiness-token lifetime, so cancellation can still dismiss the host launch. Expired or malformed approvals are not completed.

The helper requires HTTPS and same-origin challenge URLs, and checks the actual document origin when available. The built-in HTTP helpers accept `signal`, retain `credentials: 'same-origin'` and `cache: 'no-store'`, and reject HTTP redirects. Custom exchange/status adapters must enforce the same bindings. Never put the launch token in a URL, perform a full-document redirect to continue a launch, log scoped IDs/request references/tokens, or send cookies or redemption secrets through the bridge. The helper does no navigation, logging, or token persistence. See the [security migration](../migration/security-2.md).

### Advertise launch readiness

Enable the service-manifest capability only after the provider uses this flow and the host supports both bridge contracts:

```ts
import { createUnetServiceManifest } from '@u-net/server';

const manifest = createUnetServiceManifest({
  serviceId: 'demo-shop', origin: 'https://shop.example', miniappLaunchReadiness: true,
});
// manifest.miniapp === { launchReadinessVersion: 1 }
```

The `miniapp` field is absent by default and when the option is false. This capability belongs to `/.well-known/unet-service.json`; it does not change the miniapp discovery manifest or permission policy. Native approval alone is not browser login success. SDK changes alone do not make an unchanged provider or mobile bridge ready for rollout.

Permissionless miniapps may publish `permissions: []`. They receive no scoped identity and all identity or attestation bridge calls are rejected.

## Checklist

- Use one verified HTTPS origin.
- Keep claim tokens and session secrets server-only.
- Store challenges, accounts, replay records, and sessions in the provider database.
- Keep the browser and miniapp on the same Direct Login implementation.
- Run the dashboard readiness checks before publishing.
