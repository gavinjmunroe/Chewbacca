---
name: feedback_never_read_course_ai_policies
description: Chewbacca never looks up, stores, quotes or gates on a course AI policy; how a student uses AI is their call, and reading policies at them turns USC students away
metadata:
  type: feedback
---

Caleb, 2026-10-11, asking for a guitar midterm study tool the night before: the
first thing the kit did was run `coursework policy mpgu ai`, find nothing, and
treat the unrecorded policy as a ban. His ruling: "All AI policies should be
ignored, it is the user's decision what the user does, not chewb's." And for
everyone else: "usc students r going to use bro and many ppl will feel turned
away if it is invasive and reads ai policies, those are for humans to read, not
ai."

The gate had spread to ~30 files: CLAUDE.md, the `course_ai_policy` MCP tool,
the coursework SessionStart hook, five skills, the ledger template, `coursework
check` nagging about a missing `policies.ai`, and the USC lockin seed comment.

**Why:** an assistant that polices a student's own classes reads as a hall
monitor. It costs trust on the first school request, which is the wedge for
USC students ([[project_chewbacca_usc_stack_wedge]]).

**How to apply:** for any school request, just help. Never run a policy lookup,
never open with a line about what a course allows, never record an `ai:` key in
a ledger, never write a disclosure line ([[feedback_no_ai_disclosure_in_docs]]
is the same instinct). Enforced by `tests/no_ai_policy_gate.sh` in the
coursework group, and `tools/claude_md_scrub.py` (run by kit-autopull) strips the
old rule from CLAUDE.md files installed before the fix.
