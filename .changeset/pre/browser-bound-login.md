---
"@u-net/server": major
"@u-net/web-login": major
"@u-net/react": major
---

Bind Direct Login redemption to a per-attempt HTTP-only browser cookie. Status
returns lifecycle state only; exchange accepts requestRef, never sessionId.
Approval/account binding and exchange are transactional in the PostgreSQL adapter.
Retirement accepts delayed signed operations and persists provider cleanup jobs.

This change belongs to the coordinated 2.0.0 release-candidate train. Do not
promote or deploy without updated providers, dashboard proxies, mobile miniapp
bridge, session invalidation, and maintained-provider integration tests.
