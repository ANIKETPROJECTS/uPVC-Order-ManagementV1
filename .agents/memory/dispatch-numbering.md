---
name: Dispatch numbering and lifecycle
description: Durable rules for per-lot dispatch allocation and compatibility with existing order and Installation status behavior.
---

Use a per-lot atomic lock plus a unique `(lot, dispatch number)` constraint when allocating dispatch numbers; do not rely on multi-document transactions. Dispatch records are the source of truth, while the order-level dispatch status remains a derived compatibility summary.

**Why:** The connected MongoDB is standalone, and the existing Installation workflow reads the order-level dispatch status to determine delivery eligibility. Dispatch numbers must remain unique even when a record is cancelled.

**How to apply:** For dispatch API or UI work, create/update/cancel dispatch records first and refresh the order summary from all lot records. Never set the order-level dispatch status directly from a second workflow.
