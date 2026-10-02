---
name: Manual WhatsApp reminders
description: Product constraint for payment follow-up messages sent through WhatsApp.
---

Balance reminders must open a prefilled WhatsApp draft for a staff member to review and send manually. Do not use WhatsApp or Meta APIs or credentials. Record only that a draft was prepared; never claim the message was sent or delivered.

**Why:** The product owner explicitly requires manual sending and no Meta API or WhatsApp credential use.

**How to apply:** Preserve this behavior in future changes to Finance > Payments, reminder links, and related activity entries.