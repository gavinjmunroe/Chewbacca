---
name: feedback_text_channels_include_imessage
description: Any "text a number" flow or demo for churches (Anchored, Firm Foundation) offers iMessage next to WhatsApp and SMS, in the channel choices and in the demo preview; Photon and Linq are the providers he named
metadata:
  type: feedback
---

A text-a-number flow for churches lists iMessage as a channel next to WhatsApp and SMS, both in the question that asks how to reach someone and in any demo that previews the thread.

Caleb, 2026-11-03, mid-build on the Baptize The World sign-up demo (anchored /demo/btw), which had shipped with WhatsApp, text message and email only: "iMessage too! Photon/linq/wtv else is tuff". The fix landed in anchored 7f1388d: an iMessage choice in lib/intake-btw.ts and a WhatsApp / SMS / iMessage switch on the demo phone.

How to apply:
- Default channel set for any church texting build: WhatsApp, SMS, iMessage (plus email where the org already uses it). WhatsApp-only reads as a Global South demo and misses US churches.
- Real iMessage sending goes through a provider. Photon and Linq are the two he named; neither is set up as of 2026-11-03, so say it's a preview until one is.
