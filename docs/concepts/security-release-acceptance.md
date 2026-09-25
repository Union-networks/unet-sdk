# Security-2 acceptance record

Updated 2026-09-25. This is an evidence ledger, not release approval.
Production login/direct messaging remain under maintenance. No production reset
or security-epoch activation has run. A missing result is not a pass.

Latest local Android source is `80c0b690abbfa0946ee37a58703da2457d006f94`,
including the offline native-prover candidate and the legacy-reset SQL fence.
It is not deployed. The new full-activity recovery build passes all three isolated
offline crash cases, warm resumes and repeat startups; full release acceptance
remains open. A fresh genuine JNI-to-WASM/EVM run now passes authorization and
old-grant registration revocation checks; full-wallet sender signing and
send/fetch/acknowledgement acceptance remain open.
See the September 25 follow-up sections below; earlier component passes do not
override these open release gates.

## Candidate inventory

| Component | Reviewed/deployed candidate |
| --- | --- |
| SDK | `87fdc95112bf262e915ef11485eae8032ff662c8`, all eight packages `2.0.0-rc.2`; stable remains `1.0.0` |
| Messaging | `69c2811da190e95994862594f30f8e430154e5d7`, maintenance enabled |
| Trust/dashboard backend | `69534ce0f6910b382a070b408393746ff1ccd390` |
| Dashboard frontend | `b856e563bf90611e19720afc29485388b8bcc203` |
| Safety Center | `b999d37ee42f69f4f7670d0dd7e4093c052281e7`; Vercel `2bUeNBtnoVvdD2Vx9H4b22Lapoan`; maintenance-only callback containment |
| Supermarket | `cfcca3f10154b79574c2f645e59fd7580ec3d92a`; Vercel `GnabRTDmsmMvSsx4zKDKSFHnfudd`; maintenance-only callback containment |
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
| RECOVERY: QR allocation and cleanup after process death | Durable QR journal, fenced SQLite promotion, native atomic journal deletion and leased cleanup; mobile `f4ead7e` | 1291 Jest tests, 77 desktop SQLite tests, TypeScript; 17 actual Android broker tests (test revision `9ceffc6`) | Isolated offline Release APK `e3af4067` passes allocation/promotion/cleanup force-stop sequence on Android 14; lease retry after 62 seconds; separate native client-only death keeps broker PID unchanged | Full wallet/main-miniapp workflow, remote allocator/issuer/EVM and physical Android remain open; this is not production activation |

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

## September 17 Invitation Recovery Checkpoint

The previously planned invitation journal is now implemented locally, not yet
deployed or accepted as a full Android flow. Source checkpoints:

- Mobile: `80aa66347bb7d6291b41f05f2bd759ab50f8a95c`.
- Messaging: `4b3e4de5b67476dda8030f15d681c7e1e4b15f9b`, following initial recovery
  commit `ae88d919385f6cb9415bba951db6905d80bb36a0`.
- Author and committer: `Xevorius <tim.is@live.nl>`; all remain local.

The Android broker stores an encrypted invitation journal and pending index
atomically under a dedicated cross-process lease. Stable sender keys/capabilities
precede allocation; the exact signed envelope and post-encryption ratchet precede
consumption. Rescans and startup resume the same operation. Generation retirement
and reset prevent resurrection; terminal cleanup distinguishes unconfirmed remote
cleanup from local erasure. Older native builds fail closed, requiring a rebuild.

The server permits fixed-window recovery only by the original consumer. Allocation
reuses the original capabilities, ACK-safe receipts prevent duplicate ciphertext,
and changed or expired operations are rejected. Delivery hints now commit with
messages and receipts. Invitation deadlines are checked again after row-lock waits.
Minimal hashed replay metadata remains until mailbox deletion; signed receipt
payloads expire. No public sender discovery or identity graph API was added.

Final verification:

- Mobile TypeScript and 886 Jest tests / 87 suites passed.
- Messaging TypeScript and 312 Vitest tests / 20 suites passed using disposable
  PostgreSQL. Two opt-in existing-proof-vector tests remained skipped.
- Eleven pipeline cases include actual competing transactions, observed row-lock
  waits across deadlines, hint-insert failures, lost responses, ACK-before-retry,
  expired recovery and current authorization. Proof/ledger/policy are fixtures.
- Eight isolated Android instrumentation tests passed on the app-plane emulator,
  using `com.egress.unet.securitytests`: atomic CAS, independent capability lease,
  process-death recovery, reset inventory and stale-writer exclusion.

Native provider SHA-256:
`f3e1486fffe100bdff896c1f4bdef5a8a3e617d4fcf05a50ad887831d06556cc`.
Test application SHA-256:
`2cd720d6c2dd034587b40a6d0afecd5ee4e2f01d6f323b8f70f2d1f278f20ebc`.
This harness compiles the provider, not the React Native bridge or complete wallet.
The disposable database was removed and the isolated test app stopped; U-net's
installed wallet and production services were not modified.

Remaining gates: full-app rebuild and bridge verification, native two-wallet
crash/recovery rehearsal, physical messaging tests, full-activity reset/rotation,
queue starvation from undecryptable head messages, release-manifest freeze and
cutover. iOS remains unapproved. The new retirement-hook regression initially
failed; lazy Metro module resolution corrected it and the final suite passed.
No production reset, SDK promotion, epoch activation or standards adoption occurred.

Private evidence and reproducible runners remain under
`audit-2026-09-17/messaging-pipeline/`.

## September 17 Mailbox Scan And Bridge Checkpoint

Mobile source checkpoint `402b501e5a4ef98995e7119f2398a6e1d63f54ba` is local only,
with both author and committer `Xevorius <tim.is@live.nl>`.

The wallet now follows server continuation cursors for at most four pages per
channel per refresh. Undecryptable ciphertext is not acknowledged; reaching the
tail restarts the next sweep at the head. Separate encrypted progress records
avoid rewriting channel secrets. Missing keys in one chat do not block others,
and concurrent refreshes within one runtime share one registered promise.
Payload shape, content commitment and contact identity are checked before a
decrypted result advances the ratchet. No server or protocol changes were needed.

Verification: mobile TypeScript, 911 Jest tests / 88 suites (91.167 seconds), and
the focused 70-test delivery/scan run passed. Synthetic signed envelopes and
mocked native decryption cover 200 unreadable head rows, bounded continuation,
transient failure, malformed input, reset/readability changes during fetch,
missing local keys, and retirement/deletion racing with cursor persistence.
Review caught and corrected both a cursor write that could recreate erased
secrets and a coercive message-kind validation check before this checkpoint.

Separately, production secure-store Kotlin files from
`80aa66347bb7d6291b41f05f2bd759ab50f8a95c` passed `:app:compileReleaseKotlin` on the
app plane: 201 tasks executed, 1m 32s. Fresh bytecode contains all four invitation
methods with `@ReactMethod`. Source digests match the pinned Git blobs, including
the provider previously exercised by eight instrumentation tests. Compiled class
JAR SHA-256: `6879d3417f92a0a06d22d3ea939c0b842d9383c5552b6fc0c46fe6b571838e97`.
This copied configured acceptance-app build is not a fresh full-HEAD APK and
does not establish runtime bridge, DEX/R8, or physical-device acceptance.

The incoming-message crash boundary is still open: ratchet state commits before
SQLite message persistence, and ACK recovery must not depend on decrypting the
same ratchet message again. Ordinary channel locking remains runtime-local;
cross-process writes and retirement during decrypt/cache require transactional
fencing and full-activity tests. The cursor's separate record removes its new
secret-restoration hazard, not these older receive-path gaps. See the app-plane
`docs/security/mailbox-scan-recovery.md` for exact boundaries.

Full-app two-wallet and physical messaging, reset/rotation, final provider
acceptance, deployment-manifest freeze and cutover remain open. iOS is unapproved.
No production push, deployment, reset, SDK promotion, epoch activation or new
phone APK occurred. Private evidence: `audit-2026-09-17/invitation-bridge/` and
`audit-2026-09-17/messaging-pipeline/mobile-mailbox-scan-tests.txt`.

## September 17 Incoming Message Recovery Checkpoint

Mobile checkpoint `3b96c41a4d3830da7d2f0750bc4432729bada3f3` is committed locally,
not pushed, deployed or activated. Author and committer are
`Xevorius <tim.is@live.nl>`.

The validated incoming payload, exact envelope and next ratchet now share one
encrypted pending-receipt record. Recovery applies local effects idempotently,
records cache completion, and requires explicit successful acknowledgement
before removing the receipt. An ACK reporting zero removals supports a lost
previous response. Disconnect retirement confirmation persists before its
authorization keys are erased. Receipt phases cannot regress.

Normal pairwise secret updates now use native exact-snapshot compare-and-swap,
including tombstone and reset checks. Stale writes cannot overwrite newer
ratchets or recreate deleted keys. There is no JavaScript fallback for older
native binaries or iOS. Per-channel failures retain receipts and permit other
channels to synchronize; native/reset fence failures stop the entire pass.

Verification: mobile TypeScript and all 984 Jest tests / 88 suites passed in
98.007 seconds. Tests cover lost responses, persistence and ACK failures,
competing state updates, replay, blocked-disconnect recovery, malformed input,
size boundaries and per-channel isolation. Fresh-module recovery tests are
JavaScript simulations, not native process-death evidence.

