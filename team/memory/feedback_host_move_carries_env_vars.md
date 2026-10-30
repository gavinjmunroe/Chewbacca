---
name: feedback_host_move_carries_env_vars
description: Moving a site between hosts drops its env vars unless someone copies them; after any move, list the new host's variables and submit every form once
metadata:
  type: feedback
---

The FF site moved from Vercel to Railway on 2026-10-29. On the founders call that night Gavin asked about the free audit form, "Does this work?", and Caleb said "I'll have to double-check that. I haven't tried it." Railway had no BOOKING*WEBHOOK_URL or BOOKING_WEBHOOK_SECRET (only RAILWAY*\* vars), and the sheet behind them had never been set up. So /api/book answered 503 and every request opened the sender's own mail app. Nobody noticed for the whole move.

**Why:** a host move copies code, not config. A form with a mail-app fallback fails quietly: no error, just leads that never land.

**How to apply:** after moving any site, list the new host's variable names (railway variables --kv, values stripped) and compare them against every process.env read in the code. Then send one real test through each form before telling anyone the move is done.
