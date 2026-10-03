---
name: Measurement Sheet IDs
description: Stable user-facing identifiers for measurement records and their Rate Approval links.
---

Use each measurement record's existing UUID as its permanent ID, displayed as `MS-` plus the uppercase UUID. Persist links to Rate Approval requests using the unchanged UUID; do not introduce a second ID field.

**Why:** The existing record ID is already unique and permanent, so a display prefix provides a recognizable sheet ID without a migration or a second source of truth.

**How to apply:** Keep raw UUIDs in API/database relations, show the `MS-` form in the UI, and allow sheet searches with or without the prefix.