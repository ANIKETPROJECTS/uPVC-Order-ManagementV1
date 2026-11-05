---
name: Quotation-linked confirmations
description: Association rules for confirmation documents managed from the Confirmation / PO register.
---

The Confirmation register is confirmation-first: one row per reusable CF record with QT/MS links, linked order, PDF/Excel chips, record-level client decision, and version. Do not show purchase-order fields or order-only rows there. Records hold versioned PDF and Excel files; PDF is proof only, and only Excel is extracted. Attaching a record adds its latest files to an order. Keep legacy order documents accessible without guessing PDF/Excel pairings.

For attached confirmation workbooks, show extracted workbook details in the Windows section. A user with window-edit permission may explicitly add valid extracted schedule rows to the canonical window register after confirming; skip window numbers already present and retain the source document. Never silently turn extracted values into operational records.

**Why:** The owner specified one row per confirmation, not per order. Legacy order documents predate this record model and cannot be reliably grouped into confirmation pairs, while order-level client decisions may be ambiguous when one order has multiple confirmations.

**How to apply:** Read and write the confirmation-record collection for the register. Validate QT/MS references, retain every upload as a version, and store client decisions on the CF record. Show legacy order documents in order details rather than fabricating CF rows or copying one order decision onto multiple records. Keep workbook extraction review-only before adding operational window rows.