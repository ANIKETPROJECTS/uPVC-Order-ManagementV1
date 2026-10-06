---
name: Installation assignment defaults
description: Default member selection and unassignment behavior for active Installation orders.
---

When scheduling or changing an installation, preselect every currently eligible member of the selected parent team or subdivision; keep members individually adjustable. Unassigning an active order clears its team, subdivision, and assigned members but retains its scheduled date and Installation status. Installed orders cannot be unassigned. Marking an order installed still requires an assigned team and a visit date that has arrived in Asia/Kolkata.

**Why:** Users need a fast, complete crew assignment by default, while retaining the visit date avoids losing scheduling context when the crew changes.

**How to apply:** Derive initial member IDs from the selected group's eligible users. For unassignment, clear assignment fields only; preserve the scheduled date and any active Installation issue status.