Three native CAS cases were added to the isolated Android harness, bringing its
intended total to eleven tests. Their build and execution are pending. At the
user's request, all APK builds are user-run on U-net/app-plane. The staged
source archive comes from the exact mobile commit; no installed wallet changes
are included in that build command. Prior native results do not cover this new
CAS implementation or its React Native bridge method.

Direct-chat limits are now 32 KiB serialized plaintext UTF-8 and 96 Ki transport
envelope characters, checked before outgoing ratchet commit and submission.
The native secret-state cap is 262144 characters. These bounds do not prove
arbitrary ratchet/metadata state fits.

Messaging checkpoint `eb293f0ff89d63624afe1417fd27eddcc9921bff` adds the matching
pairwise envelope limit before delivery persistence, receipt lookup and hints.
Official-account ciphertext retains its 1,500,000-character ceiling. TypeScript
and 323 tests / 21 suites passed with disposable PostgreSQL; two optional
proof-vector tests were skipped. The new integration cases cover the exact
boundary, rejected writes, unchanged receipts/hints, ACK-before-retry and the
separate official limit. Proof, ledger and policy success remain injected in
these route tests. The owned PostgreSQL container and tunnel were removed.
This server commit also remains local, authored and committed as Xevorius.

Open gates: native instrumentation and full RN bridge compilation/runtime,
SQLite lifecycle effects racing secret updates, ordinary outgoing-send crash
recovery, full-app two-wallet/device tests, reset/rotation, maintained-provider
acceptance, immutable release manifest and cutover. iOS remains unapproved.
No SDK promotion, production reset or security-epoch activation occurred.
Private evidence: `audit-2026-09-17/receive-recovery/`.

## September 17 Native Snapshot Boundary Follow-Up

The user-built isolated APK for mobile `3b96c41` compiled, but instrumentation
failed one of eleven cases. Its oversized malformed snapshot exceeded the test
Messenger IPC limit before provider validation. Review also found that the
production CAS's two allowed raw-string snapshots could exceed Binder's budget.
This is a failed acceptance run, not a native pass.

Local correction `0ed442929340dcd899c19a599b0b69398118af43` bounds each snapshot to
192 KiB UTF-8 and sends byte arrays rather than UTF-16 parcel strings. Shared
native packing validates before resolver calls; the provider strictly decodes
and retains exact snapshot comparison, reset fences and tombstones. Malformed
Unicode is rejected, not normalized. Older oversized experimental records remain
fail-closed; there is no truncation, blind overwrite or compatibility fallback.

Mobile TypeScript and 987 Jest tests / 88 suites passed (73.649 seconds). The
revised native harness adds explicit full-boundary/Unicode tests and checks
validation errors instead of treating any transport failure as rejection success.
The user rebuilt the isolated APKs from `0ed4429`; source and artifact hashes and
application IDs were verified before installation. All twelve native cases passed
on app-plane `emulator-5554` in 2.485 seconds. This includes maximum-size snapshots
and Unicode round trips, malformed input, cross-process CAS, deleted records,
reset fencing and the existing invitation/capability recovery cases.

Provider SHA-256:
`721e0b9507e02f08dbc713bc6a39596b1361abfff8716a106a42543dd35ef578`.
Test APK SHA-256:
`129a42eb6533c66ae0a6117a38dd03d419e22175a27fadf82dcc933059496ef9`.
Instrumentation APK SHA-256:
`7667b38db30ac2139a8ab1f68caf956d69b79ee2c7e650b246bc90e230b15411`.

Only the isolated `com.egress.unet.securitytests` application was installed and
then stopped. The installed wallet and production were not changed. This harness
compiles the provider, not the React Native module; full bridge/runtime and
full-app/device gates remain open. Evidence and the original failed run are in
`audit-2026-09-17/receive-recovery/`, with passing outputs under `binder-fix/`.

## September 17 Outgoing Recovery And Bridge Checkpoint

Mobile `164a2fed569589b6eb46932e85e182f797044627` is committed locally as
`Xevorius <tim.is@live.nl>`, not pushed, deployed or activated. Normal outgoing
messages now atomically persist the exact envelope and next ratchet through
native CAS. Lost responses reuse that envelope; confirmed operations finish
encrypted local caching without retransmission. Durable backoff, paused delivery
and Stop retrying keep failed operations bounded without falsely claiming receipt.

All completed-ID checks use an exact SQLite key-and-conversation lookup, not the
display history window. Storage/decryption errors fail closed. Submission checks
the current prepared operation after both initial and refreshed permit acquisition.
Cancellation while a permit was loading prevents a later POST; it cannot unsend
an in-flight request or make cross-process storage/network operations atomic.

Mobile TypeScript passed. Focused tests: 149 / 3 suites, 9.312 seconds. Full Jest:
1029 / 88 suites, 65.179 seconds. Synthetic tests cover lost network/broker
responses, persistence interruption, confirmation/cache recovery, malformed 2xx,
competing completions, successor operations, cancellation, backoff and display-
window-independent deduplication. Review findings were corrected and retested.
These tests mock native encryption and do not establish real two-wallet behavior.

Separately, the three secure-store Kotlin files pinned to
`0ed442929340dcd899c19a599b0b69398118af43` passed `:app:compileReleaseKotlin` in a
copied configured RN application on U-net: 201 tasks, 1m 33s. Source hashes match
the pinned Git blobs. Fresh bytecode exposes CAS as `@ReactMethod` and calls
bounded UTF-8 packing before resolver access. Compiled class artifact SHA-256:
`0dc962844f71e1c66230bfba96550de4fd681090bd192f938ce8b2e38b7569d0`.
This was neither APK assembly nor a full-HEAD app build, and does not prove
runtime JS/Binder or DEX/R8 behavior. Owned build processes were cleaned up.

Open gates remain SQLite lifecycle coordination with retirement/deletion,
contact-accept lost-response recovery, actual bridge/runtime and two-wallet
process-death testing, queued-state UI and physical Android, full reset/rotation,
maintained-provider acceptance, manifest freeze and production cutover. iOS is
unapproved. No SDK promotion, reset, epoch activation or new phone APK occurred.
Private evidence: `audit-2026-09-17/outgoing-recovery/` and
`audit-2026-09-17/receive-bridge/`. The app's outgoing-recovery document describes
implementation limits separately from release approval.

## September 17 Contact Acceptance Checkpoint

Mobile `2b44f10dff05b6b1691e4717dfc482c21b115705` is committed locally with
Xevorius as author and committer. No push, deployment, APK build, reset or
security-epoch activation occurred.

Contact acceptance now journals the exact confirmation and next ratchet in the
encrypted native CAS record. Prepared delivery retries reuse the envelope;
confirmed delivery completes local activation without retransmission. Atomic
journal removal retains a completion marker. Recovery does not reread the
profile, and success paths reread channel lifecycle after asynchronous work.
Backoff and thirty-day retry expiry are durable; decline remains available.

Direct conversation projections no longer populate the chat list. Only current
pairwise rows provide direct conversations. Live refresh rereads them after
official-account network work. Successful official results, including empty
results, replace the returned official set; thrown failures retain cached rows.
This removes one resurrection path, not all cross-store races.

Verification: TypeScript passed; 164 focused tests / 2 suites passed in 8.592
seconds; final full Jest run passed 1059 tests / 88 suites in 58.67 seconds.
Review prompted fixes for stale acceptance-success snapshots, an unnecessary
profile dependency, and empty official results. A failing race-test fixture
initially mutated the caller's captured object; replacing the stored snapshot
correctly reproduced database behavior. Both corrected race cases pass in the
final full run. The earlier failed output is retained, not counted as a pass.

These are synthetic JavaScript tests with mocked native encryption. Full Android
activity/process-death and physical-device acceptance remain open. The app's
`docs/security/pairwise-lifecycle-fencing.md` records the remaining transactional
SQLite gate: revision/reset/generation fences, atomic terminal transitions,
message writes and deletion, and real two-connection crash/race tests. The journal
still uses the current unfenced local promotion path and is not release approval.
Provider acceptance, complete reset/rotation, manifest freeze and cutover remain
open; iOS remains unapproved. Private evidence:
`audit-2026-09-17/contact-acceptance-tests.txt` and
`audit-2026-09-17/contact-acceptance-tests.failed-fixture.txt`.

## September 18 Staged SQLite Lifecycle Store

Mobile `b4b37bdd468dfc008b22c57c8ae73b3c4be1fd9b` is committed locally with
`Xevorius <tim.is@live.nl>` as both author and committer. The new module is not
imported by existing application writers. No schema migration, push, deployment,
APK build, production reset, SDK promotion or epoch activation occurred.

The staged store requires an exclusive transaction connection for channel and
encrypted-message writes. It adds revision checks, durable reset/generation
fences, insert-only creation, purpose-specific updates, atomic terminal actions,
idempotent reset records and exact message-parent ownership checks. Existing
encrypted local payloads survive duplicate delivery; a missing payload may be
filled only when immutable transport metadata matches. Plaintext and malformed
optional fields are rejected. Native secret cleanup remains outside SQL.

