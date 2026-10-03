---
name: Orval parameter collisions
description: Generated parameter-type naming collision encountered when adding query parameters to an existing operation.
---

Adding query parameters to an existing operation that already has generated path-parameter schemas can make Orval emit duplicate `*Params` exports from `generated/api.ts` and `generated/types`. For inline file preview, keep the download operation path-only and use a separate preview operation with its own operation ID instead of a query flag.

**Why:** The `api-zod` barrel re-exports both generated modules, so overlapping operation parameter names fail the workspace library typecheck.

**How to apply:** After OpenAPI edits, rerun codegen. If TypeScript reports duplicate `*Params` exports, inspect the generated names and split preview behavior into a distinct operation rather than renaming generated files or hand-editing generated code.