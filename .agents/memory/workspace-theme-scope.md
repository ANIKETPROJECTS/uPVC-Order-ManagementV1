---
name: Scoped workspace themes
description: Appearance behavior for the uPVC Order Management workspace.
---

Use the Operations dashboard as the shared visual reference across the workspace: navy/teal actions, cool light page surfaces, white cards, stronger contrast, and semantic stage colors. Keep the sidebar's earlier light palette independent of content themes, with clearer group labels and a filled teal QR scanner action.

**Why:** The user asked that all screens follow the Operations dashboard visual language while specifically preserving the earlier light sidebar palette.

**How to apply:** Keep sidebar tokens independent of light/dark content tokens and never override them in `.dark`. Use teal for primary actions, gray for early stages, amber for production, blue for dispatched, green/teal for installed, and red only for problems or overdue states.