---
name: Payment follow-up vs. full history
description: Product distinction between outstanding-balance follow-up and the all-time Balance Payment register.
---

Balance follow-up contains only orders with a remaining balance. The separate Balance Payment register contains the complete all-time payment and refund history, including completed payments. Recent Receipts is a convenience view of recent received entries, not a replacement for the full register.

For “most late” priority in Balance follow-up, use the oldest order creation date first because payment due dates are not recorded; break ties by highest remaining balance.

**Why:** The product owner explicitly separated operational follow-up from the complete historical ledger and selected order age as the overdue measure.

**How to apply:** Keep Balance follow-up limited to outstanding orders and use `orderCreatedAt` for its overdue sort. Keep lifetime receipts and refunds in Balance Payment, even when its order-date filter narrows which orders appear.
