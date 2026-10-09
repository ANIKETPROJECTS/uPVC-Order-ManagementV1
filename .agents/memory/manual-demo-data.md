---
name: Manual demo data only
description: Do not reintroduce automatic business-record seeding.
---

**Rule:** Never add startup-time, deployment-time, or recurring demo/business-data seeding. Seed sample records only through a one-time, explicitly requested action.

**Why:** The user wants deleted business data to stay deleted rather than reappearing on restart.

**How to apply:** Keep sample data out of running application code and workflows; do not commit a repeatable seed script unless the user explicitly changes this instruction.
