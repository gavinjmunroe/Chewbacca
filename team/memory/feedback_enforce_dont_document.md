---
name: feedback_enforce_dont_document
description: When a mistake repeats, ship code that refuses it. Writing the lesson into a skill does not stop it happening again.
metadata:
  type: feedback
---

Set by Caleb 2026-09-20, after he said **"I have a feeling you still are stupid"** four
separate times about the same set of investor lists, and then **"Bro I shouldn't hv to
keep saying it, fix chewbacca!"**

Each round found real defects by reading the output files: 2,121 people on more than one
list, eleven partners at one fund, info@ mailboxes, analysts who cannot write a cheque,
843 rows whose company name was the literal string "Company". Each round the response was
to write the lesson into `skills/list-audit/SKILL.md` and report it fixed. The lesson
never fired, because prose does not run.

His point was not that the lists were bad. It was that **needing to be told is the bug**,
and the bug lives in Chewbacca.

`bin/craft-gate` already says this in its own docstring: "This repo is full of good
judgment in markdown and almost none of it fires. Enforcement is code that runs, not a
paragraph." The fix was to build `bin/list-gate`, a Stop hook that calls it, and nine
tests, then prove it by sabotaging the exit code and watching the suite fail.

**Why:** a lesson in markdown helps only when an agent happens to read the right file at
the right moment. A gate helps every time, including when the agent is confident and
wrong, which is exactly when it is needed.

**How to apply:** the first repeat of a mistake is a signal to write code, not
documentation. Ask what program would have refused this, build it, wire it into a hook or
the test suite, and prove it fires by breaking it on purpose. If the only artifact of a
lesson is prose, the lesson did not land. Pair the enforcement with a short skill section
that explains the judgement the code cannot encode, never prose alone.

Related: [[project_chewbacca_craft_and_claude_tab]],
[[feedback_never_close_without_updating_chewbacca]], a private note,
[[feedback_verify_the_generated_block]]
