# Security-2 acceptance record

Updated 2026-09-17. This is an evidence ledger, not release approval.
Production login/direct messaging remain under maintenance. No production reset
or security-epoch activation has run. A missing result is not a pass.

## Candidate inventory

| Component | Reviewed/deployed candidate |
| --- | --- |
| SDK | `87fdc95112bf262e915ef11485eae8032ff662c8`, all eight packages `2.0.0-rc.2`; stable remains `1.0.0` |
| Messaging | `69c2811da190e95994862594f30f8e430154e5d7`, maintenance enabled |
| Trust/dashboard backend | `69534ce0f6910b382a070b408393746ff1ccd390` |
| Dashboard frontend | `b856e563bf90611e19720afc29485388b8bcc203` |
| Safety Center | `5286eaef48455efc4aa67674b493c1afd45c0cda`; Vercel `6MfaZ3dQ4BcnJcGPg7bvZFjgWFK3` |
| Supermarket | `fd75ef66acc8f5d906b15852753dfe66a3a889f6`; Vercel `gvApShTNecnyH8DyqhVr6bB3gggJ` |
| Android checkpoint | `d7a061a65d68c0630fa059cc8b5bdec391fe1e5b`; debug APK SHA256 `4ca40c0d4e4bcb26f2d882b9959b8da759a00d640d6ef63c836212d7623a04ed` |
| Isolated Android LAN candidate (not production) | Mobile `aa8aedd763b2d252e63f28730147d5128e7a14f6`; private build overlay SHA256 `472a1171d8f118f1715cf89cbec17dac7b9538129fa42821df1b114739853fc3`; APK SHA256 `13e206b372359c9094e0624993999c053af69dffff1a811b7b6dd9349f81ade2`; physical miniapp login/biometric retry reported, physical QR scan failed; replacement required |
| Isolated Android scanner replacement (not production) | Same mobile base plus overlay `a6e710ee4f41374a19f526a51ce797eebaabf382eebd58ae1879318b05cb04ca`; APK `924dc59029589877ff50c94517e43f3db691ee09f70139dc3db455595efa10f7`; compiled-artifact and native small/dense pixel-decoding checks pass on app-plane emulator; physical QR scan, approval and browser login passed per user report on 2026-09-17. Test-only decoder replacement is not production camera acceptance. |
| Ledger V2 logging | `ecead7bf931c132dda8cfbb3c599850073d7567c`; six containers, image `sha256:781e116d82b0918c503a370eac3f0af8ab8f07ae3422cd9a885b89128195273e` |

New tests and experimental source changes after these commits are NOT part of
these deployed artifacts. Rebuild and record a new immutable manifest before
claiming they are in a distributed application.

New reviewed source checkpoints, pushed but **not deployed or activated**:

- Mobile login/cancellation: `0e5bd09dd0da6093a862b522d70550d3a5adf484`.
- Android native identity generation: `6dc4d45bad0901e9047cdc1f55ca093055668758`.
- Messaging diagnostics/proof-error handling: `2b7ef980962c4d727465a8b801c3fc5a72198588`.

Author and committer are `Xevorius <tim.is@live.nl>` for all three. Production
branches and the installed emulator APK were not changed by these pushes.

## Finding-to-evidence matrix

