---
name: Order IDs from quotations
description: Required Order ID format and safe handling of legacy orders without quotation links.
---

Project orders use `P` followed by the linked quotation number's digits after removing `QT-` and leading zeroes; Retail Client orders use `R`. Do not add dates. A quotation can be linked regardless of whether its customer name or client profile matches the order. Preserve the order's own client ID, type, and details; use the quotation only as the linked quote/ID source. Keep internal order-record IDs and historical audit entries stable.

New orders may be created before a quotation exists. Give those orders a unique `TMP-` ID based on the global order sequence. When a valid quotation is linked, replace the temporary ID with the canonical P/R ID and refresh current order-related snapshots; preserve the order's client details and historical audit text.

**Why:** The user wants to choose quotations even when their customer names differ from the order's manually entered or saved client name. Order IDs still need to reflect the selected quotation number and the order's Project/Retail type.

**How to apply:** Offer all active, non-sample `QT-` quotations in create, edit, and link-later selectors. Use a sequence-based temporary ID only for newly created unlinked orders; when linking, validate quotation eligibility, single-order use, and Order ID uniqueness, but do not filter or reject by client name/profile. Update current records keyed to the order while leaving its client details and historical audit text unchanged.
