---
name: Project vs. retail order scope
description: Keep project-specific lot planning separate from retail order flows.
---

Project-specific lot management belongs only to Project orders. Retail order detail and creation behavior must remain unchanged unless the user explicitly asks for a retail change.

**Why:** The user explicitly distinguished Project and Retail orders and repeated that lot planning, assignment, and project summaries must not alter Retail behavior.

**How to apply:** Before extending order screens or APIs, branch by client type and verify that the Retail path does not render or call Project lot-management behavior.