| ID / finding | Implementation | Automated evidence | Deployed/device evidence | Remaining gate |
| --- | --- | --- | --- | --- |
| LOGIN: QR redemption theft | HTTP-only browser secret, hashed exchange binding, per-attempt cookie, transactional approval/consume; mobile signed same-attempt grants and guarded cancellation committed | SDK: 16 passing, including 8 real-PG cases; Chromium/PG: 14 Safety/supermarket and 9 grouped dashboard/mobile-client cases; real Android WebView: 3 provider cases; latest mobile 739 tests/80 suites plus typecheck; three additional isolated HTTPS browser runs | Providers remain under maintenance; isolated miniapp login and biometric cancellation/retry user-reported on APK 13e206b3; physical QR scan/approval/browser login user-reported on replacement APK 924dc590; automated browser approvals use synthetic Node signatures | Deployed Next.js and production native bridge; real cryptographic dashboard grants; complete maintained-provider acceptance on the release artifact |
| LAN TEST ISOLATION: controlled HTTP disclosure | Separate test package, private-CA-only Android policy; exact-origin/pin guard for RN/Expo Fetch and WebSocket; no trust bypass | Exact APK artifact/DEX checks and 53 native observations: 45 required pass, 3 port-blocked and 5 port-gap diagnostics; zero foreign-CA/cleartext HTTP receipts | Emulator only on APK above; real RN/Expo Fetch, WSS, WebView top/subresource, Expo Image and both FileSystem clients; Node WSS/PNG checks are separate fixture evidence | Physical execution pending; not an OS firewall, universal port restriction, production-network approval or proof of no DNS/TCP/TLS attempts |
| SENDER: unauthorized retirement/rebinding | Signed audience/epoch-bound management, immutable bindings, possession proofs | Authorization/replay tests; Android JNI-to-real-WASM run passes 18 checks including rejection/replay/retirement | Hardened messaging deployed under maintenance; private dynamic proof driver uses fixture ledger/policy and Node sender signing | Real wallet signing/issuer/EVM/policy integration, invitations and delivery; physical Android |
| LOGS: leaked capabilities | Header capabilities; route-template logging; owner-authorized rotation; ledger runtime hardened; further messaging/provider/Worker fixes local | Ledger 53 API/unit passes, ten disposable-EVM passes, real-pooler/logging canary; explicit/child logger, malformed URL, startup and Worker error tests | V2 ledger ecead7b deployed to six containers with bounded logs; initial trust/messaging sanitization deployed; debug gateway masked | Deploy remaining fixes, proxy/tracing inventory, retained-copy removal and capability invalidation |
| OFFLINE: retirement expires after five minutes | Durable signed retirement; transactional cleanup with leases/backoff | Real signatures delayed six minutes/three days accepted; 8 concurrent retries produce one job; completed replay stays complete; tampered operation rejected; 12 exact-provider process-crash checks pass, including immediate session invalidation | Safety and supermarket scheduled retirement routes observed returning HTTP 200 | Phone offline/restart/recovery; deployed callback/job completion |
| POLICY: expiry/suspension bypass | Exact chain and signed sanction freshness <=20 seconds across operations | 55 measured actual HTTP/PG checks: signed sanctions, expiry, send/fetch/ack, existing permits, lock waits and outages; 80 focused unit tests | Signed Safety refresh accepted; one fresh authority recorded; measured driver uses fixture ledger and prior authorization | Full Android/issuer/EVM integration and physical-device evidence |
| RESET: selective deletion and process races | Signed epoch; Android broker leases; durable rotation journal and CAS | Seven isolated native tests; 24 reset/CLI tests; two full-activity crash boundaries and concurrent miniapp writer-fencing pass; real HTTP/PG capability rotation recovers two interrupted acknowledgements | Disposable AVD with matching checkpoint APK, real app root/SQLite/broker and signed test activation; production reset disabled | Actual push delivery, remaining preservation cases, old writers stopped, production dry run, physical Android and approved artifact |
| PRIVACY: repeat presentations/chat correlation | Threat model documents stable commitments and delivery routing | No unlinkability proof or privacy fix claimed | Correlation remains | Separate measured prototype and reviewed privacy design |

## Execution evidence: 2026-09-17

The SDK test run used a disposable PostgreSQL 17 container, 256 MiB memory and a
tmpfs data directory, exposed only on U-chain loopback and forwarded to local
port 55439. Tests required database name `unet_security_test`, created random
schemas, and removed those schemas. No provider production database was used.

