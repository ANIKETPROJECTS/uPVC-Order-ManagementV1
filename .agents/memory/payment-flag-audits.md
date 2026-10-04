---
name: Flagged payment audits
description: Product rules for payment issue flags, ledger isolation, amount snapshots, and action history.
---

Payment flags are operational issue records, not payment transactions. Creating, resolving, or removing a flag must not change receipt statuses or Paid. Paid is received receipts minus refunds; void and bounced receipts are excluded. Each receipt is exactly received, void, or bounced. A bounced-payment flag records the user-entered bounced amount; a refusal-to-pay flag snapshots the order’s outstanding balance when created. Removing a flag is a soft removal, and created/resolved/removed actions retain their actor and timestamp.

**Why:** The finance workflow needs one ledger calculation across balances while keeping issue tracking auditable and independent from receipt transactions.

**How to apply:** Keep flag status and history separate from the payment ledger in future finance changes. A bounce may offer a prefilled flag, but the flag is never the ledger action. Do not recalculate a saved flag’s amount from later payment edits.