---
"@u-net/server": patch
"@u-net/web-login": patch
"@u-net/react": patch
---

Prepare the coordinated SDK 2 release candidate with refreshed API reports,
browser-bound exchange examples, and lease-token-fenced retirement cleanup
migration guidance. Update the PostgreSQL regression test to use claimed leases.
No session-ID redemption or legacy store compatibility is restored.

This candidate is packed for provider integration testing only. Publication,
deployment, session invalidation, and the maintained-provider integration matrix
remain separate coordinated release gates.
