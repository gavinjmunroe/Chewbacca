---
name: feedback_gmail_draft_rewraps_links
description: A Gmail draft reply can store a link as a google.com/url redirect; check the link text before sending
metadata:
  type: feedback
---
A reply draft in Caleb's USC Gmail stored https://anchored.up.railway.app as https://www.google.com/url?q=...&ust=... even after the body was rewritten with the plain URL through the Gmail connector's update_draft (seen 2026-10-29 on the Meridian reply, twice).

**Why:** the recipient sees a Google redirect instead of the company site, which reads as spam on a pitch email.

**How to apply:** before sending any draft with a link, read it back with list_drafts DRAFT_VIEW_FULL and check the URL in plaintextBody. If it's wrapped, set both body and htmlBody with an explicit <a href> to the plain URL, read back again, then send.