Final verification: 43 real SQLite tests passed, zero failures or skips, in
6.838 seconds on Node 24.18.0 / SQLite 3.53.1. Independent WAL connections,
deferred transactions, injected write failures and a child-process restart cover
stale writers, terminal races, rollback, generation retirement, repeated reset,
message conflicts and preservation of official/unrelated rows. Independent
review found three message-validation/enrichment issues, all corrected with
regression tests. Mobile TypeScript passed; the separate existing Jest suite
passed 1059 tests / 88 suites in 78.221 seconds.

These results prove only the staged desktop storage boundary. Every app writer,
snapshot import/restore path and reset must still be integrated; legacy bypasses
must be removed. Durable native cleanup, actual Expo SQLite behavior, concurrent
Android activities and physical-device acceptance remain open. The application
lifecycle finding is not closed. The app's
`docs/security/pairwise-lifecycle-store.md` lists the integration gates; the
reproducible tests are `apps/mobile-web/scripts/security/pairwise-lifecycle-sqlite.test.cjs`.
Maintained-provider acceptance, full reset/rotation, manifest freeze and cutover
remain open. iOS remains unapproved.

## September 18 SQLite Application Integration Checkpoint

Mobile `b58b15b160ea1dd8f3c948301a2432a853cc5c73` is committed locally with
`Xevorius <tim.is@live.nl>` as author and committer. Schema/snapshot version 13
connects application writers to the staged lifecycle store. No push, deployment,
APK build, device reset, SDK promotion or security-epoch activation occurred.

Application writes now carry captured revision, reset and generation fences,
including invitation recovery and cache encryption. Generic direct-chat writes
reject. Terminal SQL transitions persist cleanup work before native erasure;
server retirement confirmation is persisted before its independent management
key is erased. Reset inventory survives SQL/native interruption and includes
cleanup records for channels already deleted locally. Import does not restore
direct-chat records or secrets, and retains official data and local fences.

Final verification: 1137 mobile Jest tests / 89 suites passed in 40.557 seconds;
58 real SQLite tests passed with zero failures or skips in 3.112 seconds.
TypeScript and diff checks passed. CI uses Node 24 and runs the SQLite tests.
The Jest suite includes actual data-store SQL under Node SQLite; client tests
use a stateful lifecycle adapter and mocked native storage, not Android Expo.

Independent review identified historical-chat deletion by an unfinished
invitation journal and cleanup starvation after a local erasure error. Both
were corrected with focused regressions. Sender/generation identity is checked
inside the history-preserving retirement transaction. Reset/import tests cover
saved inventory validation, cleanup-only sender keys, and legacy official rows.
Earlier failed runs are retained and are not counted as passes. Private evidence:
`audit-2026-09-18-integration-verified.txt` and
`audit-2026-09-18-integration-sqlite-verified.txt`.

The lifecycle finding remains open pending real Android acceptance. QR
allocation still needs durable recovery across remote/native/SQL boundaries;
new cleanup jobs need durable backoff/expiry. Actual Expo transactions,
main/miniapp process death, native admission during reset/import, physical
Android, maintained-provider acceptance, full reset/rotation, manifest freeze
and production cutover remain gates. iOS remains unapproved. No new phone build
is requested at this checkpoint; the user continues to own APK assembly.

## September 24 QR Allocation And Cleanup Checkpoint

Mobile `848b02585da495848b6d3a9828db3f14a594850b` is committed locally with
`Xevorius <tim.is@live.nl>` as author and committer. Schema/snapshot 14 adds
leased cleanup retries and outcomes. No push, deployment, APK build, device
reset, SDK promotion or security-epoch activation occurred.

Profile QR creation now journals stable sender/ratchet keys, capabilities and
original lifecycle fences before remote allocation. Lost responses reuse that
allocation; exact SQL promotion completes recovery without restoring old keys.
Expiry and cancellation durably hand cleanup to SQL before dropping journal
payloads. Scanned-invitation cleanup uses the same durable handoff, retaining
management authority for remote retries rather than erasing it on network failure.

Cleanup uses sixty-second atomic SQL leases, persisted exponential backoff and
thirty-day retention. The unlocked Android worker wakes in the foreground only.
Matching native journal secret copies are erased before completing or expiring a
job. Expiry without remote confirmation records `revocation_unconfirmed`, never
confirmed remote revocation. Retained chat history remains terminal, and repeated
terminal actions cannot requeue completed jobs. One QR failure no longer skips
unrelated scanned-invitation recovery.

Final local verification: 1238 Jest tests / 91 suites passed in 36.037 seconds;
77 real SQLite tests passed, zero failures or skips, in 6.403 seconds. Mobile
TypeScript and diff checks passed. The SQLite suite covers leases, crash backoff,
retention, outcomes, abandoned allocations and schema-13 upgrade. Client tests
cover journal copies, lost responses, late key writes and recovery isolation.
Review findings were fixed and regression-tested; earlier failed runs are retained
as diagnostic evidence, not counted as passes. Private evidence:
`audit-2026-09-24-recovery-full-final.txt` and
`audit-2026-09-24-cleanup-sqlite.txt`.

These are desktop SQLite and synthetic native-storage tests, not Expo/Binder or
phone acceptance. Actual main/miniapp process death, full-activity reset and
rotation, physical Android, maintained-provider acceptance, manifest freeze and
production cutover remain open. iOS remains unapproved. The app's
`docs/security/pairwise-lifecycle-store.md` records the implementation and remaining
gates. No new APK build is requested here; the user continues to own assembly.

## September 24 Offline Android Recovery Build Handoff

Mobile `086e4cad46f83c6d68fa9189acd94d5bb81995e8` is committed locally as
Xevorius, including the recovery probe (`63c6cc8`) and pinned build tooling.
Cleanup retention was corrected from an accidentally implemented thirty-one
days to the specified thirty days; the earlier checkpoint was never deployed.

The isolated offline probe uses production QR recovery and lifecycle modules,
real Expo SQLite and the native broker, but a synthetic allocator and minimal
React root. It pauses for process termination after allocation, SQL promotion
and cleanup lease acquisition. It checks exact recovery without ratchet rewind,
expired lease rejection, thirty-day unconfirmed expiry and unrelated fixture
preservation. It does not exercise production background sync, real messaging,
the ledger or the full wallet workflow.

Desktop verification passed: 49 probe tests; full Jest 1287 tests / 93 suites in
45.447 seconds; 77 SQLite tests in 3.641 seconds; TypeScript. Build preparation
and source-map policy self-tests passed. Linux Bash syntax and archive validation
passed on U-net. An initial archive failed script-byte validation because Windows
Git applied CRLF conversion; explicit LF archive settings and a real Git archive
regression fix this. The failed bundle remains diagnostic evidence, not a pass.

The corrected source archive SHA256 is
`850c36d6501705f056ef0e1fd130faf3e83ed3322971e21c9bd718ad4b061cad`.
It is staged at
`/home/u-net/unet-security-runs/recovery-runtime-input-086e4ca` on U-net.
Only `--validate-only` was run. It did not extract source, install dependencies,
generate native projects, compile, sign, install or launch an APK. The user owns
APK assembly. Artifact audit and actual emulator/phone results are still pending.

Production, SDK versions, installed emulator apps, tester data and security epoch
are unchanged. Full activity/process, provider, physical-device and cutover gates
remain open; iOS remains unapproved. Test procedure and limits are in mobile
`docs/security/android-recovery-runtime.md`.

## September 24 Android Recovery Execution

The user now authorizes agent-built temporary/test APKs; Play Store-ready builds
remain user-operated. No production build, push, deployment, reset, SDK promotion
or security-epoch activation was performed in this checkpoint.

Mobile `f4ead7efb6d0b8c49debaada8c34ea504d7f2eb8` fixes a native contract mismatch:
QR recovery uses null CAS values to remove completed secret-bearing journal rows,
but Android previously rejected null. The broker now atomically tombstones the
row and removes its encrypted name index alongside the journal-index update.
Ownership, generation, expected-value and all-or-nothing checks remain enforced.
Malformed JSON types cannot be coerced into accepted values. The probe also
checks retained ratchets and official payloads, not merely key existence; a
previously completed database reports `previously_completed`, not a fresh pass.

The offline APK has SHA256
`e3af40676d8bf698bc299120bc4906267c2c026422454edaa19db0980cf2dca4`.
It passed the compiled manifest/signature/native-library/source-map isolation
audit. It was installed only as `com.egress.unet.securityacceptance` in the new
`unetRecovery20260924` app-plane AVD, not the existing user emulator. Recorded
processes were 7507 (allocation), 7665 (promotion), 7858 (cleanup lease), and 8064
(pass). Every stop verified the old process was absent. Cleanup remained stopped
for 62.000 seconds; no app data was cleared. Another restart rechecked completed
state and reported `previously_completed`.

Seven invitation journal/ownership tests and ten existing storage/reset tests
passed against the real broker in separate test-client processes. Test-only
revision `9ceffc6bac3ff3bd60b27ad6d4766dee0df01bd8` adds precise rejection checks
and asserts that the broker PID survives client-only death. The instrumentation
APK SHA256 is `025518a16e3eeccd89f0453aefee6a0393ef9396f3cc56285e09fe08bcd86d31`.
The target harness APK SHA256 is
`c190c1166ec94946cdae370807f3182240aeb77c5142de265cc62616d8440c36`.
An earlier malformed-input assertion incorrectly required an exception-shaped
reply; the corrected test accepts a missing-field empty IPC rejection only while
checking unchanged values and the complete committed broker file. Earlier failed
results remain diagnostic evidence, not passes.