`webAdaptersPostgres.test.ts` verifies distinct browser cookie isolation, two
simultaneous tabs sharing a cookie jar, origin rejection, public-body and stored
record exclusion of the redemption secret, state-only polling, concurrent
single consumption, delayed signed retirement and completed-job replay.
It exercises Request/Response adapters, not an actual browser cookie engine.

Safety scheduled retirement verification inspected only HTTP method, fixed
route and status metadata; repeated GET /api/internal/retirements/process runs
returned 200. This proves the authenticated worker route runs, not that any
particular account cleanup or downstream callback completed.

The scheduled revocation route separately returned six HTTP 200 results in the
visible log window. Again, no credential values or log bodies were inspected.
Messaging reset rehearsal passed 24 tests, including transactional rollback,
concurrent resets, evidence conflicts, official data preservation and guarded CLI
execution. Signed requests passed 71 tests, access authorization four tests,
and policy 33 tests (27 database cases). The first policy run was rejected by its
test-only database password guard; after matching the disposable fixture, all
33 cases passed. These are component tests, not full Android acceptance.

Proxmox host inspection remains blocked: the available provisioning key was
rejected. A temporary owner-restricted local copy was removed after the attempt.
No host password, installed key or SSH policy was changed. Do not interpret an
empty VM proxy-service inventory as proof that the host proxy has no logs.

Counts-only scans of accessible logs found zero query-capability and bearer-value
markers in 218 current messaging container lines (24 hours), 1,706 trust-plane
journal lines (since yesterday), and seven retired debug-gateway journal lines
(since yesterday). No raw log rows were exported. These bounded pattern scans do
not cover tracing, historical copies, unrecognized encodings or the Proxmox host.
The scanner's synthetic canary test passed. No log copies were deleted in this run.

The reset CLI now requires the literal maintenance value `true`; absent, empty,
or malformed settings fail closed. Ten CLI guards and 16 database cases passed
in the subsequent full run. Its expanded CLI/database matrix exceeded the former
30-second harness limit; with 90 seconds for its multiple bounded child processes,
that remaining case passed separately. It verifies rejection against a reachable
database and unchanged rows, not merely failure to connect. Per-process deadlines
remain 15 seconds. This remains
an operator assertion, not discovery of other processes. Stop and drain every
API and worker writer before executing a reset. Official-inbox and device-route
operations remain available under ordinary direct-messaging maintenance.

The disk monitor reports an actual capacity warning, not a broken check:
U-chain is 88% used with 7.4 GB available. No broad Docker prune or volume deletion
was performed. Large rehearsal services must not be provisioned there without
an explicit capacity check.

Mobile environment overrides now use static Expo property access. Fourteen focused
regressions exercise actual dev/production transforms, trimming and fallbacks.
The full mobile run initially failed on undeclared Babel helper resolution; the
app now declares the already-locked runtime and Jest maps those helpers for shared
workspace source. One subsequent consent test timed out under load, passed alone
without a timeout change, and the final complete run passed all 567 tests across
65 suites. Mobile typecheck passed. No test-only module-path command override is
needed. These changes are not in the installed production U-net APK.

The private standards harness separately passes 50 tests with actual signatures,
signed requests and encrypted responses. OAuth authorization-code/PKCE issuance,
HTTP/mobile integration and independent EUDI interoperability remain unimplemented
or not tested. No standard-adoption approval or production migration follows from
these results.

An isolated Android lab shell was built on u-net and installed side-by-side on
emulator-5554. Source is checkpoint `d7a061a` plus lab-only overlay SHA256
`811a609923bab99201bc051ae1c546a37fc5f6b7f0cacd270c95c74c4ec5ffec`.
APK SHA256 is `b24ec1e061501d77bcfdd61745a5d22c2012632c17989be353d63dfd2828f08a`.
Package is `com.egress.unet.interop`; ABI coverage is x86_64 and arm64-v8a.
APK manifest/resources, backup exclusions, bundle-source allowlist and visual
launch checks passed. The first APK was rejected before installation because
dependency manifests added extra components; the corrected second build passed.
Production package/link metadata remained unchanged. The shell has no Internet
permission or protocol integration. OS UID isolation was observed, but lab-UID
storage/Keystore penetration and physical execution were not tested. This artifact
cannot satisfy the security candidate's full-activity acceptance requirements.

