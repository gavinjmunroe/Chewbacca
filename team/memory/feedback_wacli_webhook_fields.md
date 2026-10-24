---
name: feedback_wacli_webhook_fields
description: wacli 0.20 webhook JSON uses capitalized SenderJID, Chat, Text, FromMe; lowercase pickers drop every message
metadata:
  type: feedback
---

`wacli sync --follow --webhook <url>` (wacli 0.20) posts each message as JSON with capitalized fields: `SenderJID`, `Chat`, `Text`, `FromMe`, `PushName`, `Timestamp`. A bridge that reads `from`, `text` or `from_me` gets empty strings and silently drops everything, so no reply ever goes out and nothing errors.

**Why:** On 2026-10-24 the Anchored hackathon bridge (calebnewtonusc/anchored, bridge/wa-bridge.mjs) dropped Ogo's ANCHORED text for this reason. One logged payload showed the real names, and after the fix in a786a9e the welcome came back on WhatsApp.

**How to apply:** Any code that reads wacli webhooks reads the capitalized names first. To find out the shape, log one payload filtered to a single number (`grep --line-buffered <digits>`), never the whole stream, since it prints every chat on the phone. `wacli send text` works fine while a `sync --follow` is running. Also, the Anchored Railway service is not linked to GitHub, so a push doesn't deploy it: run `railway up --detach` from a clean worktree of origin/main.
