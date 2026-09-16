# Changelog

## 2.0.0-rc.1

### Patch Changes

- Prepare the coordinated SDK 2 release candidate with refreshed API reports,
  browser-bound exchange examples, and lease-token-fenced retirement cleanup
  migration guidance. Update the PostgreSQL regression test to use claimed leases.
  No session-ID redemption or legacy store compatibility is restored.

  This candidate is packed for provider integration testing only. Publication,
  deployment, session invalidation, and the maintained-provider integration matrix
  remain separate coordinated release gates.

## 2.0.0-rc.0

### Major Changes

- Bind Direct Login redemption to a per-attempt HTTP-only browser cookie. Status
  returns lifecycle state only; exchange accepts requestRef, never sessionId.
  Approval/account binding and exchange are transactional in the PostgreSQL adapter.
  Retirement accepts delayed signed operations and persists provider cleanup jobs.

  This change belongs to the coordinated 2.0.0 release-candidate train. Do not
  promote or deploy without updated providers, dashboard proxies, mobile miniapp
  bridge, session invalidation, and maintained-provider integration tests.

## 1.0.0

### Major Changes

- 5489e6a: Publish the Sovereign Core V2-only U-net SDK under the permanent `@u-net` namespace.

## 1.0.0-rc.2

- Published the Apache-2.0 release candidate through npm Trusted Publishing with provenance.

## 1.0.0-rc.1

- Published under the permanent `@u-net` namespace.
- Adopted the Sovereign Core V2 public API.
- Removed central V1 relationship APIs.
