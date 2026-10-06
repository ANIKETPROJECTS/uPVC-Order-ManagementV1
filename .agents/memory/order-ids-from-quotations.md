---
name: Order IDs from quotations
description: Required Order ID format and safe handling of legacy orders without quotation links.
---

Project orders use `P` followed by the linked quotation number's digits after removing `QT-` and leading zeroes; Retail Client orders use `R`. Do not add dates. For existing orders, derive the suffix only from a verified linked quotation and the client's stored type. Never infer it from the order sequence or client prefix, and preserve the old Order ID if the quotation link is missing or ambiguous. Keep internal order-record IDs and historical audit entries stable.

**Why:** The user requires Order IDs to reflect the actual quotation number and client type; the current legacy records may not have quotation links, so an inferred replacement would be false.

**How to apply:** Use the linked quotation's canonical `quoteNo` for new orders and migrations. Preflight current records for missing links, client mismatches, and duplicate target IDs; only migrate unambiguous records, preserve legacy identifiers, and update current denormalized Order ID snapshots that are keyed to the same order record.
