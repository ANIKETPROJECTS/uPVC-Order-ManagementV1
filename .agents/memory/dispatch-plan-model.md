---
name: Dispatch plan model
description: Persistent choices for lot-wise dispatch records and the legacy order-level status.
---

Store dispatches inside the order document. Each entry carries its editable D-number, optional project lot, selected window IDs, independent status, and timestamps. Derive the displayed tracking ID from the stable order ID, lot ID (when present), and dispatch number; do not replace the order's canonical ID.

Keep `dispatchStatus` on the order as a compatibility summary for existing delivery and installation flows: it is delivered only when every dispatch is delivered; dispatched when at least one dispatch has progressed beyond pending; otherwise pending. Order-level QR status changes intentionally apply the selected status to every embedded dispatch.

**Why:** MongoDB is standalone in this project, so a shipment and its parent-order status must be changed atomically without transactions. Existing installation eligibility also depends on the order-level delivery status.

**How to apply:** When changing dispatch data, update the embedded plan and its aggregate status in one order-document write. Preserve stable order IDs and guard plan edits against stale revisions.
