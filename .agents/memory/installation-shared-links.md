---
name: Installation shared links
description: Security and access rules for no-login installation crew links and QR codes.
---

Installation crews use high-entropy, assignment-scoped bearer links rather than accounts. A link is read-only and exposes only the job fields and current drawing needed on site; it must not expose user identities, member lists, or team contact data. Keep the link stable when only the schedule or assigned members change within the same team/subdivision, rotate it when the team or subdivision changes, and revoke it on unassignment. Public job and drawing responses should not be cached, and access logs must redact the token. Keep this share link separate from the authenticated status-update QR. The in-app camera scanner should recognize Installation status-update QRs and require Installation edit access before opening the status form.

**Why:** Field crews need job details without software accounts, while a former crew must not retain access after the job is reassigned or unassigned. Status changes are authenticated writes and must not be confused with read-only job links.

**How to apply:** Reuse these rules for any unauthenticated field workflow; validate the current assignment at each request and return only the minimum operational data. Route status QR scans to the protected update flow and enforce edit permission there.