Desktop verification passed 1291 Jest tests / 93 suites in 38.391 seconds,
77 SQLite tests in 3.120 seconds, and TypeScript. An earlier native reuse guard
rejected CRLF/LF-only differences; `e2abd11` allows only that normalization.
The first device driver failed implicit intent resolution before any checkpoint;
explicit launch of the audited MainActivity and installed-APK hash verification
allowed retry without replacing the APK or clearing storage.

Private evidence is retained under
`audit-2026-09-24/recovery-device-evidence`, including checkpoint screenshots and
structured process/elapsed-time results. The app-plane source/artifact run is
`/home/u-net/unet-security-runs/recovery-runtime-UyIJfqk7`.
No signing private keys or app-storage contents were exported.

This closes only the isolated Expo SQLite/broker process-death subgate. Allocation
and remote cleanup acknowledgement are synthetic; expiry uses an injected store
clock. No biometric interaction, full-router behavior, production main/miniapp
contention, network messaging, ledger acceptance or physical-phone pass is claimed.
Full maintained-provider acceptance, complete reset/rotation, final release
manifest, physical Android and cutover remain open. iOS remains unapproved.

## Provider and chain integration continuation: 2026-09-24

Candidate commits, local only and not deployed:

- Safety Center `f2cf60f5661507793bda61c83b37003991bc79d6`: mandatory database
  certificate/hostname verification, guarded URL parsing, and database-clock
  policy heartbeat timestamps.
- Supermarket `a9792793a8e79b0b6cd6509167dc830edda57d5d`: equivalent database
  transport verification. Optional provider-owned public CA is configured through
  `UNET_PROVIDER_DATABASE_CA`; no TLS bypass is accepted in production.
- Dashboard `35c69a307d0f86927f1e1acea6d94a8d38765bce`: retirement uses the same
  configured authority as login, rejects redirects, bounds upstream requests and
  sanitizes responses. Author and committer are Xevorius for all three.

The disposable PostgreSQL rerun passed 57 checks without skips: SDK 16, Safety
20, supermarket 1, and dashboard backend 20. The dashboard runner required a
30-second test budget for SSH round trips; endpoint deadlines were not changed.
An additional Safety run passed 21 checks, including a regression with the worker
clock artificially 60 seconds ahead. Its aggregate receipt is
`audit-2026-09-24/provider-postgres-results/18bb6653df4911f16938.json`.
Owned tmpfs database containers were stopped after each run.

Each provider passed ten configuration and real TLS-handshake checks, including
rejection before PostgreSQL startup credentials are sent for an unknown CA and
a trusted certificate with the wrong hostname. This is transport acceptance,
not a real production database connectivity check. Dashboard route tests passed
13 checks. Safety and dashboard TypeScript passed. Provider privacy wrappers are
not part of those three commits; subsequent candidates are recorded below.

Actual Next dev/Chromium runs then passed ten browser cases each for Safety
(`providers-next/results/safety-dev-ef4105929e38e951`) and supermarket
(`providers-next/results/supermarket-dev-2cc2988c5a9a3e6b`), under the same private
audit directory. These exercised actual provider route/proxy code, independent
cookie contexts, copied-QR redemption denial, wrong cookie secrets and origins,
single-winner approval/exchange, two tabs, wrong account keys, fixture-SQL expiry,
and rejection of legacy session-ID redemption. Both disposable databases and
browser/server runtimes were cleaned up. This uses reviewed Windows application
guards, not OS isolation; it is neither Next production-build nor deployed/Android
WebView acceptance. Wallet approval signatures are synthetic Ed25519 accounts.

Privacy candidates Safety `7e59d6681a3e568687c5ef60aeef1cd01d9583f6` and supermarket
`e5fb537` contain initialization exceptions and emit only fixed diagnostic fields.
Safety acknowledgement failures now expose only four known lifecycle errors;
unknown exceptions return a generic non-cacheable 503 rather than raw backend
text. Route privacy tests passed 12 for Safety and 11 for supermarket; Safety
typecheck passed. These commits are local, not deployed.

A separate unchanged-contract Besu/gateway/messaging/PostgreSQL rehearsal passed
active two-way transport and fail-closed gateway outage/recovery. One run's
revocation phase failed with temporary unavailability instead of the expected
authoritative revoked response. The later unchanged-source `run-wNzgzC` passed:
sender, recipient, fetch and ACK enforcement measured 11.3-12.0 seconds after
revocation; healthy credentials remained usable. This does not erase the earlier
failure or establish its cause. A near-expiry positive-cache lease can separately
expire during SQL work; early refresh and transaction rollback regressions are
under test without extending the 20-second deadline. Proof verification in this
rehearsal is synthetic; no Android or production proof pass is inferred.
All failed evidence and owned-resource cleanup receipts are retained in
`audit-2026-09-24/evm-messaging/cache`.

Messaging candidate `ebec86d51cfc5519021d5272f3125e8f38de3e1c` refreshes positive
credential leases when two seconds or less remain, before acquiring SQL locks.
It never extends an existing lease or accepts stale results. The real-PostgreSQL
run passed all 27 tests (9 gate, 18 pipeline), including post-write/pre-commit
expiry rollback for sends and acknowledgements. Receipt:
`audit-2026-09-24/provider-postgres-results/ae8f63472b903c91de9b.json`.
The patched real-chain rehearsal `run-OmS78V` also passed, measuring fetch/ACK
and sender/recipient rejection in 10.0-10.7 seconds. This is local candidate
acceptance, not deployment, native proof acceptance, or a proven explanation for
the earlier intermittent temporary-unavailability result.
An identical patched repeat `run-vZIGoS` also passed. These timing results start
at client-observed transaction confirmation, not measured block inclusion;
post-20-second and negative-cache-expiry persistence probes remain to be added.

Extended rehearsal `run-3n2AS0` subsequently passed those persistence probes,
including a required new gateway read after negative-cache expiry. Its
conservative revocation submission-to-denial upper bound was 12.612 seconds
(receipt delivery alone took 1.738 seconds). Real governance issuer suspension
blocked send/fetch/ACK in 4.3-4.9 seconds from submission; an independent real
credential gate observed `messaging_issuer_unavailable` within 18.173 seconds.
Route denial can also result from expired policy heartbeat during suspension,
so these observations are not attributed solely to one cache. Governance
reactivation restored unchanged permits and retained ciphertext without
reauthorization after existing negative leases expired. A separate 60-second
proof-fixture expiry rejected sender/recipient traffic, fetch and ACK within
0.9 seconds, with chain status still active and rows unchanged. V2 has no
on-chain expiry field; native proof validation remains outside this rehearsal.
Owned containers/network were removed; no production chain state changed.

The first current-source full-router Android reset APK passed compiled artifact
checks but failed during synthetic fixture preparation, before any reset barrier.
Run `full-activity-fpofst66` and its stopped disposable AVD are retained. A separate
fresh diagnostic build adds bounded preparation checkpoints; it is not a claimed
fix. Original emulator-5554, production wallets and production data are untouched.

Diagnostic APK `4d52066bbe1550e0cded8d2992dcd5cc82cd49a77515cbaafa561e8f354f1990`
in `full-activity-v_j9nhlg` completed seed, competing-reset rejection, force-stop
recovery and repeated exact-preservation checks for the after-secret-deletion
case. The screenshot nevertheless shows a System UI ANR dialog: storage predicate
success is not UI/startup acceptance. The second fresh AVD exceeded the driver's
60-second APK-install deadline before app execution. Both AVDs and evidence were
retained. The earlier seed failure has not been reproduced or explained.
The explicit same-APK attempt `device-attempt-7o0d8igk` added pre-install system
health checks and stopped on fresh-OS ANRs before installing the test APK. This
establishes a separate emulator-provisioning problem, not a passing app test.
It also exposed a driver focus-inspection mismatch: `dumpsys window windows`
does not contain the expected focus fields on this image. Both need resolution
before relying on UI-readiness evidence. No ANR dialog was dismissed.

Removed six explicitly checked inactive Rust/C++ cache directories from old
app-plane runs `0c446d4`, `197d7c2` and `e3f1585`, reclaiming 7,142,023,168 bytes.
Source, APKs, signing keys, static dependency inputs, evidence and emulator data
were preserved. This cleanup was outside the production reset.

Counts-only retained-journal inspection found 40 secret-query markers in the
bounded trust journal sample (latest 2026-09-06) and 2349 scoped-ID markers
(latest 2026-09-15). The separate 48-hour bounded sample contained neither.
No raw rows were exported. Historical removal, unrecognized encodings, upstream
proxy/tracing coverage and exposed-capability invalidation remain open.
The app-plane legacy debug gateway is masked and inactive. The V1 ledger API
container is exited with restart disabled; its old deployment source still needs
guarding against recreation. No host log deletion or production reset occurred.

## Further September 24 Candidate Checks

Supermarket production-mode Next build and Chromium route acceptance passed all
ten cases with real disposable PostgreSQL over validated TLS. Receipt:
`audit-2026-09-24/providers-next-production/results/supermarket-116603201c7c8b63776c`;
browser evidence: `providers-next/results/supermarket-production-7961946fa2675467`.
Plaintext, untrusted-CA and wrong-hostname connections were rejected. Cleanup
completed. These are browser API-document tests using synthetic wallet signatures,
not rendered login UI, Android WebViews, deployment or physical-phone acceptance.
Windows restrictions are application-level, not OS network isolation.
Safety production-mode acceptance then passed the same ten cases and TLS probes:
`providers-next-production/results/safety-c3bff8da6503d85f4363` and
`providers-next/results/safety-production-52ff33cc9623f5e5`. Cleanup completed.
The same scope limitations apply; later callback patches require their own tests.

