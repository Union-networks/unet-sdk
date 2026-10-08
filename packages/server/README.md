# @u-net/server

Node-only provider SDK for Direct Login V2, provider-owned sessions, service manifests, official inboxes, messaging automations, and aggregate metrics.

```bash
npm install @u-net/server@next
```

```ts
import { createDirectLoginService, createDirectLoginWebHandlers } from '@u-net/server';
```

SDK 2 requires `serviceId`, `origin`, `service`, `accountStore`, and an `exchange` callback in `createDirectLoginWebHandlers`. The callback creates your provider session after atomic consumption and returns its HTTP-only cookie; callback failure requires a fresh attempt. Preserve the per-attempt Secure HTTP-only browser cookie through your routes. Status returns only lifecycle state and exchange accepts `{ requestRef }`, never a session ID.

PostgreSQL stores require a pool with `connect()`. Run `ensureDirectLoginSchema` and schedule `retryRetirementCleanup()` on a durable worker. Custom stores must implement exclusive `claimRetirements(limit)` and lease-token-fenced completion/failure. Retirement tombstones remain permanent; cleanup callbacks must be idempotent.

See the [server quickstart](https://next.docs.egress.live/quickstarts/sign-in-with-unet) and [SDK 2 migration](https://next.docs.egress.live/migration/security-2). The `2.0.0-rc.1` candidate is prepared but unpublished, including its documentation; upgrade providers, dashboard proxies, and mobile bridges together, without a v1 compatibility fallback.

See [docs.egress.live](https://docs.egress.live) for guides and the versioned API reference.
