---
name: Measurement Sheet IDs
description: Stable user-facing identifiers for measurement records and their Rate Approval links.
---

Display measurement IDs as `MS-{sequence padded to at least 3 digits}-{DDMMYYYY}`, using the record's creation date in Asia/Kolkata. Allocate sequence numbers globally and never reuse them after deletion. Keep the raw UUID as the permanent internal key for relationships and routes; retain the former `MS-{UUID}` label as a searchable legacy ID.

**Why:** Staff need short, chronological sheet IDs while existing internal links must remain stable through the format change.

**How to apply:** Use an atomic server-side counter for new sheets. Migrate old sheets in creation-time order, derive each date from its creation timestamp in IST, and search both current and legacy IDs. When the display format changes, preserve the existing sequence, raw UUID, and legacy label.