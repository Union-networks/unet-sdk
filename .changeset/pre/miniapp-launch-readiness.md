---
"@u-net/web-login": patch
"@u-net/server": patch
---

Add the browser-safe generic runMiniappLogin callback flow with authoritative
account matching, bounded abort/deadline handling, and exact host launch
completion payloads. Preserve initiating-WebView cookies, reject redirects, and
propagate AbortSignal through Direct Login HTTP helpers.

Advertise service-manifest miniapp launchReadinessVersion 1 only when the provider
explicitly enables miniappLaunchReadiness. This coordinated RC candidate is for
local hash-pinned provider integration; it is not stable-release acceptance or
authorization to publish or deploy.

Ready requires the actual host acknowledgement `{ completed: true }`. Validate
exact V1 readiness fields, a 64-hex native capability and at most 30-second future
expiry. Exchange, initialization and acknowledgement share a maximum 15-second
post-approval deadline; overall timeout is a positive integer at most 60 seconds.
