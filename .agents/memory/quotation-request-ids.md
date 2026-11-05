---
name: Quotation IDs
description: Shared human-readable ID sequence for quotations and rate requests.
---

Quotations and quotation rate requests use one `QT-{YY}-{4-digit sequence}` counter per year, based on Asia/Kolkata creation dates. Keep Mongo `_id` values stable for quotation records. Rate-request records may be migrated to QT IDs, but preserve their prior public ID as `legacyId` and update measurement/document references together. Gaps in allocated counters are acceptable; never reuse an issued number.

**Why:** The user requested one ID style for existing QT and QTR records, while a failed migration attempt can consume a counter before retrying.

**How to apply:** When adding a quotation or rate request, allocate from the shared year counter. When migrating historical IDs, retain searchable legacy aliases and update every stored link before removing an old request record.
