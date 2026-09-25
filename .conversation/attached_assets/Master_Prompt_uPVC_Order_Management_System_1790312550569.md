# MASTER PROMPT — uPVC Order Management, Quotation & Production Tracking System

## HOW TO USE THIS DOCUMENT
This is a master specification for building a custom internal software system for a uPVC windows & doors manufacturing/sales business. The system will be built **module by module, one at a time** — do not build everything at once. Each module section below is self-contained enough to be built, tested, and confirmed before moving to the next. Build **Module 1 (Multi-User Architecture & RBAC) first**, always, regardless of prompt order after this. Once a module is confirmed working, move to the next module in the order listed.

Even before later modules are built, **the sidebar/navigation must always show all modules from this document** (as locked/"coming soon" or empty-state placeholders) so the full scope of the application is visible from day one. As each module is completed, its sidebar entry becomes fully functional.

---

## 1. WHAT THIS SOFTWARE IS

This is an **Order Management, Quotation & Production Tracking System** for a uPVC window/door manufacturing company. The business flow is:

1. A client's site is measured, and a **Quotation** is prepared and sent to the prospective client.
2. If the client confirms the quotation, a **Confirmation / Purchase Order document** is generated and shared with the client.
3. The confirmed order then proceeds through internal stages: rate approval, measurement finalization, production (assembly with QR-based tracking), glass procurement, window-wise readiness, payment collection, dispatch, and installation.
4. At every stage, staff need visibility of order status, tracking of documents, and the ability to quickly notify the client of their order's current stage via a copyable message template.

The long-term goal is to **digitize the Quotation and Confirmation documents themselves** — i.e., instead of manually preparing these in Excel/Word and converting to PDF, the system should let staff generate these documents directly, in the same layout/structure/branding style as the company currently uses, but as editable digital records that can be created quickly, edited, and shared (e.g., as a PDF/link) with clients. New quotations/confirmations should be creatable in minutes using stored client, item, and rate data — not built from scratch each time.

Two reference documents are provided purely as design/structure references (do not need to be summarized back — they are attached alongside this prompt):
- A sample **Quotation Report** (multi-page, window-by-window breakdown with profile/glass/accessory specs, computed sq.ft & pricing, and a grand total summary) — this is the format the digital Quotation module should be able to reproduce and generate.
- A sample **Purchase Order / Confirmation Letter** (single-page order confirmation with window schedule table, payment terms, T&Cs, and sign-off) — this is the format the digital Confirmation module should be able to reproduce and generate.

The two primary functional specification documents (also attached) — a Software Structure & Module Proposal, and a detailed System Requirements Specification (SRS) — define the actual modules and business logic this system must implement. Build strictly according to the modules, workflows, field names, statuses, and logic described in those two documents. Treat the SRS as the authoritative source for field names, statuses, and data relationships wherever it's more specific than the module proposal.

---

## 2. GLOBAL TECHNICAL & DESIGN RULES (apply to every module)

