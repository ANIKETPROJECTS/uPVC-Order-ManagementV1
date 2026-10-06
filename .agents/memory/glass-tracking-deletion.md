---
name: Glass tracking deletion
description: Scope and safety contract for deleting glass tracking data from an order.
---

Delete removes the order's active glass tracking entry only. The underlying order remains in the register and returns to the glass-input-pending state; uploaded workbook files and import history remain available.

**Why:** Glass Tracking is a per-order view of procurement data, not the owner of the order itself. Removing its row must not erase the order or its source-workbook audit trail.

**How to apply:** Keep glass-tracking deletion separate from order deletion, state the result in the confirmation, and retain source imports/files unless the user explicitly asks to remove them too.