## Release gates

Additional private acceptance on 2026-09-17 uses actual Chromium 145 with the
maintained Safety/supermarket login and session modules plus SDK RC2: 14 cases
pass. Six grouped dashboard cases use exact dashboard and trust handlers;
Owner/Admin completion is synthetic, so only grant-to-attempt binding is covered.
All use disposable Postgres schemas. A small HTTPS fixture replaces Next.js
routing, so deployed middleware/proxy and native bridge acceptance remain open.

Dynamic Android JNI proofs for credential membership, persona and expiry pass
the actual messaging WASM verifier. Eighteen checks cover nonce/schema/key/
persona/expiry mismatch, proof tampering, replay, owner-signed retirement and
retired sender rejection. Ledger and policy remain explicit fixtures; sender
signatures are made by the Node driver, not the React Native wallet. The test
found a known proof-point decoder assertion incorrectly reported as unavailable.
A narrow local fix maps that exact input error to invalid while initialization,
CRS, traps and unknown failures remain unavailable. The rerun requires 403 for
the malformed proof followed by 200 for an intact proof. That fix is not deployed.

Actual Android MainActivity and MiniProgramActivity reset rehearsal completed
2026-09-17T07:27:53.949Z on a separate AVD, emulator-5560. It interrupts after
secure deletion/before SQLite commit and after commit/before native unlock,
launches a competing miniapp and verifies native writer fencing, then kills and
restarts the application. Both scenarios preserve synthetic scoped-account,
credential and official-update rows/secrets while deleting direct history and
secrets. Repeat startup is idempotent. The real React root, SQLite and broker run
with a signed disposable activation; only test seeding/barriers and biometric
bypass are added. UID-level IPv4/IPv6 rules block production egress. This proves
those startup persistence windows, not usable credential recovery,
physical-device biometrics or release approval.

The subsequent full-activity rotation run at 2026-09-17T07:45:49.582Z uses the
actual messaging server and disposable PostgreSQL. Process termination after
server acceptance but before local acknowledgement is recovered by the real
MiniProgramActivity startup for both read-capability rotation and encrypted
device-route renewal. Five client and 27 final server/local assertions pass;
repeated MainActivity startup does not add mutations. Old capabilities stay
invalid, the original mailbox/send/owner and encrypted update are preserved,
and encrypted route replay/revision checks pass. Only the FCM token source is
synthetic; actual push delivery remains untested. All owned fixture services,
tunnels and database state were removed or stopped after evidence capture.

Three Android WebView transport tests pass for Safety, supermarket and dashboard
using a separate test application, real provider handlers and PostgreSQL.
They verify HTTP-only cookies, observer rejection, independent attempts and
single-winner concurrent redemption. An app-scoped test CA is trusted only by
that fixture; certificate errors remain rejected. Wallet approval is synthetic
Ed25519, so these checks do not replace production scanner/native bridge or
deployed Next.js acceptance.

Twelve additional exact-provider retirement checks pass against private
PostgreSQL: a three-day-old signed operation invalidates an existing unexpired
session immediately, a real worker process is killed after partial child
cleanup, and replacement workers respect the lease and callback-failure
backoff. After recovery, completed delivery is idempotent. Safety queues both
historical children once and preserves evidence; supermarket state is deleted
and cannot be recreated by the retired account. Test SQL advances lease and
retry timestamps; deployed worker scheduling and chain finality are not tested.

