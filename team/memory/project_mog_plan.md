---
name: project_mog_plan
description: The plan to prove Chewbacca learns, with the 10/10 baseline numbers; "are we mogging" gets answered from this scoreboard, not from vibes
metadata:
  type: project
---

The mog plan is work-ledger task cc438a52 (source key `mog-plan-2026-10-10`) in the
chewbacca scope. It strings six existing tasks into one order, each feeding the next:

1. Wilson CI + McNemar stats helper (aeef87f7), so no later step claims a win on noise
2. Recall: land brain-rerank (0058a1d8), then a distilled ranker fast enough for the
   per-prompt hook (under 200ms). Finish line: fresh sealed set, recall@5 >= 70% w CI
3. Corrections stick: calibrate the recur repeat judge (02f79c28), then turn top repeats
   into hooks/tests. Finish line: 100 of 190 enforced by code, weekly repeats falling 3 weeks
4. Self-fix: noise gate for evolve (4ee79d12), then the first kept fix (75663364)
5. Retention: a week after each fix, one untouched task shows the change held
6. One-page scoreboard, baseline vs now w CIs, good enough to show Cole Gawin

Baseline on 2026-10-10: sealed recall@5 50.8 to 55.4% (rerank branch 72.3% but 37s),
49 of 190 corrections enforced by code ([[project_lessons_enforcement_audit]]), zero
kept self-fixes, and the em dash complaint still recurring in other tabs.

**Why:** Caleb asked "are we mogging?" on 10/10. The honest answer was that the design
is ahead (context engineering, the LEMMA problem) and the measured results are behind.
He wanted a plan to close that gap.

**How to apply:** when he asks whether Chewbacca is winning or learning, answer with
these numbers and the current state of the six steps. Update the baseline line when a
step lands, w the sealed-set CI. Related: [[feedback_seal_the_test_set]],
[[project_brain_recall_abort_loop]], [[feedback_enforce_dont_document]].

Competitor half, added 2026-10-10: docs/plans/MOG-PLAN.md turns 36 named competitors into
11 battles (B0 proof tools through B10 connector breadth). Each competitor gets a test
with a number and stays "open" until that test passes. Ledger tasks mog-b0 to mog-b10.
The teardowns behind it live in docs/plans/mog/. Most competitor numbers are their own
claims with no method, so we set the bar, measure ourselves, and publish both.
