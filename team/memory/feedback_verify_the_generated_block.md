---
name: feedback_verify_the_generated_block
description: An edit inside a BEGIN GENERATED block gets silently reverted the next time the generator runs; fix the generator instead.
metadata:
  type: feedback
---

Two fixes to `setup.sh` on 2026-09-19 were made inside
`# BEGIN GENERATED: extensions` and `# BEGIN GENERATED: cli`. Both passed their
tests, and both vanished the next time `tools/inventory.py` ran. The file on
disk is output, not source.

**Why:** the same trap already caught the agent-neutral rule
([[reference_context_budget_and_generated_rules]]). A generated region has an
owner, and editing the output means the change survives exactly until the owner
runs again, which is every session-stop here.

**How to apply:** before editing any file, `grep -n "BEGIN GENERATED"` it. If
the target line falls inside a block, edit the generator, re-run it, and then
grep the output to confirm the change is there. Verifying the edit landed is not
optional for generated files, because the failure is silent and delayed.

Same session, related: `git checkout <file>` to undo a deliberate test mutation
also reverted an hour of uncommitted work in that file. Commit before mutating,
or mutate a copy.

See [[project_chewbacca_install_broken_2026_09_19]].

## A false alarm on 2026-09-20, and why it was false

A session reported that the agent-agnostic installer fix had been silently
reverted by the generator and lost. **That was wrong and the correction
matters more than the original note.**

The whole fix was already committed at 16:05 in `f4e15eb`, "fix(onboarding):
stop sending people to a paywall for an agent they do not use", and pushed:
`setup.sh`, `start.sh`, `tests/agent_agnostic.sh`, `tests/run.sh` **and
`tools/inventory.py`**. Nothing was lost.

**And it was done the right way**, which is the reusable part: the fix went
into `tools/inventory.py`, the generator, not only into the generated
`setup.sh`. That is exactly what this note asks for, so the lesson had already
been applied before the session that panicked about it.

**What produced the false alarm:** `~/.claude/hooks/sync-to-d1.sh` regenerates
`README.md`, `setup.sh`, `settings/toolkit.json` and `SHA256SUMS.txt` on every
Stop. That leaves those files dirty in the working tree with nobody typing
anything, and a dirty `SHA256SUMS.txt` is what fails `kit-autopush`'s checksum
gate. A dirty generated file is the expected steady state here, **not evidence
that work was lost.** Check `git log` for the fix before concluding anything is
gone.
