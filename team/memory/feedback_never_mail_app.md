---
name: feedback-never-mail-app
description: Don't build on Mail.app for email; use the Gmail API (gws) per inbox
metadata:
  type: feedback
---

Caleb, 2026-10-08: "We shouldn't be using the mail app that thing sucks". The first email reader read Mail.app's Envelope Index. Its newest message was from 9/22, and his work inbox wasn't in it at all.

**Why:** Mail.app only has the accounts someone added to it, syncs when it feels like it, and needs Full Disk Access. The Gmail API is per account, current, and is the same path for any user.

**How to apply:** email goes through `mac/lib/gmail.py` and `chewbacca email add`. Leave `mac messages`-style Mail.app automation for the rare case with no API. See a private note.
