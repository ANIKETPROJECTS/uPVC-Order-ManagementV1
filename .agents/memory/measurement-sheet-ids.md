---
name: Measurement Sheet IDs
description: Stable user-facing identifiers for measurement records and their Rate Approval links.
---

Display measurement IDs as `MS-{YY}-{sequence padded to at least 4 digits}`, using the record's creation year in Asia/Kolkata. Allocate sequence numbers globally and never reuse them after deletion. Keep the raw UUID as the permanent internal key; preserve old display IDs and the former `MS-{UUID}` alias as searchable legacy IDs.

**Why:** Staff requested compact IDs such as `MS-26-0001`, while existing references and the global sequence must remain stable through format changes.

**How to apply:** Use an atomic server-side counter for new sheets. Derive the two-digit year from the creation timestamp in IST. Migrate old labels while preserving sequence values and keep both prior formats searchable.