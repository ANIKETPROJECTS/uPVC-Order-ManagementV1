---
name: Order detail window tracking
description: Per-window room, glass/mesh type and shutter quantities shown on order details.
---

Keep one canonical window row per opening, with room/location, type, dimensions, and lot assignment. Mesh type is order-wide: changing it applies to every active window, and newly added windows inherit the order setting; do not ask for mesh type in individual window forms. When available, show the confirmation workbook's per-window Mesh value read-only in Overview beside mesh shutter status; use saved window/order mesh values as fallback. The Overview mesh suggestion uses the most common extracted mesh and ignores outside aluminium and NA. A null quantity means it is not recorded; zero means not applicable. Store each frame and glass/mesh shutter as an individually identified piece with its own status and software-generated QR; derive window/order/lot summaries from those pieces. Ready counts must not exceed totals. Continue displaying legacy aggregate statuses when granular piece records are absent. Each window should have an always-visible View action with complete window, piece/QR, and source details; retain its source as manual, external list import, or confirmation schedule, and identify older records with unknown origin honestly.

**Why:** The user specified that mesh type is selected once per order and shared across its windows, while the original confirmation sheet's row-level mesh values should still be visible in Overview. The user’s data-linking specification also supersedes the earlier pause on production scans: each piece QR scan updates that piece’s status, while the window table remains the source for quantities and summaries.

**How to apply:** Do not create duplicate window entries or infer missing type counts. Use the editable Window Type Library and require review when a type is not configured. Lots stay on windows; dispatches select existing lots. Preserve legacy records until explicitly migrated.