Credential-delivery capabilities now use only Authorization Bearer headers in
SDK `4060424`, mobile `190db87`, Safety `1b68ffe` and test fixture `7402224`.
The SDK and Safety reject query capabilities even alongside a valid header,
sanitize unknown exceptions, and mark responses non-cacheable. Focused tests
passed 36 SDK, 2 Safety, 51 mobile and 12 fixture cases; SDK, Safety, mobile and
fixture typechecks passed. All four commits use Xevorius as author and committer.
No publication, deployment, old-capability invalidation or credential reset was
performed. Historical delivery-capability exposure remains a release gate; see
[the credential-preserving recovery boundary](./delivery-capability-transport.md).

Android provisioning attempt `device-attempt-oj0gsuuf` stopped before any reboot
or installation when a temporary ANR trace disappeared during inventory sampling.
The separate boot-race candidate marks this exact boot1 inventory race as unstable
and restarts the quiet observation window within the original bounded deadline.
Strict settled-boundary and boot2 checks still fail on inventory instability.
Its 29 local guard tests passed; this is not a fix for the underlying Android ANRs.
The OS-only `device-attempt-7xvo0dfv` then passed its bounded provisioned-OS gate:
boot1 remained `infraFAIL`; boot2 had zero new ANRs and stable launcher focus.
No APK was installed. A continuation invocation `device-attempt-8zlh7gjn` stopped
before emulator creation on a busy port; it was not retried in place.
On unused ports, `device-attempt-bso07ru6` reached MainActivity recovery with
zero new boot2 ANRs, but failed the visible-navigation assertion. Parent screenshot
review shows the Communications page and icon-only bottom tabs, not a blank shell
or an ANR dialog. The locked navigator leaves icon-only Android tabs unnamed;
mobile `df65f39` adds explicit accessibility labels without changing their
appearance. This source fix does not retroactively pass the failed run or count
as full recovery acceptance. All evidence and AVDs are retained.

Mobile `956731e` replaces raw credential exception logging with fixed operation
codes. Three privacy regressions prove failed revocation stays queued and ledger
refresh failure preserves the cached lifecycle without logging injected secrets.
All 17 focused credential tests and full mobile typecheck passed. This is a local
source change, not an updated APK or proof of all device logs being secret-free.

## September 25 Continuation

Domain-admin callback review found a legacy protocol branch could bypass V2
control authorization. SDK `9f97630`, Safety `cb62213` and Supermarket `5fd5d11`
reject that branch, require asymmetric authorization and sanitize private route
failures. Author and committer are Xevorius for all three. Focused provider tests
passed 51 Safety and 35 Supermarket cases; both provider typechecks and issuer
typecheck passed. SDK issuer tests passed 64 cases. Signatures and replay checks
are real; database, ledger and credential side effects are mocked. See
[callback scope and remaining durability gaps](./domain-admin-callback-security.md).
These are local commits, not deployments. Existing login-only maintenance does
not cover domain-admin routes. A matcher-only containment patch is prepared, but
live commit verification and renewed Vercel CLI authorization remain required.

The coverage1 Android test build `full-activity-4x2zcm61` was deliberately stopped
after review found reusable CAS-probe keys and cancelled-observer races in the
test harness. Its source and intermediates remain retained; no APK acceptance is
claimed. Coverage2 fixes those harness defects and narrows post-unlock acceptance
to MainActivity. All 24 Node and 31 Python checks passed. Its staged manifest is
`f7838052e8493affd13da9f2988dd408e87d8048917efe40b5c866f65481d749`;
Android execution is still pending.

Fresh standalone native proof build `native-evm-build-ahh6_r86` completed. Receipt
SHA256 `df521334e3e43ec4b988ac547ee5cdae370ed5e3027fc9c1995592ca287299bf`
identifies source `df65f39`, separately hashed test overlays, fresh x86_64 and
arm64-v8a JNI builds, and isolated package `com.egress.unet.securitytests`.
Target APK SHA256 is
`8efffdd516b2ed10666e0613208a4d1d1bb23d5dc021d7ceaedb3104f4a3daf6`;
test APK SHA256 is
`f2575ed2a46e054c5e2c07c04068db9d90091789d109e82aa0ae9165c4894140`.
The receipt explicitly says runtime not accepted. The runtime harness passed
35 offline checks including provenance continuity and negative-proof oracles;
real JNI/WASM plus isolated-chain execution remains pending.

Two completed diagnostic Rust-target directories were removed after exact-path
and active-process guards, reclaiming 4,530,769,920 bytes. Their source, APKs,
keys, static dependencies, test evidence and AVDs were preserved. No production
reset, ledger change, SDK promotion or service reopening occurred.

## Additional September 25 Evidence

Safety `58c7153` constrains revocation-worker persisted failure details to finite
categories. Thirteen focused tests passed. Retry and ledger-confirmation semantics
are unchanged; historical database errors were not purged and this is not deployed.

Independent coverage2 review found a final deadline check and cancelled-verifier
diagnostic race still missing from the acceptance harness. Coverage3 corrects
those checks; 26 Node and 31 Python tests passed. Its manifest is
`22518a3b2c80ff5975d66b555beafb6065c0f9e6d62f758aa05a2c555267c85f`.
Build `full-activity-hazjk_m7` compiled both native ABIs but stopped at the capacity
guard before Gradle assembly. A separately reviewed same-attempt continuation
pins source, generated inputs, tools and signer; its eleven local guard tests
passed. Assembly subsequently passed in 5m34s, including compiled-artifact audit.
APK SHA256 is
`e3db15d3204b3b2884e0f3d658a6394c44cabc4258a5c338047d01def9973154`,
artifact receipt SHA256
`523feb386896941abeb3c863d8e63892c63384917a93cf7f5a6cc80bbc8f0e00`.
The executed continuation script SHA256 is
`8fc4871dbf451d090722dd06723ef39cb9f9ef9b31e579f36bd1d5e9a6869d11`;
the later local sidecar differs and was not executed. No native recompilation or
cross-attempt generated-project reuse occurred. Device acceptance remains open.

Native device attempt `native-device-gko18pu9` stopped at the original-emulator
identity guard, before creating a device: the original uses the implicit default
port. A narrowly pinned guard correction retained protection of that process.
Google APIs attempt `native-device-8g2sn82a/native-device-o_insvtu` subsequently
failed its strict second-boot ANR gate before APK installation. A GMS service ANR
was observed, but the broader infrastructure root cause is not established.
AOSP comparison `native-device-avzs97y3/native-device-8a_o4q0a` reached boot but
exhausted the startup deadline during device identity checks, also before APK
installation. Both owned emulator processes were removed and the original
emulator identity was unchanged. Neither attempt is native application acceptance.

Isolated EVM run `native-evm-candidate/cache/run-Ve9hmx` registered its disposable
issuer and anchored a synthetic credential, then timed out awaiting Android.
No native proof or authorization challenge was exercised. Owned-resource cleanup
passed. A new runtime attempt must start only after the device lease is ready.

The separately reviewed AOSP phase-deadline correction passed 29 local and remote
guard tests. Run `native-device-8rcebyhw/native-device-x2k9mhw4` then passed clean
boot1 and boot2 provisioning and installed the exact native target/test APKs.
Its lease SHA256 is
`1ca44b0a691e6bd3ab9b7b4a3161c9839282d3b684767c1eae8e672ce9117fee`.
This is AOSP without GMS, not full-wallet, push or physical-device acceptance.

Native/EVM run `native-evm-candidate/cache/run-FTO8F2` reached a real messaging
challenge but the instrumented Android process aborted with SIGABRT in
`nativeGenerateProof`, with Rust panic-unwind frames. No proof authorization
passed. The pinned JNI invokes `setup_srs_from_bytecode` with no local SRS path;
cached `noir_rs` source shows this downloads CRS data for each proof and unwraps
network failures. The test UID permits only loopback traffic. This supplies a
concrete panic path consistent with the crash, but the original panic payload
was not captured; do not claim a completed runtime diagnosis or fix.

Parent interruption stopped the driver before its automatic cleanup completed.
After verifying exact owner labels and process termination, parent cleanup
removed only that run's two disposable containers, network and local fixture
secrets. `parent-interruption-cleanup.json` records that distinction; no automatic
cleanup pass is claimed. The emulator lease was released, owned process cleanup
passed, and the original emulator identity remained unchanged. Private crash
evidence stays on the app plane; no proof or witness data was exported.

Exact-path cleanup removed two inactive compiler-output directories and five
older Android intermediate directories, reclaiming respectively 4,164,005,888
and 5,275,774,976 bytes. Source, APKs, signing material, static dependencies,
evidence and AVDs were preserved; APK hashes were checked across the second
cleanup. These temporary outputs are outside ordinary release-build retention.

No production deployment, reset, capability invalidation, SDK promotion or service
reopening occurred. Vercel authorization for the narrow callback containment
deployment still needs renewal.

