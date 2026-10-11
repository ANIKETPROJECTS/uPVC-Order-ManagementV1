---
name: Order detail window tracking
description: Per-window room, glass/mesh type and shutter quantities shown on order details.
---

Store room/location, glass and mesh types, and separate total/ready shutter counts on the existing window row. A null quantity means it is not recorded; zero means not applicable. Ready counts must not exceed totals. Continue displaying legacy frame/shutter/glass statuses when granular counts are absent.

**Why:** The user chose persisted tracking fields to support the order-detail design and asked that production QR scans wait rather than changing new component counts automatically.

**How to apply:** Update the existing window record and API contract; do not create duplicate window entries or infer missing counts. Only add QR-driven count changes after the user explicitly requests them.
