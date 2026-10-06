---
name: Installation and grievances
description: Product rules for delivered-order installation tracking and post-install customer grievance records.
---

**Rule:** Only orders marked delivered by Dispatch enter Installation. In the Dispatch UI, display that dispatch state as “Installed” while preserving the stored `delivered` value used by Installation eligibility. Keep the assigned visit date separate from the actual installation date; a new completion requires an assigned team and a visit date that has arrived in Asia/Kolkata. Team links should carry only the opaque order record ID and load order details behind Installation access. A successful installation advances the order lifecycle to installed; an issue requires a date and reason. Customer grievances can be added only after installation and belong in a dedicated tab on that order. Use Order Hub permissions for grievance access.

**Why:** The user wants the Dispatch status label to read “Installed,” while the existing stored delivery state remains the handoff trigger for Installation tracking. Scheduling and actual completion are distinct events, and assignment links should not expose client or site details in their URL. Customer complaints should remain with their order rather than in a separate grievance module.

**How to apply:** Keep the UI label mapping separate from the `delivered` API/database enum. Preserve eligibility, lifecycle changes, required issue details, grievance gating, order association, and permission scope. Compare visit dates using the Asia/Kolkata calendar day and display link details only from the protected order API.