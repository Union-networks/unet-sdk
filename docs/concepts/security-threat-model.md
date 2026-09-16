# Security and privacy boundaries

Status: implementation threat model, 16 September 2026. The security-2 changes
are staged, not a statement that production has completed the hardening cutover.

## What each participant can learn

| Participant | Observable information and correlation limits |
| --- | --- |
| Provider | Its scoped account ID and public key, service sessions, actions, and any information the holder explicitly shares. It can correlate repeat use of that account. |
| Issuer | Its applications, issued commitments, delivery records, renewal/replacement relationships, and the claims it issues. Safety Center additionally holds submitted reports and sanctions. |
| Verifier | Requested predicates, the proof result, public proof inputs, and credential commitments exposed by the current protocol. Repeated commitments permit correlation even if claims remain private. |
| Messaging operator | Mailboxes, ciphertext timing/size, sender bindings, credential commitments used for access, and device-delivery routing. Shared commitments and delivery routes can link activity across mailboxes. |
| Ledger/read gateway | Public anchors, revocations, issuer authority, and exact commitment queries. Gateways can observe request timing and network metadata. No plaintext claims are required on-chain. |
| Contact | The pairwise identity, messages addressed to them, message timing, and anything the holder shares. They need not receive the Safety Center account ID, but this is not operator-level unlinkability. |
| Infrastructure administrator | Host/network metadata and data or keys available to the processes they administer. Colocated services do not provide independent protection against this administrator. Ciphertext is not proof of traffic anonymity. |

Avoid unqualified claims that messaging or credential presentations are
"unlinkable". Hashing a stable identifier does not remove linkability to an
operator that sees repeated hashes or holds the hashing key. The four-validator
deployment is a single-physical-host tester beta, not physical fault isolation.

## Security properties targeted by this release

- QR contents are public approval context, not browser redemption authority.
- Browser cookies and transactional stores prevent observers from exchanging
  another browser's approval. Native bridges approve, but do not redeem.
- Messaging authorization must require a valid credential possession proof and
  sender-key signature; a public commitment or sender key is never sufficient.
- Chain and suspension policy must be fresh within 20 seconds for live messaging.
  A dependency outage means temporary unavailability, not credential revocation.
- Retirement is irreversible locally; provider cleanup is durable and retryable.
- Wallet lifecycle and network freshness are separate. Failed synchronization
  cannot erase the last authoritative lifecycle state.

These are release acceptance requirements. See the rollout checklist before
assuming they are enforced by a particular deployed build.

## Trusted and untrusted inputs

The official unmodified wallet is the supported client for local account limits.
That assumption does not authenticate arbitrary HTTP callers or replace server
verification of signatures, proofs, ownership, or nonces. A compromised provider
origin, stolen device secrets, or malicious browser code remains a separate
threat; an HTTP-only cookie does not prevent same-origin XSS from making requests.

Moderation applies to personas and their relationships, not permanent human
identities. Retiring a persona can release the local account slot. No stronger
personhood guarantee or global holder registry is introduced.

## Operational requirements

Log route templates, bounded outcome codes, timings, and random diagnostics.
Do not log URLs, headers, cookies, proofs, bodies, credential commitments, scoped
IDs, mailbox IDs, capabilities, or raw exception messages. Test proxy and tracing
layers separately from application logging. Rotation must invalidate leaked
capabilities; removing a log alone does not restore secrecy.

Privacy-safe counts may describe incidents; do not export secret-bearing logs
for investigation. Preserve case evidence only under its established retention
policy. Do not reset ledger history during the messaging authorization reset.

## Explicitly unresolved

- Operator correlation through stable credential commitments and delivery routing.
- Dashboard provider-storage extraction from shared control-plane deployment.
- Independent validator hosts and governance-custody separation.
- Full standards adapters and independently reviewed anonymous presentations.
- Additional wallet recovery and resistance to modified wallets or Sybil attacks.

These are follow-up projects, not fixes delivered by security-2.
