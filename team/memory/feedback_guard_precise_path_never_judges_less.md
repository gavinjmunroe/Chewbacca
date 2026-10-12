---
name: feedback_guard_precise_path_never_judges_less
description: A guard's smarter reading may add places to check, never drop the baseline check; three reviews on 10/11 found 23 bypasses when destructive-guard judged only the resolved target
metadata:
  type: feedback
---

A guard that refuses on a conservative check (destructive-guard: the session's
cwd is dirty and the command holds a destructive git phrase) may get a smarter
reading layered on top, as long as that reading only ever adds directories or
cases to judge and the conservative check still runs.

On 2026-10-11 the false-positive fix "judge the repo the command really
targets instead of the cwd" went through three security reviews in one night:
9 bypasses, then 8 regressions against the old guard, then 6 more on one-line
commands (`true || W=x`, `W[0]=`, a symlink, `--work-tree` beating `-C`, zsh's
two-argument cd). Every one was the same shape: the parse resolved a target
wrongly and the cwd was no longer checked. The version that held (10851837)
always judges the cwd, judges extra targets for complex commands, and gives
false-positive relief only through an explicit per-command DESTRUCTIVE_OK=1.

launch-guard went the same way the same night: a command-position parser for
its UI rule opened seven bypasses, and the shipped fix only stopped reading
the Bash description field, which nothing executes.

**Why:** a guard is a net for accidents. Precision that can be wrong turns a
false positive into lost work, and lost work is the thing the guard exists for.
**How to apply:** for a guard false positive, first remove inputs that never
execute (descriptions, heredoc bodies fed to data commands). If that isn't
enough, add an explicit, narrow override the agent types on the one command.
Run a regression review against the baseline version before landing, with the
baseline's exit code next to the new one. Related: [[feedback_denylist_gate_is_a_backstop]], [[feedback_a_silent_guard_proves_nothing]].
