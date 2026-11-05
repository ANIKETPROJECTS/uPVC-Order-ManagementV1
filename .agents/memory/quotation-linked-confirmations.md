---
name: Quotation-linked confirmations
description: Association rules for confirmation documents managed from the Confirmation / PO register.
---

The Confirmation register is confirmation-first: one row per reusable CF record with QT/MS links, linked order, PDF/Excel chips, record-level client decision, and shared revision history. Each revision needs one reason; files in a revision share its number, and a file-only revision warns when PDF and Excel latest versions differ. Do not overwrite order files when a CF advances: orders pin a version and must explicitly update or acknowledge keeping the old one. Do not show PO fields or order-only rows. PDF is proof only; only Excel is extracted. Keep legacy order documents accessible without guessing PDF/Excel pairings.

For attached confirmation workbooks, show extracted workbook details in the Windows section. A user with window-edit permission may explicitly add valid extracted schedule rows to the canonical window register after confirming; skip window numbers already present and retain the source document. Never silently turn extracted values into operational records.

**Why:** The owner specified one row per confirmation, not per order, and production must not change when a client sends a revision. Legacy order documents predate this record model and cannot be reliably grouped into confirmation pairs; order-level client decisions may be ambiguous when an order has multiple confirmations.

**How to apply:** Read and write the confirmation-record collection for the register. Validate QT/MS references, require a reason for every revision after v1, retain immutable version history, and store client decisions on the CF record. Explicit order updates may replace attached confirmation files only; never alter order production data. Show legacy order documents in order details rather than fabricating CF rows or copying one order decision onto multiple records. Keep workbook extraction review-only before adding operational window rows.