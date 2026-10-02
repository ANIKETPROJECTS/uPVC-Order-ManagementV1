---
name: Project-root upload storage
description: App-wide storage choice and compatibility rules for user-uploaded files.
---

Store all newly uploaded document, spreadsheet, PDF, and image bytes in categorized folders under the project-root `uploads/` directory; persist file paths and related metadata in MongoDB.

Keep existing GridFS and data-URL records readable for compatibility. Do not bulk-migrate or delete historical uploads without separate authorization.

**Why:** The project owner explicitly chose project-root-only storage and accepted that published-app files may be lost after a restart or publish.

**How to apply:** Route every new upload flow through categorized local storage, keep its existing authentication and record-level access checks, and retain legacy readers. Do not substitute App Storage or move historic files unless the owner asks.