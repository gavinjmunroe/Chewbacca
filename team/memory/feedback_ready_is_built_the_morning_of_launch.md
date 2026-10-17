---
name: feedback_ready_is_built_the_morning_of_launch
description: gtme ready can only pass on the morning of a launch, on that launch's own drafts; on 2026-10-16 a "clear the 41 blockers" ask graded a launched drafts file whose campaigns were live, and the real Monday blockers were a dated warmup ruling and unverified rows
metadata:
  type: feedback
---

`chewbacca gtme ready` grades one drafts file. Once those campaigns are started it can't print READY again, and it shouldn't. On 2026-10-16 Caleb asked to burn down 41 blockers on monday-2026-10-12/drafts.json. All 14 of its campaigns were active, with step 1 fully sent. Removing catch-all rows from live campaigns would only have cut follow-ups, which goes against the max-volume ruling.

What actually blocks the next launch, read from the same run:

- The recipient read and the pre-send receipt each expire after 12 hours (gtme_grade.py, RECEIPT_TTL_S). So READY has to be built the morning the campaigns start: build, presend, recipient reads, then gtme ready. A Friday-night pass is stale by Monday.
- The start gate wants 21 days of warmup. The `accepted-warmup-risk` ruling in ~/.chewbacca/gtm/clients.json names its campaign ids and an expiry date (10-14 for the 10-12 batch). New campaigns need a new ruling from Caleb, or the launch waits for the youngest inbox to turn 21.
- monday_wave.py drops rows a verifier called bad, but it keeps rows that have no verdict. The 10-19 build had 141 rows and 0 verdicts. The workspace has no standing credit allowance, so verifying them needs Caleb's ok.

**How to apply:** when asked to clear gtme ready blockers, first check whether those drafts' campaigns are already live (`chewbacca clay campaigns list`). If they are, report that the list grades a finished launch, then work the next launch's blockers in the order above.
