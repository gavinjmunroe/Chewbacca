---
name: feedback_agent_starts_the_campaign
description: Nobody is ever told to press anything in Clay; the agent starts a graded draft itself through chewbacca clay campaign-status status=START
metadata:
  type: feedback
---

Starting a Clay campaign is the agent's job. A reply, a `gtme next` step or a
refusal never tells a person to press Start or click anything in Clay.

**Why:** Caleb, 2026-10-12, after the Zeutara launch plan ended on "Caleb
presses Start": "Never tell anyone to press anything in clay themselves and
never flashbang anyone fix chewbs". The old design refused every START in code
because Clay decides launch vs resume at send time.

**How to apply:** `chewbacca clay campaign-status ws=<ws> campaign=cam_...
status=START --allow-writes`. It sends only when the campaign is still a draft
(gtme-grade --verify reads that itself on a scrubbed env, so a START is never a
resume), a launch grade passes on that campaign, the pre-send gate passed
(full, or full_but_lines for a launch only), and Caleb's ok is in chat within
2 hours. Landed in 0e58c11d and 1c53d357 with tests in
tests/test_launch_guard_grade.py. A review of the first version found the
draft read trusted whatever `clay` was on PATH; keep that check in the grader.
Clay's live status value after a START was never measured: read it back on
the first real launch and tighten the readback in bin/chewbacca-clay.

Related: [[feedback_client_review_is_the_gate]], [[feedback_take_me_there]].
