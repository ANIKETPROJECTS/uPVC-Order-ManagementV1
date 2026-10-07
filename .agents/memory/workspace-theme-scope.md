---
name: Scoped workspace themes
description: Appearance behavior for the uPVC Order Management workspace.
---

Light is the default appearance. The sidebar, navigation, flyouts, and mobile drawer use a fixed dark palette on every route and theme; the top header and main workspace content follow the saved light/dark choice. The dashboard keeps its scoped dark surface. Desktop navigation groups use adjacent flyouts; mobile keeps the inline expandable list.

**Why:** The user explicitly asked for navigation to stay dark across every section and theme while the main content and top header respond to the appearance toggle.

**How to apply:** Keep sidebar tokens independent of light/dark content tokens and never override them in `.dark`. Use theme-aware tokens for main surfaces, preserve the dashboard hero treatment, and retain the desktop/mobile navigation split.