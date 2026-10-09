---
name: feedback_catalogued_is_not_read
description: "When Caleb hands over docs, open every link, repo and attachment in them. A URL inventory is not reading."
metadata:
  type: feedback
---

When Caleb gives docs with links, repos or attachments, open and read every one before planning from them.

**Why:** 2026-10-04: the Amber workspace had catalogued 110 URLs and 20 repos as "not independently read" and planned anyway. He said "You didn't even look at the link in all those mega docs I gave you, NOT EVEN THE REPOS!!!!!!!!" The read found seven dead claims (C27 to C33), a malware-lure star, an orphaned doc about to be garbage collected, and two conflicts for the terms call.

**How to apply:** fan out readers by batch (repos via `gh api`, YouTube via `yt-transcript`, pages via fetch, attachments via chat.db), one findings file each with a verdict per item, then mark read status per URL. Say NOT READ with the reason for anything blocked. See a private note.
