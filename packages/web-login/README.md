# @u-net/web-login

Browser-safe helpers for creating, polling, and exchanging browser-bound Direct Login V2 challenges. SDK 2 requires a coordinated provider and miniapp migration; it has no session-ID redemption fallback.

```bash
npm install @u-net/web-login@next
```

```ts
import { createDirectProviderLogin, exchangeDirectProviderLogin, waitForDirectProviderLogin } from '@u-net/web-login';

const challenge = await createDirectProviderLogin(window.location.origin);
const result = await waitForDirectProviderLogin(window.location.origin, challenge.requestRef);
if (result.state === 'approved') {
  const exchanged = await exchangeDirectProviderLogin(window.location.origin, challenge.requestRef);
  if (!exchanged.success) throw new Error('direct_login_exchange_failed');
}
```

Status contains only lifecycle state. Exchange sends `{ requestRef }` with the originating browser's HTTP-only cookie. Approval alone does not establish your provider session. Native miniapp bridges approve the public WebView-created challenge; only the WebView exchanges it.

`runMiniappLogin<Account extends { scopedUserId: string }>(options): Promise<Account>` coordinates miniapp login and initial-status readiness. Supply `origin`, optional `signal`/`timeoutMs`, and async callbacks `createChallenge(signal)`, `approve(challenge, signal, context)`, `exchange(challenge, signal)`, `initialize(account, signal)`, and `complete(payload, signal)`. Exchange and initialization must both return the provider's authoritative account matching the host-approved scoped ID. Completion carries only `{ requestRef, launchToken, state, stage: 'initial_status', outcome }`; readiness is reported only after initialization. The helper never navigates or logs identifiers. HTTP helpers now accept `signal` and reject redirects while preserving same-origin cookies.

The exported `MiniappLoginApprovalContext` has a readonly `expiresAtMs` timestamp: the original deadline, bounded by overall timeout and challenge expiry. Pass it to `host.createServiceSession` as `{ requestRef: challenge.requestRef, publicChallenge: challenge, loginDeadlineMs: context.expiresAtMs }`. The host must honor that deadline before/after picker, biometrics and proofs; it must not start a new budget after authentication. Existing two-argument callback functions remain assignable, but native integrations require the deadline field.

The completion adapter must forward the host response; ready requires `{ completed: true }`, never `void` or a success-only response. Readiness has exactly the V1 fields `version`, `launchToken` (64 hexadecimal characters), and `expiresAtMs` (a future safe-integer Unix-millisecond timestamp at most 30 seconds away). Exchange, initialization, and ready acknowledgement share a maximum 15-second post-approval deadline. Overall `timeoutMs` is a positive integer at most 60,000 milliseconds.

See the [miniapp readiness guide](https://next.docs.egress.live/guides/miniapp-ready) for bridge adapters, approval/completion contracts, deadlines, and best-effort failure reporting. Providers advertise this capability only with `miniappLaunchReadiness: true` in their service manifest. This is an SDK implementation, not authorization to deploy or publish.

See [docs.egress.live](https://docs.egress.live) for guides and the versioned API reference.
