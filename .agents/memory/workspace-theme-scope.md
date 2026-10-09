---
name: Scoped workspace themes
description: Appearance behavior for the uPVC Order Management workspace.
---

Light is the default appearance. The sidebar, navigation, flyouts, and mobile drawer use the earlier light palette on every route and theme; the top header and main workspace content follow the saved light/dark choice. The dashboard keeps its scoped surface. Desktop navigation groups use adjacent flyouts; mobile keeps the inline expandable list.

**Why:** The user chose to restore the earlier light sidebar palette and asked that it not change with workspace appearance.

**How to apply:** Keep sidebar tokens independent of light/dark content tokens and never override them in `.dark`. Use theme-aware tokens for main surfaces, preserve dashboard-scoped styling, and retain the desktop/mobile navigation split.