The revised counts-only log inventory passed 20 local and 20 U-chain mock tests.
Live bounded scans on both planes returned `incomplete`, not clean: the trust
user journal and APK-distribution journal reached their requested tail caps;
the trust system journal was empty/unverified. Running and stopped selected
Docker containers were included. The trust user-journal tail still contained
40 other-secret-query markers and 2349 scoped-ID markers; `/var/log/syslog.1`
contained four scoped-ID markers. No query-capability/bearer/cookie markers were
reported for the selected container tails. Marker totals are overlapping pattern
occurrences, not distinct credentials or proof of complete historical coverage.
Only counts/status JSON was copied off-host. No log deletion or capability
invalidation followed; shared journals, proxy/tracing coverage and older copies
still require separate disposition.

### Offline Native Prover Candidate

Mobile `5fb072a23d9c2959919ae712c76700f8dd983293` replaces per-proof
network SRS loading with immutable, hash-pinned public parameters, bounds native
circuit capacity, serializes native operations and contains caller-thread Rust
panics with fixed errors and process quarantine. FFI signatures and proving and
verification settings are unchanged. This does not contain C++ aborts, OOM or
dependency-thread panics, or prove the cause of the previous SIGABRT.

Five source checks and seven Linux standalone Rust checks passed; the latter
exercise the exact production capacity and panic-boundary modules, not a genuine
proof. Source staging/build guards passed ten tests, including byte-exact binary
parameter handling. Both x86_64 and arm64 JNI libraries and instrumented APKs
compiled successfully from fresh offline source in `native-evm-build-nzhm56zd`.
Stage SHA256 is
`024e0f560e7daaef7697d88293fe4653808ec999467b464b8cc5bf7764c25769`;
build receipt SHA256 is
`5fed75e25418ec03638e20f4ce69443cba8a55a0b0bf828fbc6af3d5ba9cabde`.
Target APK SHA256 is
`3f30bc4b176f546fe580ff733cb75fa02ef36c14ee0f93b0039e6b2ff370e209`.
The frozen stage README predates its source-pin update; source hashes and build
receipt identify the new commit. Runtime proof acceptance is still pending.

The separate same-APK AOSP recovery driver passed 48 local tests and 47 remote
tests (one source-checkout-only test explicitly skipped on transfer). Its input
and compiled-artifact identities were revalidated. Runtime results remain open;
this driver cannot establish GMS, biometric or proof acceptance.

Native device attempt `native-device-isk_g6s4/native-device-fphq507g` failed the
strict second-boot ANR gate before either APK was installed. The retained counts
identify SystemUI service timeouts, including one new second-boot ANR. KVM was
available; no emulator KVM/graphics/OOM failure markers were found. Guest idle
was 1.2% and steal 17.4% during the failing sample, versus 89-98% settled idle in
the earlier healthy run. This is suggestive of scheduling pressure, not a proven
cause. Owned cleanup succeeded and the original emulator identity was unchanged.
A separately reviewed four-vCPU comparison changes only the disposable emulator's
CPU count, retaining the image and strict deadlines/ANR checks. Host background
update work also ended, so a passing comparison cannot isolate CPU count as cause.
Its driver checksum manifest is
`23a9cec2ec29a06c7442ba8f79d99c57cce24778ec26d4512688732db6ab4a98`.

Four-CPU run `native-device-0xj9cw32/native-device-0c5l69zv` passed both boot
health gates without observed ANRs and installed the exact new native APKs under
loopback-only UID firewall rules. Lease SHA256:
`9b379ba40c757e1ff2a9e745a54630d7ba10c0293de7bb04e1e728ae53662ff7`.
This is OS/device provisioning, not proof acceptance. Disposable EVM attempts
`run-n1YzmD` and `run-tLXqgs` anchored fresh synthetic commitments but stopped
before Android submitted any proof. The second attempt's finite-category
diagnostics confirmed `heartbeat_clock_skew_over_5_seconds`. Windows time service
was stopped; U-chain reported synchronized NTP. The timing gate was not weakened,
and no host clock was changed. Both attempts completed owned-resource cleanup;
the device was released with clean teardown and original5554 identity unchanged.

The parent runner now supports an owner-matched local stop request rather than
depending on Windows Ctrl-C. Its cleanup checks captured directory identities
before local mutations and independently bounds each child shutdown, so a failed
stop cannot omit the remaining exact-owner cleanup. Twenty-seven focused mock
tests passed, including never-exiting children, kill failures and directory
replacement. The combined source-only suite passed 62 cases before the added
failure-category test (eleven runtime-oracle cases now pass). These are runner
tests, not Android authorization acceptance.

Reviewed inactive compiler/intermediate cleanup reclaimed 3,609,522,176 bytes;
finished APK hashes were unchanged. A fresh systemd check found the debug gateway
`masked` and `inactive`, with no trigger units. Production remains paused.

### Full-Activity Recovery Follow-Up

The four-CPU AOSP run against unchanged APK `e3db15d3...9773154` reached
`reset_verified` twice and `production_hydrated` after interruption immediately
following secret deletion. The competing miniapp writer was rejected. Subsequent
post-unlock verification failed `full_activity_reset_operation`; this is a failed
scenario, not full recovery acceptance. The other two scenarios did not run.
Evidence is retained under `full-activity-hazjk_m7/evidence/device-attempt-802uepj9`.
Owned emulator cleanup succeeded and original5554 remained unchanged.

Source inspection identified an automatic legacy-v4 migration that can advance
the lifecycle epoch after security reset when its old SecureStore marker is
absent. The observed failure is consistent with this path but did not record
individual journal-operation categories. A new test overlay adds finite counts
and epoch-match booleans, never operation IDs or epoch values, while preserving
the strict one-operation/current-epoch assertion. Its source checks passed 26
Node and 31 Python tests. Mobile commit
`80c0b690abbfa0946ee37a58703da2457d006f94` adds the dedicated transactional
legacy-reset fence: pending security reset rejects retryably; completed security
reset supersedes migration without legacy secret deletion or marker writes.
Generic reset semantics remain unchanged. Eighty-five real SQLite cases, including
independent-connection races, and 224 chat tests passed; mobile typecheck passed.
Independent source review found no blocker. A fresh Android recovery build remains
under verification; previous failed evidence is unchanged. The stage manifest is
`98656827aab9958c2329391cdebdf00ada261ae6d7701acb725abc092acafcd8`, with
build ID `84b01dadf5d5e8f16c0733878779337e` and source archive
`1124db59df81a4215a4c63b5c24b15ef953bc7f0bcf7a42037f0b5903512ceb4`.

Fresh build `full-activity-saxbvz24` compiled both native ABIs and passed the
offline release-artifact audit. APK SHA256 is
`3e5a66d6e1e86d539dee75c6adad9d88e550ad591447e3161f4fb2eba68c544c`;
artifact receipt SHA256 is
`22e51d57e88fa85424f9f36349492a966c0e4c89534c09e29b7a38e6d13483e0`.
The changed chat client and lifecycle store separately matched bundled source
map contents exactly. This is an isolated package with no network permission,
not a distributed production build. The new external driver retains the prior
four-CPU runtime and assertions; only artifact pins and associated tests/docs
change. Its checksum manifest is
`af60cccb1470fc3c6cde6b37034176709fd72ffe75b97d7daa1aaedf81df8612`.
Driver checks passed 51 locally and 50 on the app plane, with one explicit
source-checkout-only skip remotely. Runtime acceptance is not implied.

Actual attempt `device-attempt-eqqz7ppj/after-secret-delete-dm6d4_fe` passed
clean AOSP provisioning, the native writer barrier, exact reset preservation and
`production_ready`. Its journal check reported one security operation, zero
legacy operations and the expected terminal epoch. After an observed background
transition, warm-resume verification failed with an unclassified `Error` before
`production_warm_ready`. The scenario remains FAIL and the other two scenarios
did not run. Owned cleanup succeeded; original5554 was unchanged.

The retained diagnostics do not establish the warm failure's cause. The test
overlay repeatedly opens transient SQLite wrappers, unlike the production
cache's retained promise. Installed Expo source caches native database objects
and closes their binding on shared-object release, making wrapper lifetime a
specific test-harness risk. A separate diagnostic candidate will retain its
handle and emit finite verification-step/error categories without raw exception
text. This is not yet a demonstrated fix or permission to ignore SQLite errors.

Additional exact-path cleanup reclaimed 1,908,121,600 bytes of completed native
Rust output and 1,970,135,040 bytes of old Android intermediates. Final APK hashes
were checked before and after; source, signing material, evidence, snapshots and
AVDs were retained. These removals do not establish a general retention policy.

After the new run finished, its reproducible compiler output reclaimed another
3,411,816,448 bytes. Sixteen reviewed generated `android/build` and `android/.cxx`
directories inside four native dependency packages across two inactive runs
reclaimed 2,944,765,952 bytes. These per-run dependency outputs are outside APK
retention. APK/source-map/receipt hashes remained unchanged; package sources and
all test evidence were retained.

