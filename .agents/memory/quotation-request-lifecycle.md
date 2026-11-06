---
name: Quotation request lifecycle
description: Owner-approved rules for editing, deleting, and reopening quotation rate requests.
---

Status alone must not prevent a request's authorized owner from editing or deleting it. Editing a decided request returns it to the PDF-submission step for a fresh rate-assignment cycle, and prior request and decision details remain in revision history. Deleting a request also removes its history and associated PDF.

**Why:** The project owner chose edits and deletes in every status, with edits returning decided requests to rate assignment and deletion removing the request and its history.

**How to apply:** Preserve existing owner/master-admin authorization boundaries. Mark a retained Eva PDF as stale on edit and keep its bytes until an updated PDF replaces it or the whole request is deleted.

For new rate requests, higher-ups provide a rate; they do not approve or reject the request. Keep existing in-flight approval records accessible during migration, but do not make approval decisions the new request workflow.

**Why:** The project owner clarified that managers give a rate rather than approve anything.

**How to apply:** Managers assign a rate per square foot to new requests. Preserve historical approval data and its separate decision route for pre-migration records.

New requests follow Awaiting rate → Rated → Sent to client. A manager's query returns the request to its owner; query time pauses the waiting timer, and the response resumes it at Awaiting rate. The final quote PDF is uploaded only after rating. Sent quotes track Negotiating, Won, or Lost (with a required reason); a linked confirmation makes the quote Won and that outcome stays sticky.

**Why:** The project owner specified a query-and-response lifecycle, follow-up tracking, and automatic Won status on linked confirmations instead of approval/rejection.

**How to apply:** Keep legacy approval records and routes intact; only migrate the current rate-request workflow. Only the request owner or master admin changes client outcomes, and only the owner/master admin responds to queries.

The shared Quotations & Rates attention panel uses 24h/48h waiting and 5-day no-outcome defaults, with environment overrides. Overdue reminders repeat at a configurable interval and are deduplicated per request and interval; configured user IDs override the default rate-approval/master-admin recipients.

**Why:** The project owner requested visible attention alerts and targeted push notifications without hardcoding a staff member.

**How to apply:** Keep the panel permission-gated and derive waiting age after subtracting all query pauses. Browser push also requires VAPID configuration and an active subscription; retain the in-app notification when push is unavailable.

Rate entry shows up to three recent similar rates: same normalized glass type or average area within a configurable relative tolerance, within a configurable age window. A manager can correct a Rated request using its last-updated timestamp; sent quotes remain read-only so an external Eva PDF is not silently contradicted. The request keeps its QT ID after it becomes a sent quotation.

**Why:** The project owner requested comparable-rate guidance, race-safe corrections, and continuity of the existing QT identifier.

**How to apply:** Keep corrected rates as the current record value so future comparison queries use the latest rate. Treat rate-entry notification targeting and QT-ID continuity as owner-confirmable assumptions.