# Privacy interoperability research proposal

Status: proposal only. No credential, proof, ledger, or revocation protocol is
changed by this document. Preserve U-net's locally owned relationship lifecycle
while testing standards adapters before inventing another provider ecosystem.

## Candidate approaches

| Approach | Useful property | Questions the prototype must answer |
| --- | --- | --- |
| SD-JWT | Selective disclosure using JWT-based mechanisms | Does repeat use expose stable signed material, holder keys, or status references? Do not treat selective disclosure as unlinkability. |
| BBS-derived proofs | Selective disclosure with randomized derived proofs | Can predicates, device performance, holder binding, and revocation meet U-net requirements without introducing correlatable public inputs? |
| AnonCreds | Anonymous credential presentations with predicate and non-revocation mechanisms | Assess witness updates, mobile support, operational complexity, recovery, and independent implementation compatibility. |
| Shared status lists | Fetch status in groups instead of credential-specific status requests | Measure issuer/verifier correlation, stable indexes, caching, freshness, and the size of the actual anonymity set. |
| Private membership/status proofs | Prove current membership against a shared authenticated state | Evaluate witness distribution, update costs, malicious publishers, stale state, and independent cryptographic review. This is research, not an approved custom protocol. |

The baseline specifications are [SD-JWT](https://www.rfc-editor.org/rfc/rfc9901.html),
[BBS cryptosuites](https://www.w3.org/TR/vc-di-bbs/),
[AnonCreds](https://anoncreds.github.io/anoncreds-spec/), and
[Bitstring Status List](https://www.w3.org/TR/vc-bitstring-status-list/).
The table's deployment tradeoffs are questions for U-net's prototype, not claims
that these mechanisms already solve U-net's traffic-analysis problem.

## Adapters first

Prototype [OpenID4VCI issuance](https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0.html)
and [OpenID4VP presentation](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)
as adapters around provider-owned storage and wallet consent. Keep transport
interoperability separate from the credential format and status mechanism.
Preserve per-service account keys, clear consent, retirement, and holder-controlled
revocation. Do not label the current Direct Login protocol OAuth/OIDC-compliant.

## Required experiment

1. Freeze an adversary model covering colluding providers, issuers, gateways,
   verifiers, messaging operators, and the shared infrastructure administrator.
2. Implement two candidates using maintained implementations and synthetic data.
3. Capture all public inputs and network metadata over repeated presentations,
   renewals, revocations, replacements, and persona retirement.
4. Measure Android/iOS proof latency, memory, battery cost, offline behavior, and
   freshness under outages. Measure anonymity sets rather than counting hashes.
5. Compare correlation from status lookups, issuer keys, disclosed attributes,
   delivery routes, timing, and network addresses. Cryptographic unlinkability
   does not by itself hide traffic patterns.
6. Require an independent cryptographic and protocol review, test vectors, and
   interoperability tests before proposing any production migration.

Deliver a decision record with rejected alternatives, a privacy budget for public
inputs, operational costs, and migration/rollback constraints. No production
credentials or ledger history are rewritten as part of the experiment.
