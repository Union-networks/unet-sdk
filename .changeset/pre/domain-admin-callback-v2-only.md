---
"@u-net/issuer": patch
---

Security fix for the SDK 2 release-candidate domain-admin callback contract:
reject callback protocol version 1 with `protocol_upgrade_required` and require
signed V2 control authorization for issuance. The maintained provider routes map
the protocol-upgrade rejection to HTTP 426. The general callback implementation
no longer accepts HMAC authorization, even when its legacy secret option is
supplied. Existing helper exports are preserved; they are not a callback
authentication fallback.

`consumeControlNonce` is required at runtime as well as by the V2 adapter type.
Providers must implement atomic, durable nonce consumption shared across
replicas and retained across restarts. Missing nonce consumption, invalid
authorization and replay fail closed before credential issuance. This also
rejects malformed expiry/timestamps, duplicate authorization/challenge headers,
and missing V2 holder-revocation context.

This is an intentional security-related behavior break for legacy callback
callers. The credential schema ID `unet.provider.domain-admin.v1` is unchanged;
its suffix is not the callback protocol version. No existing credential is
changed, revoked or reissued by this patch.

Providers pinned to `@u-net/issuer@2.0.0-rc.2` must upgrade to a released package
containing this fix and verify their installed/bundled version. Unpublished SDK
source changes do not update those installations. Maintained Safety and
Supermarket route guards independently reject protocol v1 and HMAC callbacks
while using the installed RC2 dependency; they do not replace the SDK upgrade.

See `docs/concepts/domain-admin-callback-security.md` for migration requirements,
exact local test commands and fixture-versus-runtime coverage limits. No package
publication, deployment, nonce-store migration or production operation is
performed by this changeset.
