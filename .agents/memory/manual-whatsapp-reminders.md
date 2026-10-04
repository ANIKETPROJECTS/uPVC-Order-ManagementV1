---
name: Manual WhatsApp reminders
description: Product constraint for payment follow-up messages sent through WhatsApp.
---

Balance reminders must open a prefilled WhatsApp draft for a staff member to review and send manually. Do not use WhatsApp or Meta APIs or credentials. Record only that a draft was prepared; never claim the message was sent or delivered. When changing Payments, preserve the WhatsApp button logic and order-window readiness checks.

**Why:** The product owner explicitly requires manual sending and no Meta API or WhatsApp credential use, and has repeatedly set the reminder button/readiness behavior out of scope for Payments changes.

**How to apply:** Preserve this behavior in future changes to Finance > Payments, reminder links, and related activity entries. Do not change readiness conditions unless the product owner explicitly requests it.