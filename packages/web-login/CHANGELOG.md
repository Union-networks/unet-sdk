# Changelog

## 2.0.0-rc.4

### Patch Changes

- Pass the original overall/challenge deadline to approval as the third typed
  `MiniappLoginApprovalContext` argument. Native adapters forward `expiresAtMs`
  as `loginDeadlineMs`; elapsed picker/authentication/proof time cannot reset the
  deadline. Existing two-argument callback functions remain assignable.

- Add the browser-safe generic runMiniappLogin callback flow with authoritative
  account matching, bounded abort/deadline handling, and exact host launch
  completion payloads. Preserve initiating-WebView cookies, reject redirects, and
  propagate AbortSignal through Direct Login HTTP helpers.

  Advertise service-manifest miniapp launchReadinessVersion 1 only when the provider
  explicitly enables miniappLaunchReadiness. This coordinated RC candidate is for
  local hash-pinned provider integration; it is not stable-release acceptance or
  authorization to publish or deploy.
- @u-net/client@2.0.0-rc.4
- Require an explicit `{ completed: true }` ready acknowledgement. Validate fixed
  V1 readiness fields, a 64-hex native capability, a maximum 30-second expiry,
  and a maximum 15-second post-approval initial-status deadline. Reject arbitrary
  oversized or fractional timeout options; keep completion's exact five fields.

## 2.0.0-rc.3

### Patch Changes

- @u-net/client@2.0.0-rc.3

## 2.0.0-rc.2

### Patch Changes

- @u-net/client@2.0.0-rc.2

## 2.0.0-rc.1

### Patch Changes

- Prepare the coordinated SDK 2 release candidate with refreshed API reports,
  browser-bound exchange examples, and lease-token-fenced retirement cleanup
  migration guidance. Update the PostgreSQL regression test to use claimed leases.
  No session-ID redemption or legacy store compatibility is restored.

  This candidate is packed for provider integration testing only. Publication,
  deployment, session invalidation, and the maintained-provider integration matrix
  remain separate coordinated release gates.
- @u-net/client@2.0.0-rc.1

## 2.0.0-rc.0

### Major Changes

- Bind Direct Login redemption to a per-attempt HTTP-only browser cookie. Status
  returns lifecycle state only; exchange accepts requestRef, never sessionId.
  Approval/account binding and exchange are transactional in the PostgreSQL adapter.
  Retirement accepts delayed signed operations and persists provider cleanup jobs.

  This change belongs to the coordinated 2.0.0 release-candidate train. Do not
  promote or deploy without updated providers, dashboard proxies, mobile miniapp
  bridge, session invalidation, and maintained-provider integration tests.

### Patch Changes

- @u-net/client@2.0.0-rc.0

## 1.0.0

### Major Changes

- 5489e6a: Publish the Sovereign Core V2-only U-net SDK under the permanent `@u-net` namespace.

### Patch Changes

- Updated dependencies [5489e6a]
  - @u-net/client@1.0.0

## 1.0.0-rc.2

- Published the Apache-2.0 release candidate through npm Trusted Publishing with provenance.

## 1.0.0-rc.1

- Published under the permanent `@u-net` namespace.
- Adopted the Sovereign Core V2 public API.
- Removed central V1 relationship APIs.
