---
name: Order detail window tracking
description: Per-window room, glass/mesh type and shutter quantities shown on order details.
---

Keep one canonical window row per opening, with room/location, type, dimensions, and lot assignment. Mesh type is order-wide: changing it applies to every active window, and newly added windows inherit the order setting; do not ask for mesh type in individual window forms. A null quantity means it is not recorded; zero means not applicable. Store each frame and glass/mesh shutter as an individually identified piece with its own status and software-generated QR; derive window/order/lot summaries from those pieces. Ready counts must not exceed totals. Continue displaying legacy aggregate statuses when granular piece records are absent.

**Why:** The user specified that mesh type is selected once per order and shared across its windows. The user’s data-linking specification also supersedes the earlier pause on production scans: each piece QR scan updates that piece’s status, while the window table remains the source for quantities and summaries.

**How to apply:** Do not create duplicate window entries or infer missing type counts. Use the editable Window Type Library and require review when a type is not configured. Lots stay on windows; dispatches select existing lots. Preserve legacy records until explicitly migrated.
