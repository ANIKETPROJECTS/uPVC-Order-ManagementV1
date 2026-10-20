---
name: Project vs. retail order scope
description: Keep project-specific lot planning separate from retail order flows.
---

Project-specific lot management belongs only to Project orders. Retail order detail, creation behavior, and stored UUID piece IDs must remain unchanged unless explicitly requested. Project lot-assigned glass and mesh shutter labels use per-window, per-kind sequences (`GS<n>` and `MS<n>`); accept legacy `G<n>` and `M<n>` project IDs as scan aliases.

**Why:** The user explicitly distinguished Project and Retail orders, confirmed the GS/MS label format, and required old project QR labels to remain scannable without renaming stored data.

**How to apply:** Before extending order screens or APIs, branch by client type and verify that the Retail path does not render or call Project lot-management behavior. Keep shutter numbering within each window and kind; do not add a global counter.