The actual mobile client exposed missing signed Owner/Admin selections, obsolete
V2 grant-status polling and permissive approval-response handling. Local fixes
add exact-attempt account signatures, proof-result feedback, strict success/QR
validation and authorization rechecks after asynchronous key/signature work.
The earlier mobile suite passed 591 tests across 66 suites plus typecheck. Nine
dashboard/Chromium/Postgres groups include the real mobile client canonical
signing. Storage/discovery are adapted and grant proof completion is synthetic.
Independent reviews then found cancellation gaps inside asynchronous account,
proof and credential-context helpers. Follow-up suites reached 621 tests across
69 suites. The consolidated helper guard run subsequently passed 644 tests in
73 suites with typecheck; independent review passed 113 focused tests and found
one remaining scanner additional-account cancellation path. That path is now
fixed and independently reviewed: 11 mounted scanner tests pass, including the
real additional-account helper with synthetic native/storage/provider leaves.
That mobile checkpoint passed 655 tests across 74 suites and typecheck. Native
identity-generation fixtures separately pass 35 cases; no Kotlin compilation or
installed variant is inferred from those fixtures.
These evolving local counts do not approve an APK or deployed native bridge.

The user confirmed their Android phone can share the home LAN with the laptop,
then clarified it is their main RedMagic 8 Pro on Android 15, not a spare. Only a
separately isolated test application may be used; the normal wallet must remain
untouched if installed. The user subsequently confirmed there is currently no
active U-net installation on the phone. A private test configuration input gate
passes 28 cases. A separately signed, offline-only ARM64/x86_64 APK now passes
native build, release lint, artifact checks and emulator startup. Its SHA-256 is
`eda9d6731ff3a238428fec13377b8b9d35fd0ab543fc6160b5d6215937efb8d4`.
On 2026-09-17 the user reported all physical startup checks passing, including
the real biometric prompt, cancellation/retry, cold/airplane-mode startup and
resume. This closes only offline startup; no measured phone latency was supplied.
Networking and cloud messaging are absent from that APK. Actual login, issuance,
proofs, messaging, capability rotation and reset on the phone remain unapproved.
The offline-startup source checkpoint was `08f39ad4b90be823230f2014c619704a40184803`
on the security branch, with 686 tests across 75 suites and typecheck passing.
No global phone CA installation or production-data reset was performed.

### Isolated Android LAN and browser continuation

The subsequent mobile checkpoint is
`aa8aedd763b2d252e63f28730147d5128e7a14f6`, with private build overlay SHA256
`472a1171d8f118f1715cf89cbec17dac7b9538129fa42821df1b114739853fc3` and APK SHA256
`13e206b372359c9094e0624993999c053af69dffff1a811b7b6dd9349f81ade2`.
This is the isolated `com.egress.unet.securityacceptance` application, version
code 2, scope `scanner-login-only`, not a production wallet release. The recorded
full mobile run passed 739 tests across 80 suites and typecheck. Compiled artifact
checks cover identity, signer, embedded CA, backup/deep-link configuration and
native libraries; all three DEX files lack the old URL-bearing WebView SSL warning
and contain the replacement fixed diagnostic. This does not close the wider log
inventory or retained-copy remediation gates.

On that exact APK, all 53 native observations completed: 45 required cases passed,
three same-CA other-port probes were blocked and five showed the documented NSC
port gap. All foreign-CA and cleartext HTTP counters were zero. RN Fetch, Expo
Fetch, WebSocket, WebView top-level/subresource redirects, Expo Image and modern
and legacy FileSystem used real clients and controlled sinks, never production
targets. Positive baselines and redirect/page counters were required. Fixture
certificates were corrected to use distinct CA/leaf subjects; ordinary probe HTTP
responses now close explicitly, with native retries still disabled. Earlier
certificate, counter-read and timeout failures are not retroactively passes.
Independent strict-CA WSS echoes and PNG decodes establish only fixture health.
This evidence is not an OS firewall, a universal port restriction, arbitrary-host
coverage or an assertion that no DNS/TCP/TLS attempts occur.

