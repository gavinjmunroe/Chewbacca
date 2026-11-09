---
name: feedback_client_channel_posts_one_line
description: Togari's auto-send posts in a client channel are one line (who, company, their first sentence, Togari replied); the full exchange stays in the email thread
metadata:
  type: feedback
---

A status post in a client's Slack channel is one short line, never a header
plus quoted emails.

**Why:** Caleb, 2026-10-12 10:42pm: "the updates on auto sends are wayyyy too
big just give a short summary". Togari's post for each auto-answered reply was
a bold header plus full "They wrote" and "We sent" quotes, 10 to 15 lines per
reply, in the channel Jonah reads.

**How to apply:** togari-platform `sentPost` in src/replies/auto-send.ts builds
"<who> on <company>: "<their first sentence>" Togari replied." with `gist()`
(input cut to 2,000 characters after a 10/12 security review found a
backtracking split). Shipped in d0ce421 and 5710bb4, deployed 10/12 22:45.
Any new client-channel post follows the same one-line shape.

Related: [[feedback_client_channels_are_togari]], [[feedback_client_cards_one_job]].
