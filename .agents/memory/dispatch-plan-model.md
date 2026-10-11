---
name: Dispatch plan model
description: Persistent choices for lot-wise dispatch records and the legacy order-level status.
---

Lots belong to the order and must exist before dispatch planning; create them with the order or later from the order detail page. Each project window carries its lot assignment. Dispatch only selects existing lots and ready windows assigned to those lots; it never creates a lot. Entries sharing a D-number belong to the same dispatch batch; each lot in that batch keeps its own selected window IDs and independent status. Derive the displayed tracking ID from the stable order ID, normalized lot sequence, and batch D-number; do not replace the order's canonical ID.

Use one stored window record per opening. Generate internal piece QR labels that identify the order, window, and component; scanning Frame marks frame ready, Glass marks glass received, and Mesh marks shutter ready. Do not duplicate window records in dispatch or other views.

Keep `dispatchStatus` on the order as a compatibility summary for existing delivery and installation flows: it is delivered only when every dispatch is delivered; dispatched when at least one dispatch has progressed beyond pending; otherwise pending. Order-level QR status changes intentionally apply the selected status to every embedded dispatch.

**Why:** The user defined lots as project planning data, not shipment data; dispatches can contain multiple existing lots without creating them. MongoDB is standalone in this project, so a shipment and its parent-order status must be changed atomically without transactions. Existing installation eligibility also depends on the order-level delivery status.

**How to apply:** Allocate project lot IDs when creating a project order or adding a lot from that order's detail page. Enforce window-to-lot membership when saving dispatch plans; keep independent lot statuses and aggregate the order status for downstream delivery. Preserve stable order IDs and guard plan edits against stale revisions. QR scans must update only their identified component through the existing role permissions.