The separate V5 test overlay retains one database-opening promise per process,
including a rejected promise, rather than implicitly reopening after errors.
It labels verification failures with fixed step/native-error categories while
preserving all 47 acceptance predicates and the unchanged readiness observer.
Parent reruns passed 32 Node and 31 Python checks, including concurrent opens,
synchronous/asynchronous opening failure, overlapping verification and hostile
error-object redaction. These do not demonstrate Android lifetime behavior.
Its new frozen stage manifest is
`45ce55bf4e3c1e43ad28c556275c943e36805653fa6b53fafdc9ed9de1a14a12`,
build ID `7bd6edc838d2246b464822e1c999ff3d`, still using mobile commit
`80c0b690abbfa0946ee37a58703da2457d006f94`. The new build and emulator outcome
must be recorded separately; neither earlier failed attempt is overwritten.

Sixteen more reviewed dependency compiler directories in the inactive
`full-activity-v_j9nhlg` and `full-activity-fpofst66` runs reclaimed
2,944,380,928 bytes. Both runs' APK, source-map and receipt hashes were verified
before and after. No source, evidence, shared cache or emulator was removed.

### Retained-Handle Recovery Result

Fresh run `full-activity-dlxe45n8` compiled both ABIs from the same mobile
commit and passed the offline Release artifact audit. APK SHA256:
`8c00d6288efb82fb1db5d9ea9217c840d0dbef956f6f028b7db3fbb69c86b035`.
Receipt SHA256:
`680f9405d250774532aaae22070525831c9de70071f81a2478caefafdb7a7fc8`.
Source-map SHA256:
`6d9f82910c2dc9b618c59ca81589212b8fc6e83872a00b4e5c6dcaa0d27db788`.
Its completed Rust/compiler intermediates were removed only after receipt,
APK and source-map checks, reclaiming 3,411,824,640 bytes with hashes unchanged.

First attempt `device-attempt-4nb1hhe2` passed after-secret-delete, including
warm resume and repeat process restart. The second fresh AVD stopped before
app installation because `adb root` reported a closed transport; the third
scenario did not run. Both owned emulators shut down and original5554 remained
unchanged. This partial series remains failed evidence, not a three-case pass.

A separately reviewed driver reconciles only that exact ambiguous root response:
one root request, reconnect, then independently require the same owned emulator,
UID 0 and unchanged boot identity within the EXISTING total 60-second phase.
All other failures remain fatal. A hash-pinned, exclusive reservation permits
one reviewed new series and verifies cleanup of the prior attempt. It neither
invents prior start records nor reuses AVDs. The full driver delta and unchanged
app/reset predicates are checked. Sixty-five local tests passed; the app plane
passed 64 with one explicit source-checkout-only skip. Independent review found
no blocker. Driver checksum manifest:
`80e2526d8316bd5562655287501df719aa72f25cc7c695e648f35b0f9458288d`.

Reviewed retry `device-attempt-6xdz0xks` passed all THREE fresh AOSP 34 cases:

| Interruption | Scenario receipt SHA256 |
| --- | --- |
| After secret deletion | `ae304baa9e6c6e037c0b000ecc98ac7bbb2130f1615924b79aee749d4e489ea8` |
| After lifecycle SQL reset | `ec671fe97088cd80710e301dca0f7b0c100ca6902d48ea830a2a6d0b947c3bf5` |
| After SQL commit, miniapp-initiated | `3eff011fb0b8f7d51bda3d45e55db4657801d6ac3df5ee6920221e4d30654272` |

Series receipt SHA256:
`f066e6dcc8458ab0ace58436b79302bd71d25cf747026f2a3a11974665e27e53`.
Every scenario demonstrated exact unrelated fixture preservation, native
ordinary/CAS stale-writer rejection, recovery after all package processes were
killed, underlying main-root local work, same-process/task/JS warm resume, and
another process restart with repeat warm readiness. All owned processes stopped;
original5554 identity remained unchanged. Six warm/repeat screenshots were
manually reviewed: the Communications UI was visible, with the expected synthetic
fixture's locked-messaging state and no startup blocker or ANR overlay.

All six root transitions in the passing series returned normally; actual
ambiguous-response reconciliation remains mock-tested, not observed on-device.
The passing retained-handle overlay supports the wrapper-lifetime diagnosis but
does not prove the earlier unclassified native error's exact cause.

This closes ONLY the isolated offline, fresh-app/provisioned-OS recovery scope.
The APK has no Internet permission and uses a test biometric bypass. GMS, real
biometrics, live delivery/rotation, miniapp business work, native proofs, physical
Android, iOS and full production startup remain unapproved. No production reset,
SDK promotion, messaging activation or release deployment follows from this pass.

### Provider Containment Preparation

Read-only Vercel UI inspection on September 25 reconfirmed the current production
identities as Safety `5286eaef48455efc4aa67674b493c1afd45c0cda` / deployment
`6MfaZ3dQ4BcnJcGPg7bvZFjgWFK3`, and Supermarket
`fd75ef66acc8f5d906b15852753dfe66a3a889f6` / deployment
`gvApShTNecnyH8DyqhVr6bB3gggJ`. Public GETs to both login challenge routes still
returned 503, without submitting any account or session data.

Two isolated local branches now contain ONLY the reviewed proxy matcher change:

- Safety: `b999d37ee42f69f4f7670d0dd7e4093c052281e7`.
- Supermarket: `cfcca3f10154b79574c2f645e59fd7580ec3d92a`.

Both author and committer are `Xevorius <tim.is@live.nl>`. Each commit has exactly
one changed matcher line and the verified production revision as its parent.
Four containment checks pass; actual worktree contents separately match the
expected one-line transformation. Newer provider auth/TLS work was not included.
At this preparation checkpoint neither branch was pushed or deployed. Vercel CLI required a fresh login; the
signed-in browser displayed a disabled authorization button and the bounded CLI
attempt ended without authorization. No UI restriction was bypassed.

Windows time service remains stopped. The final read-only midpoint probe estimated
the PC 4.312 seconds ahead of U-chain with 527 ms round trip. This is not clock
synchronization or a new proof-test pass. The earlier signed-heartbeat failure
remains open; no clock, timing guard or production maintenance flag was changed.

### Provider Containment Deployment

The normal Git integration subsequently removed the CLI authorization blocker
for these two patches. Both preview builds succeeded; preview endpoint access
remained protected/blocked and is NOT counted as an HTTP acceptance pass.

