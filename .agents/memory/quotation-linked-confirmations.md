---
name: Quotation-linked confirmations
description: Association rules for confirmation documents managed from the Confirmation / PO register.
---

Confirmation files uploaded from the register should be attached to the specific quotation request linked to the order. Keep older order-level confirmation documents unassigned rather than guessing which request they belong to. Replacements retain their request association. Order confirmation files can also carry extracted fields and full extracted text; keep that result attached to its source document and display the newest order-confirmation extraction without writing OCR values into operational order/window records.

**Why:** The owner asked to view linked quotation request documents and upload the corresponding confirmation. An order can contain multiple requests, so order-only association is ambiguous. OCR is fallible and multiple confirmations may exist, so extracted values need a traceable source and must not silently become operational data.

**How to apply:** Validate the request-to-order relationship on the server during upload, keep the request ID in document metadata, display unassigned legacy files separately, and preserve the ID through replace/delete flows. Keep extraction per file, preserve the raw text, and leave the original confirmation document authoritative.