The exact APK subsequently completed Discover -> fixture supermarket -> Allow
and Open -> Sign in -> Authenticated after the main-process WebView probes,
without restarting the application. This exercised actual wallet/native bridge
approval, browser-owned exchange and maintained provider-session cookie validation
against disposable PostgreSQL. The LAN-only WebView process-directory correction
was therefore exercised in that sequence. No biometric was enrolled on the
emulator: biometric approval, denial/retry and real camera scanning remain open.
The synthetic registry does not establish production domain verification.

Separately, three actual HTTPS browser runs exercised maintained provider handlers
and disposable PostgreSQL: Secure/HTTP-only attempt cookies, copied-reference
observer rejection, cancellation/late approval without redemption, fresh retry,
replay rejection, independent tabs and provider-session validation. QR images were
rendered, not scanned, and approval signatures came from synthetic Node keys.
These browser results do not establish native QR or Owner/Admin proof acceptance,
deployed Next.js middleware/proxy behavior or production approval.

Private evidence, not bundled with the SDK: under `audit-2026-09-17/physical/`,
`LAN-RUNTIME-EVIDENCE.md`, `lan-native-probe-13e206b3.json`,
`lan-artifact-13e206b3.json` and `PHONE-LOGIN-CHECKLIST.md`. The artifact audit's
static flags are not runtime or phone acceptance; use the separate execution
record for the emulator result. The user reported installation, miniapp login,
biometric cancellation and successful retry on the RedMagic 8 Pro, Android 15.
The subsequent physical camera QR test **failed**: the camera preview continued
without decoding or opening login consent. The isolated build removed ML Kit
initialization needed by Expo's bundled barcode analyzer. Replacement APK
`924dc59029589877ff50c94517e43f3db691ee09f70139dc3db455595efa10f7`
uses the isolated ZXing decoder and corrected SDK QR wire format. On 2026-09-17,
after receiving its install and fresh camera-scan instructions, the user reported
"Yes, Everything now works". This closes the isolated physical QR-login retest
as user-reported, without timings; it does not establish production camera
acceptance or rerun every prior miniapp/biometric check on the replacement.
Browser rendering and mocked scanner callbacks alone do not close physical
failures. Earlier offline phone startup evidence is not
network-enabled phone acceptance. Issuance, proofs, messaging, push, policy,
rotation and reset are not closed by this login-only continuation. No production
activation, reset, stable SDK promotion or final release acceptance is claimed.

Measured messaging acceptance completed 55 checks in 235.727 seconds. With
existing unexpired permits, affected guards first observed revocation by
15.969 seconds; exact-ledger outage by 15.699 seconds and policy-heartbeat
outage by 10.400 seconds, relative to the test event. All event+20-second and
post-original-lease samples rejected. Caches were already several seconds old
at event time; these are sampled bounds, not exact transition instants. Three
real PostgreSQL lock waits crossed a policy deadline and send/fetch/ack all
failed unavailable without message mutations. Outages recovered without reset
or false revocation. The test used signed policy operations but a controllable
ledger HTTP fixture and SQL-seeded prior authorization, not deployed EVM/proof
issuance. PostgreSQL was approximately 3.1 seconds ahead of the client clock;
this skew is disclosed and no host clock was changed.

The wider logging audit found retained identifier/secret-like markers in trust
journals and syslog copies, plus default ledger URL logging. V2 ledger logging
was subsequently deployed at ecead7bf931c132dda8cfbb3c599850073d7567c after
reviewed canary failures exposed pooler and TLS-alias compatibility issues.
All six updated containers preserve configuration and use bounded logs. Public
health, network/configuration, summary and both relayer negative checks pass;
four validators are online and index lag is zero at the observation. No ledger
transaction or messaging reset was performed by this rollout. Fixes cover
ledger root/child logging, fixed public errors, bounded failed-startup
cleanup, provider initialization failures, messaging startup and awaited Worker
storage failures. These source changes do not sanitize historical copies or
independent platform traces. Proxmox console-only counts inspection has been
requested. All three maintained Vercel projects were inspected read-only: no
associated drains or configured trace-sampling rules. This does not prove
session tracing, platform request logs or historical copies are clean.
Cloudflare telemetry and retained-copy remediation remain open.

