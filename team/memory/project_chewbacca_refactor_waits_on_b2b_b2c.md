---
name: project_chewbacca_refactor_waits_on_b2b_b2c
description: Chewbacca's audience refactor (repo visibility, personal docs in docs/plans, what a stranger sees) waits until the B2B vs B2C call is made; don't nag about it before then
metadata:
  type: project
---

Chewbacca's next big refactor is deferred until the team picks B2B or B2C. Caleb, 2026-10-09: "we're gonna refactor when the time comes based on b2b or b2c."

B2B comes first. Caleb, 2026-10-09 late: "For now we keep it repo bc it's gonna be a lot of b2b before we can do b2c." So the install stays a private repo that teammates and client teams clone; a double-click Mac app or public one-line install is B2C work and waits. The in-chat onboarding (`chewbacca welcome`, five tappable questions after install, skills/welcome) shipped the same night and serves both audiences, so it is not part of the deferred refactor.

The refactor covers three things that were found while sorting docs/ on 2026-10-09:
- The repo is PRIVATE (confirmed with gh), so a stranger can't run the install at all.
- Caleb's personal material is still in shared docs: docs/plans/LINKS-FROM-CALEB, OS-COVERAGE, NO-APPS, HUMOR-EXPERIMENTS, AFTER-PANES, 1000.md, and docs/reference/GTM-MEMORY and docs/plans/FIRST-COHORT (client and pricing detail).
- What a new user sees first: docs/README.md's start path.

What already holds without the refactor: docs/ is sorted into guide/reference/plans behind tests/docs_layout.sh, and a stranger's install leaves team memory out (setup.sh --team opts teammates in, tests/test_agent_runtime.py).

**Why:** B2B (a growth engineer for client teams, see [[project_chewbacca_growth_engineer_direction]] and [[project_chewbacca_first_cohort]]) and B2C (see [[project_chewbacca_positioning]]) want different public surfaces, so cleaning for one now would be redone.

**How to apply:** don't raise visibility or moving the personal docs again until he brings up the B2B/B2C decision. When he does, this list is the starting checklist.
