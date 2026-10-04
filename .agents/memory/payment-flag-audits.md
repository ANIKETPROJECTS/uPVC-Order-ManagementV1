---
name: Flagged payment audits
description: Product rules for payment issue flags, ledger isolation, amount snapshots, and action history.
---

Payment flags are operational issue records, not payment transactions. Creating, resolving, or removing a flag must not change receipt statuses or Paid. Paid is received receipts minus refunds; void and bounced receipts are excluded. Each receipt is exactly received, void, or bounced. A bounced-payment flag records the user-entered bounced amount; a refusal-to-pay flag snapshots the order’s outstanding balance when created. Removing a flag is a soft removal, and created/resolved/removed actions retain their actor and timestamp.

`flaggedAt` is the user-selected effective date (default to today in Asia/Kolkata); preserve the current time-of-day when storing it so existing timestamp displays remain useful. Keep the created action’s `occurredAt` server-owned and equal to the real save time, even when `flaggedAt` is backdated.

**Why:** Backdating is business chronology, not audit chronology. The flag date may be corrected without rewriting when the record was actually created.

**How to apply:** Keep flag status and history separate from the payment ledger. A bounce may offer a prefilled flag using the bounce date, but the flag is never the ledger action. Do not recalculate a saved flag’s amount from later payment edits. Display `flaggedAt` in flag views and retain actual save time in action history.