- Every security-critical automated, full-activity and physical Android result
  must refer to the final candidate, with failures and not-run cases explicit.
- Maintain separate approval for login reopening and messaging activation.
- Before reset, freeze commits, package integrity, build/bundle source, chain
  contracts, proof pins and signed epoch. Rehearse using disposable data first.
- The current mobile reset configuration is disabled and its release trust-key
  map is empty. Test configuration must explicitly pin a disposable signing key;
  production activation is a separate reviewed change. The checkpoint APK is
  x86_64; compiled ARM64 libraries alone are not a physical-device APK.
- Reset only direct chat/history/secrets; preserve credentials, scoped accounts,
  official subscriptions/updates, domain access, evidence and Ledger V2.
- Old capabilities become invalid; retired sender tombstones persist.
- Rollback never restores vulnerable authentication or unsigned endpoints.
- iOS is not approved; unavailable iOS evidence is not an Android test failure.

## September 17 Mobile Authorization Follow-Up

Local mobile checkpoint `d8524e09555cd6c83b138a11c99bd93ad02490c6` fixes
authorization dispatch after cancellation during key reads, queued-clear stale
token reuse, proof cancellation/expiry boundaries, unbounded verification-key
lookup and transport single-flight registration. Key retries receive synchronous
operation admission. Accepted bindings remain available for retirement without
restoring cleared grants, while reset gates prevent late metadata recreation.

Final verification: **777 Jest tests across 83 suites**, TypeScript and diff
checks pass. These are application/unit checks, not new native, multiprocess or
deployed messaging acceptance. The earlier physically accepted scanner APK is
unchanged and does not contain this checkpoint. Author/committer are both
`Xevorius <tim.is@live.nl>`; checkpoint is local, not pushed or deployed.
Private detailed evidence: `audit-2026-09-17/MOBILE-AUTHORIZATION-CONTINUATION.md`.
Fresh public provider checks still find maintenance closed and coherent manifests;
they do not prove successful production authentication.

## September 17 Wallet-To-Messaging Native Check

An isolated Android runner now exercises actual wallet secret generation,
encrypted synthetic credential import, native generic proofs and real messaging
authorization against disposable PostgreSQL and the bb.js 4.2.0 WASM verifier.
The final tested APK hash is
`94fa8106aa3e2376995cb2e5537a45fd4d515ebdd2440526fa35311a603fd4ee`;
it is a versionCode 3 acceptance build, not the production wallet.

On a fresh app-plane Android API 34 emulator, the cold fixture run completed
sender registration, unsigned-registration rejection, authenticated retirement,
retired-key rejection and local cancellation of the old grant. Independent
database counts corroborated a consumed authorization challenge and retired
sender, with no remaining authorization. Device-authentication cancellation
created no additional credential or challenge. The successful run used an
emulator fingerprint; the normal PIN fallback was not disabled.

Ledger and sanction responses are explicitly fixtures. The test uses a separate
RN entry, not the full application router or concurrent miniapp activities.
It does not close EVM/status-freshness, invitations/delivery, reset/rotation,
physical-device or full-activity acceptance. Production remains unchanged.
An earlier attempt failed before any server challenge with an over-sanitized
error; its cause is not established. A later cold run passed, but that failure
remains recorded rather than being retrospectively labelled a timeout.

Public source contains reproducible configuration and artifact gates; private
run evidence is `audit-2026-09-17/mobile-messaging/EVIDENCE.md`. Artifact receipts
keep runtime and release-approval flags false; observed results are recorded
separately against exact build hashes. No production reset or activation occurred.

