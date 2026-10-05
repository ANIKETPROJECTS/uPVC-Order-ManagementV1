---
name: OpenAPI codegen and Vite restarts
description: Vite may request generated client files while clean Orval codegen temporarily removes them.
---

After OpenAPI codegen completes, restart the web workflow before evaluating transient missing-module errors from Vite.

**Why:** Orval cleans generated output directories before writing the new client. A running Vite server can react to that short interval and log failed imports even though codegen succeeds.

**How to apply:** Run codegen, wait for it to finish, restart the affected web workflow once, then check the app again. Do not patch generated files to work around errors that only occurred during generation.
