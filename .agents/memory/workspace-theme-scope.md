---
name: Scoped workspace themes
description: Appearance behavior for the uPVC Order Management workspace.
---

Light is the default appearance. The sidebar and navigation keep the earlier light palette on every route and theme; the top header and main workspace content follow the saved light/dark choice. The dashboard keeps its scoped surface.

**Why:** The user chose to restore the earlier light sidebar palette and asked that it not change with workspace appearance.

**How to apply:** Keep sidebar tokens independent of light/dark content tokens and never override them in `.dark`. Use theme-aware tokens for main surfaces and preserve dashboard-scoped styling.