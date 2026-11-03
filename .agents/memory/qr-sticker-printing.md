---
name: QR sticker printing
description: Print layout and resolution for factory QR stickers.
---

Print factory QR stickers as vector codes arranged on cuttable A4 sheets. Keep each sticker at its saved physical width and height, with visible cut guides; fit as many configured labels as possible without scaling the labels.

**Why:** The user prints selected labels for cutting and reported that one-label-per-page output was blurry and wasteful.

**How to apply:** Use SVG/vector QR output for print and calculate a page grid from the configured label dimensions. Preserve selection, sticker dimensions, and existing print-confirmation behavior.
