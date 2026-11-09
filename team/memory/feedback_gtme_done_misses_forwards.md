---
name: feedback_gtme_done_misses_forwards
description: gtme done lists a reply as owed when Togari already forwarded it or the lead already got the deck; read the thread before acting on "owed"
metadata:
  type: feedback
---

On 2026-10-12 `chewbacca gtme done --client Zeutara` showed two owed replies
and neither was what it said. Eric Chin (Crosslink) was filed as a deck ask,
but he already had the deck 3 times and his newest message asked to meet the
founder. Edith Yeung (Race Capital) was an out of office that Togari had
already forwarded to info@race.capital.

**Why:** `gtme done` keys on an old category and doesn't count a Togari
forward as an answer, so a forwarded lead stays "owed" forever.

**How to apply:** read the full thread (newest message first) before
answering anything `gtme done` lists. The fix still owed is in `gtme done`
itself: count a forward from the Togari intake as answered, and classify on
the newest inbound message.

Related: [[feedback_run_ported_classifiers_on_real_inbox]].
