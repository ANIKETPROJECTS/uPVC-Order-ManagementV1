---
name: Standalone MongoDB support
description: The connected MongoDB endpoint does not support multi-document transactions.
---

**Rule:** Do not assume the connected MongoDB supports replica-set transactions; check its topology before using transactional writes in operational routes.

**Why:** The configured endpoint reports as standalone, where `withTransaction` fails with “Transaction numbers are only allowed on a replica set member or mongos.”

**How to apply:** Keep Installation team, schedule, and status flows functional on standalone MongoDB, while retaining transactions when the topology supports them.
