---
name: Measurement sheet labels
description: Distinguishes optional user-facing labels from original measurement-sheet filenames.
---

Store an optional name as display metadata, separate from the uploaded filename. Keep the original filename available for downloads and show it when an older version has no custom name.

**Why:** The custom name helps identify a sheet in the register, while the original filename preserves the source identity and download behavior.

**How to apply:** Render the custom name as the primary label and the original filename as secondary detail when a custom name exists; use the filename as the label for legacy unnamed versions.