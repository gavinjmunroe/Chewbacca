---
name: feedback_client_rulings_first
description: Every client repo keeps DECISIONS.json of standing rulings; a recommendation that contradicts one names it, and naming the client loads them
metadata:
  type: feedback
---

On 2026-10-09 a week-1 Zeutara update told Jonah we'd "narrow every list".
Maggie had ruled 10/5 that Jonah wants volume, and Sagar 10/4 to send strongest
fits first and fill with the rest. Caleb: "Never be retarded ever again
especially when it comes to clients."

**Why:** the rulings lived in texts and a long memory note that no session read
before advising, so a reasonable-sounding strategy overrode the client's own call.

**How to apply:** each client repo under ~/code/work has `DECISIONS.json` (who,
when, source per ruling). `client-rulings.sh` injects the active ones whenever a
prompt names the client or an alias. Add new rulings the turn they arrive. A plan
that contradicts one says which ruling and who owns changing it. See
[[feedback_client_review_is_the_gate]], [[feedback_do_it_how_maggie_and_sagar_would]].
