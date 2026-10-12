# Changelog

## 2.0.0-rc.4 (local candidate, unpublished)

- Added `runMiniappLogin` with callback-based host approval, browser-cookie exchange, authoritative account matching, initial-status initialization, and exact readiness completion.
- Required the host's explicit `{ completed: true }` acknowledgement before returning a ready account; validated native 64-hex readiness capabilities, fixed V1 fields, a maximum 30-second expiry, and a maximum 15-second post-approval initial-status deadline.
- Added abort propagation and redirect rejection to browser Direct Login HTTP helpers.
- Added opt-in service-manifest `miniapp: { launchReadinessVersion: 1 }` through `miniappLaunchReadiness: true`.
- Applied the fixed-version Changesets RC workflow to all eight canonical packages; root aligned to the same RC4 version. Compatibility forwarders retain their separate version train.
- Candidate handoff uses local RC4 web-login/server/client/contracts tarballs and `artifacts/2.0.0-rc.4-miniapp-manifest.json`, generated with `node scripts/write-release-manifest.mjs --miniapp`. Install those exact hashes together or with consumer-local overrides; packed internal dependencies use publish-compatible `^2.0.0-rc.4` ranges.

This is not a registry RC3 artifact or a trusted published RC4 release. Focused checks do not authorize stable promotion, publication, deployment, or a full release campaign. See the [miniapp readiness guide](guides/miniapp-ready).

## 2.0.0-rc.1 (prepared, unpublished)

- Coordinated major-version release candidate across all eight `@u-net/*` packages.
- Bound Direct Login exchange to per-attempt HTTP-only browser cookies; status exposes lifecycle state only.
- Required atomic approval/account binding and one-time exchange in provider stores.
- Added durable retirement cleanup with exclusive leases, retry backoff, and stale-worker fencing.
- Updated browser, React, and miniapp guidance without a legacy redemption fallback.

See the [security migration](migration/security-2.md) and [release preparation record](releases/2.0.0-rc.1.md). No publication or deployment is implied.

## 1.0.0-rc.2

- Published all eight Apache-2.0 SDK packages through npm Trusted Publishing with provenance.

## 1.0.0-rc.1

- Moved the public SDK to `@u-net/*`.
- Made Direct Login V2 the standard provider-owned login protocol.
- Added Ledger V2 exact reads, holder revocation, and issuer signing.
- Added provider-owned issuer delivery, official inbox, and aggregate metrics adapters.
- Added `@u-net/setup` for local key generation and registration bundles.
- Generated API documentation from package declarations and API Extractor reports.

See the [GitHub releases](https://github.com/Union-networks/unet-sdk/releases) for signed artifacts and provenance.
