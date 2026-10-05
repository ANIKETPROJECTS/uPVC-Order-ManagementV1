---
name: Quotation request lifecycle
description: Owner-approved rules for editing, deleting, and reopening quotation rate requests.
---

Status alone must not prevent a request's authorized owner from editing or deleting it. Editing a decided request returns it to the PDF-submission step for a fresh approval cycle, and prior request and decision details remain in revision history. Deleting a request also removes its approval history and associated PDF.

**Why:** The project owner chose edits and deletes in every status, with edits returning decided requests to approval and deletion removing the request and its approval record.

**How to apply:** Preserve existing owner/master-admin authorization boundaries. Mark a retained Eva PDF as stale on edit and keep its bytes until an updated PDF replaces it or the whole request is deleted.

In the Quotation approvals queue, list cards should stay compact because the separate View action opens the full request. Keep the summary, status, row controls, decision note, and Approve/Reject actions available inline; leave the grid card detail layout unchanged.

**Why:** The project owner asked for a less expanded list view while retaining inline review actions and a separate full-detail View.

**How to apply:** Scope compact spacing and summary-only metrics to list mode. Do not hide existing View/Edit/Delete/Link/PDF actions or approval controls.