---
name: feedback_red_team_the_gate_before_done
description: A send gate isn't done until an adversary has run probes against it and every hole they reproduced has a test. Dough's first pass of the Jonah checks had 20 holes across three rounds (2026-11-02)
metadata:
  type: feedback
---

Dough's send gate (calebnewtonusc/dough) is the code that decides who gets loaded and what they read. On 2026-11-02 Caleb asked "Did dough learn all the mistakes we had with jonah?", then "Upgrade dough! Fill the gaps!" and "Then pressure and stress test our confidence in completion!". The first build of the Jonah checks passed its own 52 tests. A red-team subagent that actually ran probes against it, with no edits and a fake Dripify, then reproduced 9 holes. The fixes opened 6 more plus 4 false holds, and round 3 found 5 more (e99e598).

What got through each time was the same kind of thing: a check that passed when its input was empty or odd.

- An empty CSV, or a "Company size" column, counted as a customer list.
- A surname on the page ("Mark Fisher") passed as the company Fisher Technologies.
- A subdomain label ("us", "go") matched any page.
- A plan could load twice.
- Gate settings could be loosened for the plan and tightened for the approval.
- A reply time with a "+09:00" offset was read as UTC.

**How to apply:**

- Before calling a send gate done, brief a subagent to break it with real inputs: messy exports, unicode, timezones, hand-edited state files, configs changed between steps. It only reports what it reproduced.
- Fix every finding with a test named for the input that got through (dough `tests/test_pilot.py`, classes `RedTeam`, `RedTeamRound2` and `RedTeamRound3`). Then send the same agent back to attack the fixes. Stop when a rerun returns only known heuristic limits.
- Hash what was approved, settings included, and refuse when it drifts.
- When a match is ambiguous, hold the row for a person. Don't guess either way.
- Free-text legal-name detection stays heuristic. The reliable check is the row's own company name appearing in its own line.

Related: [[feedback_client_review_is_the_gate]], [[feedback_ready_means_gtme_ready_passed]].
