---
name: Quotation profile snapshots
description: Preserve saved quotation details when reusable window profiles change.
---

Saved quotation lines are snapshots, not live references to the current window-profile catalogue. Changes to a profile should affect new lines, not silently rewrite existing proposal details.

**Why:** A customer-facing proposal must continue to show the profile, specifications, weight, and rate that were used when it was prepared.

**How to apply:** Keep unchanged line snapshots when editing a draft and render saved proposals from their persisted line data. Refresh a line only when that line is deliberately changed.