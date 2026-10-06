---
name: Quotation request IDs
description: Stable format and sequencing for new quotation approval requests.
---

New quotation request IDs use `QTR-{sequence}-{DDMMYYYY}`. The sequence is global and monotonic, padded to a minimum of three digits; the date is derived from the creation timestamp in Asia/Kolkata. Keep pre-existing request IDs unchanged so approvals, documents, and links continue to resolve.

**Why:** The user requested a dated QTR identifier format, and historical IDs are also used as persistent references.

**How to apply:** Allocate IDs atomically from the quotation-request counter. Do not reset the sequence daily. If historical IDs ever need conversion, update every reference and attached-document association as one deliberate migration.
