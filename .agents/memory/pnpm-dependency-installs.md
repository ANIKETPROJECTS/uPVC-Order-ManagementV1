---
name: pnpm workspace package installs
description: Handling package installation when a dependency belongs to one app in this pnpm monorepo.
---

When adding a dependency to one workspace app, use the filtered pnpm package command so the dependency is recorded in that app's manifest and lockfile.

**Why:** The Replit package-install callback ran `pnpm add` from the workspace root and refused to add app-only dependencies with `ERR_PNPM_ADDING_TO_ROOT`.

**How to apply:** If the package callback cannot select a workspace, run `pnpm --filter <workspace-package> add <package>` rather than adding the dependency to the root.