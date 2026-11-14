---
name: Quotation IDs
description: Shared human-readable ID sequence for quotations and rate requests.
---

Quotations use `QT-{YY}-{4-digit sequence}` IDs; rate requests use `RR-{YY}-{4-digit sequence}` IDs. Both use the yearly counter based on Asia/Kolkata creation dates. Keep quotation Mongo `_id` values stable. When migrating rate-request IDs, preserve the prior public ID as `legacyId` and update measurement, document, notification, and URL references together. Gaps in counters are acceptable; never reuse an issued number.

**Why:** The user distinguishes quotations (QT) from rate requests (RR); separate prefixes prevent confusion while preserving one annual sequence.

**How to apply:** Use the same yearly sequence allocator for new QT and RR records, but format each with its correct prefix. Retain old rate-request aliases and update stored references during migration.
