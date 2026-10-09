---
name: Mongo reset scope
description: Data retention boundaries for explicitly authorized MongoDB resets in the order-management app.
---

**Rule:** During an explicitly authorized MongoDB reset, retain user accounts and role-access records; clear only the non-access data in the authorized database.

**Why:** The owner requested that users and roles survive database resets while the operational records are removed.

**How to apply:** Verify the intended connected database before any destructive operation, then distinguish fresh authentication sessions created after sign-in from business data.
