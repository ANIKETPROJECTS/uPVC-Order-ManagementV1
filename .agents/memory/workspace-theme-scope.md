---
name: Scoped workspace themes
description: Appearance behavior for the uPVC Order Management workspace.
---

Use the Operations dashboard as the shared visual reference across the workspace: navy/teal actions, cool light page surfaces, white cards, stronger contrast, and semantic stage colors. Keep the sidebar's earlier light palette independent of content themes, with clearer group labels and a filled teal QR scanner action.

Operational cards and panels must have fully opaque backgrounds in both themes so they remain distinct from the page surface. Transparency is reserved for non-card decoration, overlays, and semantic status treatments.

**Why:** The user asked that cards not blend into page backgrounds and that this rule apply throughout the application, while all screens continue to follow the Operations dashboard visual language.

**How to apply:** Use opaque card tokens for shared and custom card surfaces in light and dark themes; do not use opacity-variant fills on cards. Keep transparent effects for genuinely decorative layers and status badges. Keep sidebar tokens independent of light/dark content tokens and never override them in `.dark`. Use teal for primary actions, gray for early stages, amber for production, blue for dispatched, green/teal for installed, and red only for problems or overdue states.