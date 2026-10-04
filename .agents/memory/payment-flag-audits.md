---
name: Flagged payment audits
description: Product rules for payment issue flags, ledger isolation, amount snapshots, and action history.
---

Payment flags are operational issue records, not payment transactions. Creating, resolving, or removing a flag must not change received-payment totals or existing payment statuses. A bounced-payment flag records the user-entered bounced amount; a refusal-to-pay flag snapshots the order’s outstanding balance when created. Removing a flag is a soft removal, and created/resolved/removed actions retain their actor and timestamp.

**Why:** The finance workflow must preserve existing receipt calculations while making payment issues visible and auditable.

**How to apply:** Keep flag status and history separate from the payment ledger in future finance changes. Do not recalculate a saved flag’s amount from later payment edits.