---
name: Confirmation billing overpayments
description: Product rule for extracted final billing amounts that are below payments already received.
---

Allow an extracted Final Billing Amount to replace the saved order value even when received payments exceed the new amount. Keep receipt and refund records unchanged, and display the positive difference as overpaid rather than as a negative balance.

**Why:** The product owner explicitly chose to apply the confirmation's final billing amount and show the resulting overpayment.

**How to apply:** When processing confirmation billing updates, do not reject a lower total solely because of prior receipts; make the overpaid amount clear in order and payment summaries.
