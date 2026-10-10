---
name: Dispatch plan model
description: Persistent choices for lot-wise dispatch records and the legacy order-level status.
---

Store dispatch lot entries inside the order document. Entries sharing a D-number belong to the same dispatch batch; each project lot in that batch keeps its own selected window IDs and independent status. Derive the displayed tracking ID from the stable order ID, normalized lot sequence (when present), and batch D-number; do not replace the order's canonical ID.

Keep `dispatchStatus` on the order as a compatibility summary for existing delivery and installation flows: it is delivered only when every dispatch is delivered; dispatched when at least one dispatch has progressed beyond pending; otherwise pending. Order-level QR status changes intentionally apply the selected status to every embedded dispatch.

**Why:** MongoDB is standalone in this project, so a shipment and its parent-order status must be changed atomically without transactions. Existing installation eligibility also depends on the order-level delivery status.

**How to apply:** When adding a project lot from dispatch planning, allocate its next L-number and save the new lot, embedded plan, and aggregate status in the same compare-and-set order-document write. Preserve stable order IDs and guard plan edits against stale revisions.
