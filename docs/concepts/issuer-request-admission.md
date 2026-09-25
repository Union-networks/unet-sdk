# Recoverable Direct Issuer Admission

This is a staged SDK 2 change, not a deployed provider or Android acceptance
claim. Do not roll it out before the wallet and provider recovery work below.

## Wallet-Owned Delivery Secret

Before creating a request, the native wallet generates a random 32-byte bearer,
encodes it as base64url, and durably stores it with the complete pending issuance
intent. The public request supplies `deliveryCapabilityHash`, the lowercase hex
SHA-256 digest of the UTF-8 bearer string. Hashing the decoded bytes instead is
not equivalent. The bearer must never pass through miniapp JavaScript.

`createRequest` returns only `requestId`, `state`, and `replacementRequired`.
Retrying the same account-scoped idempotency key and semantic intent returns the
same reference. Changing a holder binding, delivery key/hash, revocation signer,
check, claims, or consent text returns `issuer_request_idempotency_conflict`.
JSON property order is immaterial. The first accepted consent timestamp is kept;
repeating the same consent later does not rewrite it.

Renewal authenticates with the existing parent delivery capability and requires
a fresh child hash. The persisted child binds `renewalOfRequestId`. A successful
renewal remains replayable even after its parent is revoked. This does not make
the parent renewable again, authorize a different intent, or reveal any bearer.

Existing stored credential capabilities are unchanged. A lost historical bearer
cannot be reconstructed from its hash. This change does not silently rotate
historical capabilities or authorize recovery using an exposed bearer.

## Provider Authorization And Atomicity

The HTTP adapter requires `authenticateAccount(request)`. The provider must
validate its own session, origin and CSRF protection and return the authenticated
`serviceAccountRef`. A missing authorizer fails closed. Caller-supplied account
references cannot override that principal. Request bodies are limited to 64 KiB
and five seconds; failures use finite codes and `Cache-Control: no-store`.

Stores implement `withAccountTransaction` and `findPending`. PostgreSQL pins one
connection, takes a transaction advisory lock for the exact account/check, and
locks applicable request rows. Pending and anchoring requests count toward
`deny`; `replace_after_delivery` waits for prior pending or ready delivery before
allowing a successor. Multiple delivered predecessors require reconciliation,
not an arbitrary choice. `parallel` still permits distinct requests.

Account-wide idempotency uniqueness also rejects collisions across checks. A
lost commit response is retried through the same admission path. No additional
credential, bearer, or idempotency record is generated for an identical replay.
Custom stores must implement real transaction semantics; there is no unlocked
fallback. The in-memory store is for tests and serializes transactions globally.

PostgreSQL provider subclasses can implement `beforeAccountTransaction` to take
their policy lock before the SDK account/check lock, and `createTransactionStore`
to retain publication guards on the transaction-bound instance. The factory must
return a fresh store constructed with the supplied guarded SQL client. Returning
the root, a previously bound store, or a store on another client is rejected.
The SQL client is closed when the callback ends; retained references cannot write
after commit or rollback. These hooks perform SQL only, never builds or network
calls. Providers must initialize their schemas before entering the transaction.

The private recovery journal also freezes `schemaId` along with validity and
signing-key context. A retry cannot replace that schema using a newer catalog
response. This is not yet a public recovery-worker API.

## Remaining Release Gates

- Persist native pending intents and secrets across Android main/miniapp
  processes before sending; retain and migrate required pending key material.
- Integrate Safety's policy/account locks, request, recovery journal and
  application projection in the same admission transaction. Providers must use
  the bound-store factory so their `create`/`update` guards remain in effect.
- Freeze credential configuration and validity; durably schedule issuance;
  coordinate issuer nonces and signed attempts with revocation operations.
- Replace the existing synchronous `approve` failure behavior and unfenced
  state writes with journal-based reconciliation and atomic publication.
- Atomically acknowledge delivery and enqueue predecessor revocation. Never
  lose replacement cleanup because a callback failed after acknowledgement.
- Verify the resulting provider and native wallet together, including crashes,
  account retirement, pending delivery, and physical-phone checks.

The admission tests do not close these gates. Production maintenance remains
enabled; stable publication and the messaging reset are not authorized by this
component result.