Local source checkpoints are mobile
`0386b49decf2a0a59765a0a56b0353530904614b` and messaging fixture
`adfa6e766a98ad7621ae31213c7df36d8684d06c`, both authored/committed as Xevorius.
The APK precedes these checkpoints and is identified by its base-plus-overlay
receipt, not represented as a clean checkout build. Final mobile verification is
821 Jest tests / 85 suites and TypeScript; acceptance variant gates add 101 Node
tests, and the fixture adds 12 tests plus TypeScript. A second fresh-wallet run
also completed all stages. Temporary services and the disposable database were
removed; no source checkpoint was pushed or deployed.

## September 17 Messaging Delivery Follow-Up

Local checkpoints (not pushed, deployed or activated):

- Mobile: `b6e0670b8a066a648cf7eecd373ccc96c3f9a7fe`.
- Messaging: `35e5764e0840ccac6f91732c5ddc8f55a42e869d`.
- Both author and committer are `Xevorius <tim.is@live.nl>`.

Recipient inactivity is now distinct from the caller's credential lifecycle,
including transaction-time binding and policy checks. Mobile preserves its own
credential and unrelated chats for peer failures, but reconciles genuine local
expiry, suspension and revocation during permit, send, fetch and acknowledgement.
Storage cleanup failures cannot replace the original operation error. Mailbox
pagination now retains PostgreSQL microsecond precision and a message-ID tie
breaker; existing timestamp checkpoints include their boundary when upgrading.

Verification passed: 850 mobile Jest tests / 85 suites, a focused 38-test delivery
rerun, mobile and messaging TypeScript, 305 messaging tests / 20 suites with real
disposable PostgreSQL, and 12 separate Node fixture tests. Two opt-in existing
proof-vector tests were skipped in the messaging run. An earlier all-suite attempt
passed 269 tests but failed two suite-discovery checks because Vitest collected
Node-runner fixtures; test discovery is now explicitly separated.

The route integration obtains authorizations through signed challenge/authorize
requests rather than SQL-seeded grants. It covers two-way invitations, permits,
send/read/ack, duplicate delivery, mailbox isolation, terminal retirement,
recipient suspension/revocation, dependency failure and recovery. Proof success,
ledger HTTP responses and policy are injected: these results do not close the
native two-wallet or production-chain acceptance gaps. Real-PG pagination tests
cover 201 equal-timestamp rows, submillisecond timestamps, checkpoint progress,
malformed inputs and retained Bearer-capability requirements.

Separately, all 10 deployed EVM tests passed on a disposable Besu 25.11.0 QBFT
chain against ledger source `ecead7bf931c132dda8cfbb3c599850073d7567c`: governance,
replay/domain/expiry rejection, issuer rotation/suspension/recovery/retirement
and holder revocation. There were 89 successful and 42 reverted transaction
receipts. This single-validator test chain is not the production network or
evidence of four-validator fault tolerance. All temporary containers/networks
were removed; no production reset, transaction or activation occurred.

Newly identified open release work: durable same-consumer invitation recovery
after a lost consume/send response, and bounded recovery from a queue whose first
200 envelopes cannot be decrypted. The mobile recovery design is explicitly
unimplemented in `docs/security/pending-invitation-recovery.md` in the app-plane
repository. No new APK or physical-device messaging result accompanies these
checkpoints. Full-activity reset/rotation, physical messaging, release-manifest
freeze and cutover remain open; iOS remains unapproved.

Private evidence: `audit-2026-09-17/messaging-pipeline/EVIDENCE.md` and its
ownership-checked disposable PostgreSQL runner.

## Standards Evaluation Boundary

The isolated standards lab is not a prerequisite for reopening a proven secure
Android release. It is not part of the stable SDK train and cannot authorize
production login, credentials or messaging. Keep comparative results and fit
gaps separate from the security acceptance matrix.
