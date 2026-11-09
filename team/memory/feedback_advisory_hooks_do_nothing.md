---
name: feedback_advisory_hooks_do_nothing
description: slop-guard emitted hookSpecificOutput.continueLoop and exited 0, so twelve replies scoring 40-100 against a limit of 10 all shipped; a Stop hook must exit 2 to enforce
metadata:
  type: feedback
---

2026-09-21. Caleb: *"Bro why'd chewbacca stop talking like me the ai slop is
back bruh"*. Twelve consecutive replies in that session, scored with the
kit's own `slop-check --chat` against a limit of 10:

    40, 100, 40, 40, 40, 40, 40, 40, 100, 40, 100, 0

One opened with an em dash, which the rules ban outright. `slop-guard` fired
on every single one and changed nothing.

**Why.** It printed `hookSpecificOutput.continueLoop: true` with a
`systemMessage` and **exited 0**. `continueLoop` is not part of the Stop
hook contract, so the harness ignored the whole object. Exit 2 with the text
on stderr is what actually stops a turn. In that file exit 2 existed only as
the fallback for `jq` failing.

**The part that cost an extra round.** There were TWO such exits, one for
`prose-check` and one for `slop-check`. The prose-check one came first and
was the one being taken, so fixing the slop-check one alone changed nothing
and the test still passed at exit 0. Fix every exit path, then test.

**How to apply.** A hook that does not exit non-zero is a log line. Before
trusting any guard, feed it something that must fail and assert the exit
code, not the output: `hook < bad.json; echo $?` must be 2, and
`hook < good.json; echo $?` must be 0. Both directions, every time.

This is the third instance in one session of a capability that exists, is
correct, and never fires. See a private note,
[[feedback_a_silent_guard_proves_nothing]] and
[[feedback_enforce_dont_document]].
