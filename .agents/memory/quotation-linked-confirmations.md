---
name: Quotation-linked confirmations
description: Association rules for confirmation documents managed from the Confirmation / PO register.
---

Confirmation files uploaded from the register should be attached to the specific quotation request linked to the order. Keep older order-level confirmation documents unassigned rather than guessing which request they belong to. Replacements retain their request association.

**Why:** The owner asked to view linked quotation request documents and upload the corresponding confirmation. An order can contain multiple requests, so order-only association is ambiguous.

**How to apply:** Validate the request-to-order relationship on the server during upload, keep the request ID in document metadata, display unassigned legacy files separately, and preserve the ID through replace/delete flows.