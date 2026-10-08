# Credential Delivery Transport And Exposure Gate

For the subsequently staged hash-only creation and renewal contract, see
[Recoverable Direct Issuer Admission](./issuer-request-admission.md). The
header-only transport patch described below does not by itself implement that
native-wallet/provider recovery integration.

## Header-Only Contract

The SDK 2 release-candidate delivery adapter and Safety delivery route accept:

```http
GET /api/unet/attestations/delivery?requestId=<opaque-request-id>
Authorization: Bearer <delivery-capability>
```

The request ID remains opaque and is URL-encoded by the client. The header must
contain one Bearer credential, without extra tokens, combined credentials or
alternate authentication schemes. Missing or duplicate request IDs are rejected.
Any `deliveryCapability` query parameter is rejected, including empty, repeated,
percent-encoded parameter names and requests that also supply a valid header.
There is no fallback to the legacy query transport. Successful response payloads
are unchanged and delivery responses, including failures, carry `Cache-Control:
no-store`. SDK public exports are unchanged.

The SDK returns exact known service/adapter error codes only; unknown exceptions
become `503 direct_issuer_request_failed`. Safety retains its `message` response
field, exposes only its exact delivery/policy rejection codes, and otherwise
returns `503 provider_temporarily_unavailable`. Neither touched error boundary
logs the exception, its cause, request URL, or authorization header.

ACK, renewal and revocation request authorization are not changed by this fix.
Existing credential commitments, ciphertext, holder keys, delivery capabilities,
and wallet storage are not reset, rotated or invalidated. Legacy GET clients must
be updated as part of a coordinated release; they will fail closed afterward.

## Open Historical Exposure Gate

Moving credentials out of future request URLs does not clean existing browser,
proxy, server, telemetry, support, cache, or backup history. A previously exposed
delivery capability may still authorize credential delivery, ACK, renewal or
issuer-revocation fallback. A URL change alone must not be reported as completing
incident recovery, invalidating old capabilities, or making release safe.

Production deployment, publishing, log cleanup and capability invalidation remain
paused pending owner review. Any evidence collection must avoid copying the
capabilities into new reports. Header logging/redaction also needs verification
at the actual transport/edge boundary before release.

## Separate Credential-Preserving Recovery Proposal

1. Inventory affected deployments and exposure periods using access-controlled,
   redacted evidence. Identify every consumer of the capability, not only GET.
2. Design replacement-capability authorization using an independently trusted
   holder/account channel. Possession of the potentially exposed old capability
   alone must not authorize replacement or recover the new credential. Agree on
   delivery, ACK, renewal and issuer-revocation fallback authorization together.
3. Replace the capability hash on the existing issuance record and securely
   update its wallet reference. Preserve the credential commitment, encrypted
   envelope, holder/revocation keys and on-chain state. Specify atomic/versioned
   transitions, retry handling and recovery for offline wallets before migration.
4. Require the old capability to fail all associated operations after cutover,
   while the authenticated holder can still retrieve/acknowledge the original
   credential and use the approved fallback. Test interrupted migration and
   rollback without restoring an exposed capability's authority.
5. Approve an explicit production plan for migration and evidence retention or
   log redaction separately. Never reset or revoke credentials merely to change
   the delivery transport.

This is a proposal only. No recovery mechanism or production migration is
implemented or authorized by the header-only patch.
