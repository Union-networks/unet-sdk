# Manual attestation verification V2

These additive helpers are prepared for the coordinated `2.0.0-rc.5` release;
preparation does not mean publication or production acceptance.
Existing `createVerificationSession` and `pollVerificationResult` helpers still use
the legacy V1 protocol; they are not fallbacks for manual V2 verification.

## Public challenge, private results

`POST /v2/verification-sessions` creates a ten-minute public challenge and returns
separate private polling authority. Display **only `qrPayload`**. Keep
`resultReadCapability` in the initiating app's private state. Never put it in QR
codes, URLs, chat messages, analytics, logs, or generic debug output.

```ts
import {
  createVerificationV2Session,
  pollVerificationV2Result,
  getVerificationV2Jwks,
  verifyVerificationV2Receipt,
} from '@u-net/verification';

const verifierBaseUrl = 'https://verifier.egress.live';
const session = await createVerificationV2Session(
  { requestTypes: ['age_over_18'], title: 'Age check' },
  { verifierBaseUrl },
);
// Render session.qrPayload, not the session object.
const controller = new AbortController();
// Abort on closure/backgrounding. Start one new controller on foreground return.
const result = await pollVerificationV2Result(
  { sessionId: session.sessionId, resultReadCapability: session.resultReadCapability },
  { verifierBaseUrl, signal: controller.signal, intervalMs: 2_000, timeoutMs: 120_000 },
);
if (result.receipt) {
  const jwks = await getVerificationV2Jwks({ verifierBaseUrl });
  const historical = await verifyVerificationV2Receipt(result.receipt, {
    verifierOrigin: verifierBaseUrl,
    audience: session.audience,
    sessionId: session.sessionId,
    requestRef: session.requestRef,
    nonce: session.nonce,
    requestedChecksDigest: session.requestedChecksDigest,
    requestTypes: session.requestedChecks.map(check => check.requestType),
    expiresAt: session.expiresAt,
  }, jwks);
  // Display historical.checkResults with historical.checkedAt ("verified at").
  // A historical success does not authorize any current operation.
  void historical;
}
```

SDK reads have a ten-second transport/body deadline. Submissions have a 65-second
transport deadline, covering the server's sixty-second verification budget.
Polling is non-overlapping, abortable, and bounded; it defaults to two seconds
between requests and two minutes overall. The caller owns foreground scheduling.
Polling authority travels only as `Authorization: Bearer`, with redirects disabled.

A fully validated HTTP 503 `unavailable` status with `retryable: true` is returned
as structured state after its session binding is checked, never as success or
revocation. Malformed statuses are rejected; other errors expose only fixed
allowlisted `verification_*` codes, not their original payloads. Retrying a
submission still requires explicit consent and current wallet lifecycle checks.
Sessions request one to eight distinct check names in their original order.
Route references use 20-160 URL-safe characters; polling capabilities use exactly
43 URL-safe characters. Proofs retain the pinned encoding and bounded input/body
shape expected by the verifier, not arbitrary holder or JWS fields.
The total UTF-8 submission JSON body must also fit the route's four-MiB limit.

## Consented proof submission

The wallet uses `getVerificationV2Challenge(requestRef, options)` to fetch immutable
approved check metadata, including the signed `valid_until` expiry predicate.
`verificationV2RequestedChecksDigest` hashes recursive canonical JSON: object key
order is normalized, **array order remains significant**. Retrieved challenges are
checked against this digest before use.

The wallet selects only consented checks, revalidates its account/credential
lifecycle, and generates proofs through its existing native prover. Submit with
`submitVerificationV2Response(requestRef, submission, options)`. Each approved
check includes matching predicate and expiry proofs; denied checks include no
credential. There is no holder/user ID, central holder registration, holder JWS,
wallet inventory, or issuer private key in this submission.

Keep `submissionId` and the approved submission immutable for explicit recovery.
The SDK never automatically retries proof submission or silently downgrades to V1.
Cancellation prevents subsequent disclosure; after interruption, retry requires
current consent and lifecycle checks. Missing signed expiry evidence requires
normal renewal/replacement, not an unsigned expiry assertion.

## Historical receipts and trust

`verifyVerificationV2Receipt` requires independently trusted challenge bindings
and a JWKS obtained from that verifier's configured HTTPS origin. Do not derive
the expected origin, nonce, checks or session from the receipt itself or from
untrusted chat-result fields. The result key endpoint is
`/.well-known/unet-verifier-jwks.json`.

Receipts use compact JWS with exactly `alg: EdDSA`,
`typ: unet-verification-result+JWT`, and a known `kid`. Verification rejects extra
header/payload/result fields, incorrect origin/audience/session/nonce/digest,
incorrect SHA-256 UTF-8 request-reference hash, missing/extra checks, unknown or
revoked keys, and algorithm/key confusion. Retained keys may verify old receipts.
Receipts are limited to 32 KiB and eight terminal outcomes. Status/reason pairs
must agree; unavailable outcomes are never signed terminal results. Nonces use
62 lowercase hexadecimal characters, and timestamps use canonical UTC ISO format.
`checkedAt` may not be more than thirty seconds in the future or later than the
trusted challenge expiry when supplied. Receipts do not expire merely because
they are old: they attest to a historical check, not current credential validity.

Ed25519 and SHA-256 use the client's existing Noble dependencies; no WebCrypto,
Node `Buffer`, issuer package, or Barretenberg backend is required at runtime.
Node 20/22, current browsers and compatible React Native runtimes use the same
wire format. Proof generation stays native; proof verification stays server-side.

Card-back QR scanning remains an exact Ledger V2 **status lookup**, not proof of
credential ownership or claims. Selective disclosure is not unlinkability;
stable proof commitments and infrastructure observations can still correlate.
