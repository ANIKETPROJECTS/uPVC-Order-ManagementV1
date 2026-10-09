---
name: Order IDs from quotations
description: Required Order ID format and safe handling of legacy orders without quotation links.
---

Project orders use `P` followed by the linked quotation number's digits after removing `QT-` and leading zeroes; Retail Client orders use `R`. Do not add dates. For existing orders, derive the suffix only from a verified linked quotation and the client's stored type. Never infer it from the order sequence or client prefix, and preserve the old Order ID if the quotation link is missing or ambiguous. Keep internal order-record IDs and historical audit entries stable.

New orders may be created before a quotation exists. Give those orders a unique `TMP-` ID based on the global order sequence. When a valid quotation for that same client is linked, replace the temporary ID with the canonical P/R ID and refresh current denormalized snapshots; preserve historical audit text.

**Why:** Order IDs must reflect the actual quotation number and client type without blocking manual order intake before a quotation is ready; legacy records without an unambiguous link still cannot be safely renamed.

**How to apply:** Use the linked quotation's canonical `quoteNo` whenever one exists. Use a sequence-based temporary ID only for newly created unlinked orders; when linking, validate same-client ownership and uniqueness, then update current records keyed to that order while leaving historical audit text and legacy unlinked IDs unchanged.
