---
name: Order-specific site addresses
description: Site addresses are order-specific and distinct from a client's saved address.
---

**Rule:** Store the physical site address on each order, separately from the client's saved address. Order-level edits to client name, type, phone, address, or GSTIN must also stay on that order snapshot and must not modify the shared client profile unless the user explicitly chooses a profile-level edit.

**Why:** A client can have separate project or installation sites, and the user explicitly selected order-only edits so one order's corrections do not alter shared client data or other orders.

**How to apply:** Prefill a new order from the client address when useful, let staff override it per order, and use the client address only as a legacy fallback when an order has no saved site address. Keep order-detail client edits on the order record.
