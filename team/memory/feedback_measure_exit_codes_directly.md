---
name: feedback_measure_exit_codes_directly
description: Three ways a shell check reported a fake result in one session; measure an exit code with nothing after it and never through a pipe.
metadata:
  type: feedback
---

**2026-09-22.** Three separate false readings in one session, each of which sent
me off to investigate or "fix" something that was not broken.

| What I ran | What it measured |
| --- | --- |
| `for g in "tools/x.py --check"; do python3 $g; done` | zsh does not word-split, so `$g` was ONE filename. Every multi-word check reported FAIL. |
| `./bin/chewbacca setup \| head -6; echo $?` | `head`'s status, which is 0. The real exit was 2. |
| `cmd > log 2>&1; echo "exit=$?"` run in the background | The task notification reports the COMPOUND's status, which is the trailing `echo`. Always 0. |

**Why:** each one produced a plausible number attached to the right command
name, so nothing looked wrong. The zsh trap is already written down in
`~/.claude/CLAUDE.md` ("Shell is zsh. `for x in $var` does not word-split") and
I hit it anyway, inside a loop whose whole job was reporting pass or fail.

The cost was real: a FAIL on `checksums.py --check` sent me looking for a
manifest bug that did not exist, and an `exit=0` from `setup.sh` convinced me
the installer had run when it had printed its help and quit.

**How to apply:** run the command bare, with nothing after it and no pipe, then
read `$?` on its own line. To check several, use a function taking the command
as separate arguments (`ok(){ printf '%s ' "$1"; shift; "$@" >/dev/null 2>&1 && echo PASS || echo FAIL; }`),
never a string in a variable. When a check disagrees with your expectation,
re-run that one command by hand before believing it, in either direction.

The same rule as a private note one level down: the thing
reporting the result has to actually be measuring the thing.

Related: [[feedback_timeout_is_missing_on_this_mac]],
[[feedback_a_silent_guard_proves_nothing]],
[[project_chewbacca_pull_push_default]]

**Enforced since 2026-09-27.** The zsh half of this (no word-splitting, plus `for path in` rebinding PATH and `$G[v]` parsing as a subscript) is now `zsh-guard.sh`, a PreToolUse hook in Chewbacca that exits 2 with the fix. It was written after all three recurred in one night, five days after this note.
