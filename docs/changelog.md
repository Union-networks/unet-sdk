# Changelog

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
