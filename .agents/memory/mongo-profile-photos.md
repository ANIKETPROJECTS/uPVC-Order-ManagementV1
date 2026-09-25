---
name: MongoDB profile photo storage
description: Persist profile photo uploads without changing the project's MongoDB-only storage constraint.
---

Keep uploaded profile photos as small, browser-cropped JPEG data URLs on MongoDB user records; profile photo links remain HTTP(S) URLs. Do not add App Storage or a relational database for these images unless the project owner explicitly changes the MongoDB-only requirement.

**Why:** The app is intentionally MongoDB-only and uses username/password authentication. The available App Storage setup couples uploads to Replit Auth and PostgreSQL, which conflicts with that requirement.

**How to apply:** Crop and downscale uploads in the browser, keep payload limits small, validate uploaded data and link schemes in the API, and read/write the image through the existing Mongo user document.