[Safety PR 2](https://github.com/Union-networks/unet-safety-center/pull/2) and
[Supermarket PR 1](https://github.com/Union-networks/unet-demo-supermarket/pull/1)
were fast-forwarded through ordinary Git permissions, without force or an admin
bypass. GitHub marked both merged. Remote `main` retains the exact reviewed
commits above, with `Xevorius <tim.is@live.nl>` as author AND committer. Each diff
is one matcher line; no newer provider auth, database TLS, worker or SDK changes
were bundled into this containment release.

Vercel confirms Ready, Production, Current and the expected custom domain for:

- Safety `2bUeNBtnoVvdD2Vx9H4b22Lapoan`, source `b999d37`.
- Supermarket `GnabRTDmsmMvSsx4zKDKSFHnfudd`, source `cfcca3f`.

All four local matcher/maintenance checks passed again. Ten bounded production
GET checks passed: `/api/unet/domain-admin/issue`, `/api/unet/domain-admin/revoke`
and `/api/unet/login/challenge` return 503 with the expected fixed error,
`no-store`, retry-after 300, and no session cookie or redirect, on both providers.
Both well-known public JSON manifests still return 200 on both providers.
The reproducible read-only probe is
`audit-2026-09-25/verify-provider-containment.mjs` in the parent workspace.
No worker route, POST, credential, account or session data was submitted.

This closes the narrow deployed callback-maintenance gap only. It does not prove
callback authentication/durability, approve production login or messaging, or
authorize toggling the shared maintenance flag off. Production reset, security
epoch activation and stable SDK promotion remain unperformed.

### Revocation Worker Fencing Candidate

Safety source `d581569c587f1fcf8622748424d6913413c9ac51` is committed locally
with Xevorius as author and committer, but is NOT deployed. It adds random
five-minute database-clock job leases, stale-owner confirmation/retry fencing,
and conflict-safe concurrent enqueue. Job confirmation and both exact-credential
child updates commit together. A same-account replacement is not revoked by an
older job. Both completion and retry acquire the row lock before checking current
expiry, with transaction-local lock and statement deadlines.

All 54 focused mock/SQL tests and both isolation wrappers passed. The broader
Safety suite and TypeScript check passed; environment-gated PostgreSQL cases in
the broad suite were not counted as database acceptance.

A separate real PostgreSQL 17 run passed all 22 cases in
`audit-2026-09-25/revocation-postgres/results/safety-40242845b047be4968b6`.
Receipt SHA256:
`3b674f0122b82dbfcf342fb0693a13e50d1b506c8128bbc335afdbe4e1085631`.
The suite uses the actual schema, worker and database queries; ONLY ledger calls
are mocked. It checks concurrent enqueue/claim, immutable conflicts, legacy and
expired leases, paused old workers, unchanged-row lock waits, child-write rollback,
finite error categories/backoff, and replacement preservation. All sources stayed
hash-identical during execution. TLS encryption and negative plaintext, foreign-CA
and hostname tests passed. The owned schema, container, internal network,
forwarding processes and synthetic TLS files were cleaned up.

Three earlier failed fixture runs remain recorded. The first exposed PostgreSQL
`name[]` decoding in the test, corrected with an explicit `text[]` cast. The next
two stopped after 13 cases; diagnostics established a ten-second timeout in the
single grouped backoff case. Its seven unchanged samples are now separate
ten-second cases. A four-minute overall test/five-minute child deadline bounds the
larger suite; no production lease, policy, heartbeat or network limit was relaxed.

This is database-state fencing, not exactly-once EVM submission. A lease check
cannot retract an already-started network request. All old unfenced worker
versions must be stopped/drained before rollout. Domain-admin issuance durability,
real native Android-to-EVM acceptance, phone verification and the production
cutover remain separate open gates. No provider database or ledger was changed
by these fixtures.

### Safety Ledger Transport Candidate

Safety source `d4376f8120d62015449e82b80ee25702db6b3322` is committed locally
with Xevorius as author and committer, NOT deployed. The app-private transport
bounds status/nonce/submission reads to ten seconds including the streamed body,
caps JSON at 64 KiB, disables redirects and validates explicit success, protocol,
exact commitment/issuer bindings and canonical uint256 nonces. Relayer failover
reuses the identical signed payload within twenty seconds. Confirmation polls
within thirty seconds; unavailable reads fail with finite categories rather than
changing lifecycle. No SDK API, cryptography or contract change is included.

All 189 focused mocked-transport tests passed. The broad Safety suite passed 228
with zero failures and two reported skips, and TypeScript passed. Tests cover
abort-ignoring headers/bodies, late responses, aggregate budgets, cancellation,
malformed and oversized responses, wrong bindings, unchanged signed failover
payloads and privacy canaries. They do NOT prove deployed ledger or Android
behavior. See Safety `tests/ledger-transport-acceptance.md` for reproduction.

Independent review reproduced a remaining issuance recovery defect: the SDK can
mark a request terminally failed after a committed anchor's response is lost.
Retrying the same signed operation is not enough; an already-known rejection
must lead to durable exact-commitment/receipt reconciliation with the original
encrypted artifact, not a newly built credential. This remains a release gate;
these transport results do not approve reopening issuance. Revocation's durable
job retries are separate from issuance recovery. Production remains paused.

### Safety Application Error Privacy Candidate

Safety source `b9adbc17b64ad1a0e3fe85c6b6f2179bdb48bf32` adds the application
route privacy fix on top of the transport checkpoint. It is local-only, with
Xevorius as author and committer. Authentication, initialization and body parsing
now share the private failure boundary. All responses use `no-store`; unknown
exceptions become a fixed 503 response and finite database error category.
Only the exact two known policy denials retain HTTP 403. Arbitrary prefixes,
exception-supplied statuses, raw SQL/transport messages and nested causes are
neither returned nor stored. Normal delivery and missing-context UX are retained.

The actual route passed 85 isolated regression cases plus its enclosing test
(86 total), with mocked dependencies and synthetic canaries. The broader Safety
suite passed 229, failed zero and reported two skips; typechecking passed.
See Safety `tests/application-privacy-acceptance.md`. This is not a production
logging audit or issuance-recovery acceptance. No production setting, wallet,
provider database or ledger was changed by these local tests.

The parent-workspace note `audit-2026-09-25/direct-issuance-recovery-gap.md`
records the separate immutable-artifact, fenced-worker, receipt-reconciliation
and delivery-capability recovery work. It is design/source-review evidence only.

### Native Android Proof To Isolated EVM Acceptance

The subsequent fresh owned-emulator run passed. Five new SSH midpoint samples
measured the Windows clock approximately 3.94-3.99 seconds ahead, with 530-642 ms
round trips. The stopped Windows time service alone did not establish a current
gate failure. Original five-second guards stayed unchanged; earlier failed runs
remain failures. This measurement does not replace proper clock synchronization.

Evidence: parent-workspace
`audit-2026-09-24/native-evm-candidate/cache/run-H8uDOp/evidence.json`, SHA256
`76b7d492a7c2aa7e48ef1b5a24c878707ce0eaa9e80e8bb0d5ff946cb6893fe2`.
Android build receipt SHA256:
`5fed75e25418ec03638e20f4ce69443cba8a55a0b0bf828fbc6af3d5ba9cabde`.
The owned AOSP Android 14 x86_64 emulator generated three actual JNI proofs for
one freshly signed credential anchored on a disposable Besu Ledger V2 instance.
The real WASM verifier, PostgreSQL and policy implementation accepted the intact
proofs. Tampering, another sender, another challenge nonce and replay failed.
No proof verifier or policy override was injected.

After actual holder revocation, an old grant's sender registration was denied
within an inclusion-relative upper bound of 6.511 seconds. Checks at approximately
20.4 and 41.4 seconds remained denied, including after negative-cache expiry.
This proves the registration subcase only, NOT the complete send/fetch/acknowledge
freshness requirement. Sender signatures came from the Node test driver, not
the Android wallet. Full-wallet integration, physical-phone acceptance, push and
iOS remain separate gates.

Fixture cleanup succeeded, the owned emulator session was released and stopped,
and the original emulator's identity remained unchanged. The exact owned reverse
tunnel was stopped after process identity verification. No production chain,
wallet, service flag, reset or security epoch changed.

### Private Issuance Recovery Journal Candidate

SDK local checkpoint `14626a66c7a807699f2fd225ea9a68a5a32eabbb` adds the new
issuer-private recovery kernel and PostgreSQL adapter. They freeze request,
recipient, credential-key fingerprint, validity, chain, contract, issuer epoch
and confirmation policy. They persist preparation, signed submission and receipt
checkpoints under revision/token/database-clock fences. Retries retain immutable
artifacts; a late worker cannot overwrite them. These modules are deliberately
absent from the package's public entry point and are not used by production.

All 317 focused state/SQL tests, all 381 issuer tests and issuer TypeScript
checking passed. Real PostgreSQL 17 acceptance passed 16 cases using the actual store and queries:
concurrent reservation/claim/transition, immutable conflicts, stale revisions,
lease takeover, expiry during lock waits and after the clock sample, SQL rollback,
JSON/index projection atomicity, deferred retries, corrupt-row rejection and
rollback-failure connection eviction. The last case executes a real write,
injects a lost response and failed rollback, verifies that the backend disappears
and its uncommitted write rolls back, then completes a normal retry.
The ledger artifacts in this suite are synthetic, not EVM acceptance.

Receipt: parent-workspace
`audit-2026-09-25/issuance-postgres/results/safety-5f31c20b2bc1505489ed/result.json`,
SHA256 `6bd12fea3c8385e9838d5a8584ab7472a9ff90e260a2929ab6d5f8c70ed0fad4`.
TLS encryption, plaintext rejection, foreign-CA rejection and hostname rejection
passed. Source hashes stayed unchanged. The owned schema, container, network,
forwarders and synthetic TLS files were cleaned up.

The earlier 15-case receipt remains historical evidence for its exact source.
Independent review then found failed rollback returning a damaged connection to
the pool and regex coercion accepting array-valued addresses/hashes/signatures.
Both are fixed and covered by regressions before the final 16-case run. Failed
rollback now destroys the connection without replacing the original exception;
immutable records reject non-string scalar values before persistence.

This is a storage foundation, not completed issuance recovery. Its receipt
checks enforce shape/bindings, not independent chain verification. A verified
receipt resolver, provider-policy-locked publication, durable worker scheduling,
issuer nonce/deadline recovery and authenticated delivery-capability recovery
remain required. No public API, package release or production activation is
approved by these results.

### Private Canonical Anchor Evidence Candidate

Ledger local checkpoint `99b81ef6b470c6ab8309d18aa7979457511379f2` adds a private
receipt verifier, without registering any route or changing the public protocol.
Both author and committer are Xevorius. It snapshots the expected signed operation
and checks chain/contract, exact canonical calldata, successful receipt, matching
anchor event, block membership, inclusion time and required confirmations. It
reads exact active status using EIP-1898 canonical block-hash pinning, then checks
the canonical blocks and chain again. Timeouts and cancellation have finite,
sanitized outcomes. The configured RPC and contract remain trusted; this is not
a light-client or independently verified finality proof.

All 160 mock-RPC cases pass, along with the full ledger build. The disposable
Besu suite passes all 11 cases, with 96 successful and 42 intentionally reverted
transactions. The new real-EVM case recovers the original receipt, rejects
changed request/signature inputs, rejects insufficient confirmation depth and an
absent transaction, then refuses delivery following actual holder revocation.
No injected RPC results are used by that case. Existing governance, issuer-key
rotation/suspension/recovery and revocation regressions still pass.

The separate ordinary ledger suite passes 238 tests and explicitly skips its 11
environment-gated EVM tests; the dedicated run above executes them. See ledger
`docs/anchor-recovery-acceptance.md` for source hashes, commands, toolchain and
limits. The existing owned fixture runner was unchanged. Its container and
network were removed and the tunnel listener was gone. No production contract,
wallet, validator, maintenance flag or security epoch changed.

This verifier is not yet connected to the private SDK recovery journal. Index
candidate discovery, bounded provider-facing reconciliation, durable worker and
nonce/deadline recovery, policy-locked publication and authenticated delivery
capability recovery remain open. The source must not be deployed or exposed as
completed issuance recovery on the strength of component tests alone.

## Standards Evaluation Boundary

The isolated standards lab is not a prerequisite for reopening a proven secure
Android release. It is not part of the stable SDK train and cannot authorize
production login, credentials or messaging. Keep comparative results and fit
gaps separate from the security acceptance matrix.
