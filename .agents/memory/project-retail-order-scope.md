---
name: Project vs. retail order scope
description: Keep project-specific lot planning separate from retail order flows.
---

Project-specific lot management belongs only to Project orders. Project window upload/import belongs in Lots, and the parent Project order has no standalone Windows section; Retail order detail, creation behavior, and stored UUID piece IDs must remain unchanged unless explicitly requested. Project lot-assigned glass and mesh shutter labels use per-window, per-kind sequences (`GS<n>` and `MS<n>`); accept legacy `G<n>` and `M<n>` project IDs as scan aliases.

**Why:** The user explicitly distinguished Project and Retail orders, required confirmation-file imports to happen in Lots while preserving Retail’s Windows section, confirmed the GS/MS label format, and required old project QR labels to remain scannable without renaming stored data.

**How to apply:** Before extending order screens or APIs, branch by client type and verify that the Retail path does not render or call Project lot-management behavior. Keep shutter numbering within each window and kind; do not add a global counter.
