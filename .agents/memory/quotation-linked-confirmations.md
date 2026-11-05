---
name: Quotation-linked confirmations
description: Association rules for confirmation documents managed from the Confirmation / PO register.
---

New reusable confirmation records hold versioned PDF and Excel files. Treat the PDF as proof only; extract window data only from Excel. A record may reference a QT quotation and MS sheet, and attaching it to an order attaches the latest available files without requiring another upload. Keep legacy order-level confirmation documents readable and unassigned rather than guessing which record they belong to.

For attached confirmation workbooks, show extracted workbook details in the Windows section. A user with window-edit permission may explicitly add valid extracted schedule rows to the canonical window register after confirming; skip window numbers already present and retain the source document. Never silently turn extracted values into operational records.

**Why:** The owner specified one confirmation record with a proof PDF and working Excel, with later Excel additions and automatic attachment to orders. Existing order documents predate that record model and cannot be reliably grouped by client alone.

**How to apply:** Validate QT and MS references when creating records, retain every upload as a version, and only run workbook extraction on Excel inputs. When linked to an order, expose the latest workbook extraction in Windows but require explicit user confirmation before creating operational window rows. Preserve old order documents without guessing their parent record.