- **Database: MongoDB only.** Use a MongoDB connection string that will be supplied via an environment variable (`MONGODB_URI`). Do **not** use PostgreSQL, SQLite, or any relational database anywhere in this project, even for parts that might seem more "relational" in nature (like order↔frame relationships) — model these using MongoDB documents/collections/references instead.
- **Theme:** The entire application must use a **light theme** only (light backgrounds, dark text, clean corporate SaaS look). No dark mode toggle needed. Should look modern, clean, and professional — this is an internal business tool used by office staff, factory floor staff, and management, so clarity and readability matter more than flashy design.
- **Sidebar navigation:** Persistent sidebar listing all modules of the system (see Module Index below). Modules not yet built should still appear (grayed out or marked "Coming Soon") so the navigation structure is complete from the start.
- **Seed / dummy data:** For every module as it is built, seed realistic dummy/sample data (sample clients, sample orders, sample users, sample windows, sample glass records, etc.) so the module can be immediately viewed and clicked through without needing to manually create data first. Use realistic Indian names, phone numbers, uPVC industry terminology (matching the terms in the reference documents — e.g. window types like "3 TRACK 2 GLASS 1 MESH", "OPANABLE AND EXZ", glass types like "5MM CLEAR GLASS", "4MM FROSTED GLASS", locations like "Nashik", "Pune", "Mumbai").
- **Order ID scheme:** Implement the standardized Order ID format defined in the SRS: `[CLIENT_PREFIX][SEQUENCE_NO] [LOCATION_CODE]` — e.g. `R253 PN` (Rayal, order #253, Pune). Client prefixes and location codes should be manageable (a lookup table), not hardcoded, since new clients/locations will be added over time.
- **Frame/Shutter QR code IDs:** Follow the SRS convention, e.g. `R253-PN-W01-F` (Order ID + Window number + Frame/Sash indicator).
- **Notifications:** Wherever the source documents mention a notification to "Uday Sir" (or any role) for rate approval, model this as an in-app notification/alert to whichever user(s) hold that specific role/permission — do not hardcode a person's name into logic, just make the recipient configurable (e.g., a "Rate Approver" role).
- **Message templates (cross-cutting feature — required in every stage-driven module):** At every stage of an order's lifecycle (quotation sent, confirmation done, measurement finalized, rate approved, production started, glass pending, window ready, balance payment due, ready for dispatch, dispatched, installation scheduled, installation complete, etc.) there must be a small UI action that:
  1. Auto-fills a pre-written message template appropriate to that exact stage (e.g., "Dear [Client Name], your order [Order ID] has been confirmed and is now under production..."),
  2. Auto-inserts the client's name and Order ID (and other relevant dynamic fields like balance amount, dates) from the order record,
  3. Lets the staff member preview/edit the message,
  4. Provides a **Copy to Clipboard** button (and, where relevant per the SRS's WhatsApp integration mention, a "Send via WhatsApp" style action) so the message can be quickly sent to the client.
  Message templates per stage should be stored/editable centrally (an admin-configurable template list) rather than hardcoded strings scattered everywhere, so wording can be tweaked later without a developer.
- **Documents & files:** All documents (quotations, confirmation PDFs, measurement sheets, glass PI uploads, cutting lists) must be attached to and retrievable from the central Order ID hub, with clear document type tagging and upload timestamps.
- **Roles-first mindset:** Every module built after Module 1 must respect the role/permission system from Module 1 — i.e., every module needs to check what sections/actions a logged-in user is allowed to see or do, and every module needs to be able to be toggled on/off per role/user from the admin's permission settings.
- **Responsiveness:** The app should be usable on both desktop (office staff) and tablet/mobile (factory floor QR scanning, installation team) — keep this in mind especially for QR scanning screens and dispatch screens.

---

## 3. MODULE INDEX (build in this exact order)

1. **Multi-User Architecture & Role-Based Access Control** ← build this first, always
2. **Client & Order ID Management (Central Hub)**
3. **Digital Quotation Builder & Document Repository**
4. **Rate Approval Workflow**
5. **Digital Confirmation / Purchase Order Generator**
6. **Measurement Database (Version Control)**
7. **QR Code Generation & Assembly Tracking**
8. **Window-wise Readiness Tracking**
9. **Glass Procurement & Delivery Tracking**
10. **Order Value & Payment Tracking**
11. **Balance Payment Automated Message Generator**
12. **Dispatch QR Scan & WhatsApp Payment Alert Gate**
13. **Installation Scheduling**
14. **Central Dashboard & Reporting** (final polish module, ties everything together)

Each module is detailed below. Do not skip ahead — confirm each module works with seeded dummy data before starting the next.

---

## MODULE 1 — Multi-User Architecture & Role-Based Access Control (BUILD FIRST)

This is the foundation of the entire application and must be completed before any other module.

### Roles
- **Master Admin** — full, unrestricted access to everything, including user management and permission configuration. There should always be at least one Master Admin (seed one by default).
- **Role-specific users** — the system must support custom roles (not just a fixed hardcoded list), e.g. Operator, Manager, Production Engineer, Accounts, Quotation Team, Rate Approver, Installation Coordinator, Dispatch/Gate Staff, etc. Seed a handful of these example roles with dummy users so the concept is demonstrated, but the Master Admin must be able to create additional custom roles later, not just pick from a fixed list.

### User Management (Master Admin only)
Master Admin must be able to:
- **Add** a new user: set name, contact info, login credentials (username/email + password — set directly by the admin, not via self-signup or email invite), assign a role, and assign section/module-level access permissions.
- **Edit** an existing user: change any of the above, including resetting their password.
- **Delete / Deactivate** a user.
- **Assign granular permissions per user**: for each module/section in the sidebar (see Module Index above), the admin should be able to toggle View / Edit / No-Access (at minimum View vs No-Access; Edit-level granularity is a bonus if feasible) for that specific user or for a role template that gets applied to multiple users.
- View a list/table of all users with their role, status (active/inactive), and last login.

### Authentication
- Simple username/password login (credentials set by Master Admin as above — no public registration).
- Session-based or token-based login persistence.
- Each user, once logged in, should only see sidebar modules/sections they've been granted access to.

### Role-specific dashboards
- Each user role should land on a **dashboard tailored to their role** after login, not the same generic dashboard for everyone. For example:
  - Master Admin dashboard: overview of all orders, all users, system-wide stats.
  - Quotation team dashboard: their pending quotations, rate-approval status of their submissions.
  - Rate Approver (e.g. "Uday Sir" role) dashboard: a queue of quotations awaiting their rate approval, sorted with unpriced/urgent ones on top.
  - Production/Operator dashboard: orders in production, window-wise readiness for their assigned orders.
  - Accounts dashboard: payment status across orders, balance dues.
  - Installation Coordinator dashboard: upcoming/scheduled installations.
- Since most of these modules don't exist yet, build the dashboard framework generically now (a dashboard "shell" per role with placeholder widgets), and it will get populated with real data as each subsequent module is completed.

### Seed data for this module
Seed a Master Admin account plus 4–5 sample users across different roles (Operator, Manager, Rate Approver, Accounts, Quotation Team) with realistic names, so role switching/permission behavior can be demonstrated immediately. Clearly document/display the seeded login credentials somewhere accessible in dev (e.g., a visible note on the login screen in this dev/demo phase) so they can be tested easily.

---

## MODULE 2 — Client & Order ID Management (Central Hub)

Implements the "Order ID as central hub" concept from the Software Structure document and the Order ID/location coding scheme from the SRS.

- Client master list: add/edit clients with name, contact number, address, GSTIN (optional), and an assigned Client Prefix (e.g., "R" for Rayal, "C" for Chavan Bhau) — prefix lookup table should be admin-manageable, supporting new clients being added with new prefixes.
- Location code lookup table (e.g., PN = Pune, MUM = Mumbai, WAD = Wadala, NSK = Nashik) — also admin-manageable.
- **Order creation**: generates a canonical Order ID automatically as `[Client_Prefix][Sequence_No] [Location_Code]` (e.g., `R253 PN`).
- The **Order ID record is the central hub**: a single order detail page that will, as later modules are built, aggregate and link: quotation document(s), confirmation document, measurement sheet(s) (with version history), rate approval status, window-wise readiness, glass tracking, payment ledger, QR/assembly status, dispatch status, and installation schedule. Build this order detail page now as a tabbed/sectioned view with placeholders for the sections that don't exist yet, so later modules simply populate more tabs on the same page.
- Order list/table view with filters (by status, by client, by location, by date).
- Order status field (high-level lifecycle status, e.g., Quotation Stage → Confirmed → In Production → Ready → Dispatched → Installed) — this status should be visible prominently and drive which message template is suggested (see Global Rules).

### Seed data
Seed 6–8 sample orders across different clients, prefixes, locations, and lifecycle statuses, using naming/terminology consistent with the reference documents (e.g., a "AAKAR SOLITAIRE" style client, window types like "3 TRACK 2 GLASS 1 MESH", "OPANABLE AND EXZ").

---

## MODULE 3 — Digital Quotation Builder & Document Repository

- **Document Repository**: a section under each Order ID (and a global searchable document list) to upload and tag files as Quotation / Confirmation / Measurement Sheet / Final Cutting List / Glass PI, each with upload date and uploader. This satisfies the "Document Repository" and "multi-file upload module" requirement from the SRS.
- **Digital Quotation Builder**: rather than only uploading a PDF quotation prepared externally, allow staff to build a quotation directly in the system:
  - Add multiple window/door line items, each with: location (room), width, height, computed sq.ft, quantity, window/door type (dropdown, editable list — e.g. "3 TRACK 2 GLASS 1 MESH", "OPANABLE AND EXZ"), profile system, glass type, lock type, mesh type, rate per sq.ft, and computed value.
  - Auto-calculate sq.ft per item ((W × H)/92903 or the business's standard formula — allow this to be configurable), line value, and a running grand total (sub-total, additional charges like transport/loading/glass surcharges, GST %, grand total) — mirroring the structure of the sample Quotation Report (per-item breakdown + summary total block).
  - Ability to generate a shareable, print-ready version of the quotation (styled similarly to the sample Quotation Report layout: company header, client details block, item-by-item cards/table, closing summary table) that can be downloaded or shared as a link/PDF.
  - Quotations should be editable/revisable, and linked to an Order ID once one exists (or created standalone before an Order ID is assigned, then linked later — matching the Measurement Module's "linked after quote or by production engineer's decision" logic described for measurements, applied analogously here where relevant).
  - Quote status field: Draft / Sent to Client / Awaiting Rate Approval / Rate Approved / Revised / Client Confirmed / Client Rejected.

### Seed data
Seed 3–4 sample quotations in different statuses, including at least one multi-window quotation resembling the structure of the sample Quotation Report (several rooms/window types, computed totals).

---

## MODULE 4 — Rate Approval Workflow

Implements MOD 05 (Rate Approval Section) from the Software Structure doc and Note 7 / FR-DOC-02 from the SRS.

- When a quotation is submitted with pricing fields (Window Qty, SqFt, Glass Type, Client Name, Location) but rate not yet finalized, automatically flag it **"HIGH PRIORITY – RATE AWAITED"**.
- These unpriced quotes must float to the top of a dedicated **Rate Approval queue/dashboard**, visible to whichever user(s) hold the Rate Approver role/permission.
- Automatic in-app notification/alert sent to the Rate Approver role when a new quote needs approval.
- Once the Rate Approver enters/approves the rate, automatically notify the Quotation Team member who submitted it, so they can revise/finalize the quote accordingly.
- Maintain a visible approval history/log per quotation (who approved, what rate, when).

### Seed data
Seed a mix of quotations: some pending rate approval (showing the priority flag), some already approved, to demonstrate the queue sorting behavior.

---

## MODULE 5 — Digital Confirmation / Purchase Order Generator

Once a client confirms a quotation, generate the Confirmation/Purchase Order document — matching the structure/format of the sample Confirmation Letter reference document.

- Should be generatable directly from an approved/confirmed Quotation (pulling over client details, window items, and pricing) rather than built from scratch — minimizing re-entry of data.
- Include all fields present in the sample Confirmation document structure: Order No., Date, Final Measurement Date, Installation Date/timeline, Client Name/Contact/Address/GSTIN, Reference person, "Confirmation made by", "Decision given by", "Checked by", the window schedule table (SR No, Location, Width, Height, Total Sq Ft, Qty, Window Type, Glass, Lock Type, Profile, Mesh) with totals row, Payment details block (Sq Ft rate, Basic, GST breakup, Final Billing Amount, Bank details), Terms & Conditions block (should be an editable, reusable T&C template, not re-typed each time), and a sign-off block (Made By / Checked By / Approved By with roles).
- Should be downloadable/shareable (print-ready / PDF-style) and editable before finalizing.
- Once generated, this document should auto-attach to the Order ID's document repository and flip the order's lifecycle status to "Confirmed."

### Seed data
Seed 1–2 sample confirmations resembling the reference document's structure and totals.

---

## MODULE 6 — Measurement Database (Version Control)

Implements MOD 04 from the Software Structure doc.

- Measurement takers can upload a measurement sheet (initially just containing measurements + client name, before any Order ID may exist yet).
- Each measurement upload must specify its **type**: "Quotation Measurement" or "Final Measurement."
- After a quote is provided, or by the Production Engineer's decision, the measurement sheet becomes **linked to an Order ID**.
- If a measurement is later revised, store it as a **new version** linked to the same Order ID — the Order ID hub should always show the latest version by default, while older versions remain safely stored and viewable in a version history list (do not overwrite/delete old versions).

### Seed data
Seed at least one order with 2 measurement versions (e.g., an initial "Quotation Measurement" and a later "Final Measurement") to demonstrate version history.

---

## MODULE 7 — QR Code Generation & Assembly Tracking

Implements MOD 02 from the Software Structure doc and Module 3 (FR-SFP-03) / Notes 1 & 3 from the SRS.

- Once a cutting list is approved/attached for an order, generate a **unique printable QR code per frame/shutter/sash**, following the ID convention `[OrderID]-W[##]-F` (e.g., `R253-PN-W01-F`).
- Provide a printable QR sticker sheet/view per order (for physical printing and pasting on frames).
- Build a **scan interface** (usable via a phone camera or handheld barcode scanner on a tablet/mobile browser) where scanning a frame's QR code at the assembly/glazing stage instantly marks that specific frame/shutter as **"FABRICATION_COMPLETED"** with a timestamp and the operator/user who scanned it.
- The Order ID hub and Window-wise Readiness module (Module 8) should reflect this status update in real time.

### Seed data
Seed one order with a full set of frame/shutter QR records, some already marked "ready" (scanned) and some still pending, to demonstrate partial completion.

---

## MODULE 8 — Window-wise Readiness Tracking

Implements MOD 06 from the Software Structure doc.

- Track readiness on a **per-window basis** for every order, showing an "X out of Y windows ready" summary at the order level.
- For any window that is NOT ready, require/allow selecting an explicit **pending reason**: Glass Pending, Profile Not in Stock, Hardware Not Available, Customer Decision Change (and allow this reason list to be extended by admin later).
- This module should visually flag/mark windows affected by glass issues (fed from Module 9's glass tracking) automatically where applicable.
- Once all windows/frames in an order are marked ready, this should trigger the Balance Payment Message flow (Module 11).

### Seed data
Seed 1–2 orders showing partial readiness (e.g., "18/20 windows ready") with a mix of pending reasons assigned to the not-ready windows.

---

## MODULE 9 — Glass Procurement & Delivery Tracking

Implements MOD 03 from the Software Structure doc and Module 4 (FR-GLS-04) / Note 6 from the SRS.

- Independent Glass Tracker tab per order (glass dates are business-known to be uncertain/variable, so this must be tracked separately from general production status).
- Track milestone fields per glass line item: `GLASS_ORDERED` (date requisition sent), `EXPECTED_DELIVERY` (vendor estimate), `GLASS_RECEIVED` (actual arrival), `GLASS_FITTED` (installed into frame).
- Allow uploading the glass order's **PI (Proforma Invoice)** document, and logging **quantity received vs. quantity broken**.
- Any shutter/window associated with broken or still-pending glass should be **visually flagged** in the software and that window's status set to "pending – glass breakage" (feeding into Module 8's window-wise readiness pending reasons).
- Dashboard-level visual delay warning if the current date exceeds `EXPECTED_DELIVERY` without a `GLASS_RECEIVED` date logged yet.

### Seed data
Seed a few glass tracker records across different orders — at least one overdue (triggering the delay warning), one with reported broken glass, and one fully received/fitted.

---

## MODULE 10 — Order Value & Payment Tracking

Implements MOD 07 from the Software Structure doc.

- Log the final decided/confirmed value of each order securely at the Order ID level.
- Dedicated section to record payments received against that order over time (payment date, amount, mode, recorded by) — running ledger showing total paid vs. balance due.
- Should reflect the payment terms logic seen in the reference Confirmation document (e.g., 100% advance for small orders, 50/50 for larger ones) as configurable business rules/reference info, not hardcoded per order.

### Seed data
Seed a few orders with varied payment states: fully paid, partially paid (with balance remaining), and unpaid.

---

## MODULE 11 — Balance Payment Automated Message Generator

Implements MOD 08 from the Software Structure doc, tied into the Global Message Template system described in Section 2, and Note 8 / Module 5 (FR-DSP-05) of the SRS regarding automated payment alerts.

- Once **all** frames/shutters in an order are marked ready (from Module 8), automatically prompt/alert the relevant staff member that a balance payment message should be sent.
- Auto-generate the pre-formatted balance payment message (client name, Order ID, outstanding balance amount pulled from Module 10) using the message-template system, ready to copy or send.
- Also apply the same auto-alert + WhatsApp-style message logic at the **dispatch QR scan** step per the SRS (Module 12 below) if a balance is still outstanding at that point — including the escalation language from the SRS ("Outstanding balance... Please process payment to complete dispatch clearance...").

### Seed data
Seed at least one order that has just become fully "ready," demonstrating the auto-generated balance payment prompt/message.

---

## MODULE 12 — Dispatch QR Scan & WhatsApp Payment Alert Gate

Implements Module 5 (FR-DSP-05) from the SRS.

- Loading dock / dispatch scan interface: scan each frame's QR code prior to loading, and verify scanned frames against the order's manifest (all expected frames present).
- On scanning, evaluate the order's financial balance (from Module 10). If a balance is outstanding, automatically trigger the balance payment alert message (Module 11) to the client.
- **Gate Pass hard lock**: prevent/gray-out "Print Gate Pass" until Accounts explicitly confirms payment clearance for that order — this must be enforced in the UI (not just a warning).
- Maintain a dispatch log per order: vehicle number, driver phone, whether the WhatsApp-style alert was sent, whether payment was cleared, whether gate pass was issued.

### Seed data
Seed one order at the dispatch stage with an outstanding balance (showing the gate pass lock in effect) and one with cleared payment (showing gate pass allowed).

---

## MODULE 13 — Installation Scheduling

Implements MOD 09 from the Software Structure doc.

- Maintain a list of installation team members with their contact info (add/edit/delete, admin-manageable).
- Once an order's installation is approved/decided, allow selecting an installation team member from a dropdown to schedule the installation (with a date).
- On scheduling, automatically notify (in-app, and via the message-template/WhatsApp-style mechanism) the selected installation member with the Order Details and Client Location.
- Show an installation calendar/list view (upcoming installations, completed installations) — this should feed the Installation Coordinator's role-specific dashboard from Module 1.

### Seed data
Seed 2–3 installation team members and a couple of scheduled installations (one upcoming, one completed) tied to seeded orders.

---

## MODULE 14 — Central Dashboard & Reporting (final module)

Once all modules above are built, finalize:
- The Master Admin's global dashboard: total orders by stage, orders pending rate approval, orders with outstanding balances, orders with glass delays, overall revenue/collections snapshot.
- Each role-specific dashboard (stubbed in Module 1) should now be fully wired to real data from the relevant modules.
- General search across Order IDs / client names from anywhere in the app.
- Basic exportable reports (e.g., orders list, payment ledger, glass delay report) — export as CSV/PDF.

---

## FINAL NOTES FOR THE BUILDER

- Build and confirm **Module 1 completely** before touching Module 2, and so on — do not attempt to build multiple modules in parallel, and do not skip the seeding step for any module.
- Every module's data model should anticipate being linked back to the central Order ID hub (Module 2) even if that specific link isn't wired up until a later module — keep an `order_id` reference field on every relevant collection from the start (measurements, quotations, confirmations, glass records, frame/QR records, payments, dispatch logs, installation schedules) so nothing needs to be restructured later.
- Respect role/permission checks (Module 1) in every module going forward.
- Keep the message-template system (Section 2) centralized and reusable rather than duplicating message-composition logic per module.
- Use MongoDB exclusively for all persistence — connection string will be provided via `MONGODB_URI` environment variable.
- Keep the UI light-themed, clean, and consistent across all modules.
