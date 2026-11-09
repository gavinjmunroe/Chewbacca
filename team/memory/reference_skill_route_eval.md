---
name: reference-skill-route-eval
description: How the skill router is measured (tools/skill_route_eval.py, private held-out labels), the 2026-10-16 numbers, and the accuracy fixes that failed held-out
metadata:
  type: reference
---

The skill router (`.claude/hooks/skill-route.sh`) is measured with `tools/skill_route_eval.py`.
It runs the real hook on hand-labeled prompts, each labeled with a skill or NONE, with train and
held apart by a hash of the text. The labels hold Caleb's prompts, so they live in
`~/second-brain/systems/skill-route-eval.jsonl` and never in this repo.
`tests/live/skill-route-eval.sh` fails when held-out drops below the floors.

2026-10-16, 238 prompts from that week. Held-out before: precision 7.5% (4 of 53), recall
21.1% (4 of 19), a skill on 45.8% of typed no-skill prompts, 22.9% of machine traffic nudged or
gated. The hook receives the app's `<system-reminder>` block in front of a cross-session message,
so a marker check on the raw prompt missed it. That fix landed in 5de5edc7: held precision 8.5%,
recall unchanged, machine 5.7%, p95 283ms.

Rules for the next attempt:

- Tune on train and run held-out once. Hub correction plus keyword agreement went from 22% to
  50% precision on train, but held-out only moved from 8.9% to 15% and recall fell from 21% to
  16%, so it missed the +15/-5 bar and wasn't landed.
- embeddinggemma's top pick is right for 13 of 30 train positives at any threshold. A cutoff
  can't fix that; the ranking has to get better first.
- A llama3.1:8b rerank never answers "none" and takes 3.2s at p50. A should-speak probe on
  112 rows learned nothing.
- 19 held-out positives can't separate 5 points (that's one prompt). Label more positives
  first.
- The big-work probe armed skill-gate on 30 of 126 held-out prompts, about a third of them
  big by hand count. Moving PROBE_CUTOFF needs big-work labels, and the gate exists because
  Caleb said graph engineering got skipped. A missed nudge has cost more than a false one.

2026-10-17, subtraction as the control: 540 labeled prompts (302 skill-shaped ones count for
recall only), 71 held-out positives. Meaning router 10.9% precision and 40.8% recall; keyword
plus named skills 11.9% and 25.4%; named only 25% and 4.2%; no meaning cutoff reached 50% on
train. The no-meaning control won the pre-set rule, so the meaning nudge is opt-in
(`SKILL_ROUTE_MEANING=on`) and the confirmed held numbers are 12.8% and 23.9%, machine 0%. The
cost is texting-register recall: "wats due tmr" and "who do i owe a text back" now get nothing.
A next attempt measures against these floors, not against the old router.
