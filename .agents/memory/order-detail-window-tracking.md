---
name: Order detail window tracking
description: Per-window room, glass/mesh type and shutter quantities shown on order details.
---

Keep one canonical window row per opening, with room/location, type, dimensions, and lot assignment. A null quantity means it is not recorded; zero means not applicable. Store each frame and glass/mesh shutter as an individually identified piece with its own status and software-generated QR; derive window/order/lot summaries from those pieces. Ready counts must not exceed totals. Continue displaying legacy aggregate statuses when granular piece records are absent.

**Why:** The user’s latest data-linking specification supersedes the earlier pause on production scans: each piece QR scan must update that piece’s own status, while the window table remains the single source for quantities and summaries.

**How to apply:** Do not create duplicate window entries or infer missing type counts. Use the editable Window Type Library and require review when a type is not configured. Lots stay on windows; dispatches select existing lots. Preserve legacy records until explicitly migrated.
