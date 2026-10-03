---
name: Quotation request lifecycle
description: Owner-approved rules for editing, deleting, and reopening quotation rate requests.
---

Status alone must not prevent a request's authorized owner from editing or deleting it. Editing a decided request returns it to the PDF-submission step for a fresh approval cycle, and prior request and decision details remain in revision history. Deleting a request also removes its approval history and associated PDF.

**Why:** The project owner chose edits and deletes in every status, with edits returning decided requests to approval and deletion removing the request and its approval record.

**How to apply:** Preserve existing owner/master-admin authorization boundaries. Mark a retained Eva PDF as stale on edit and keep its bytes until an updated PDF replaces it or the whole request is deleted.