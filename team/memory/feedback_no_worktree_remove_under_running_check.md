---
name: feedback-no-worktree-remove-under-running-check
description: Never remove a worktree while a background check still reads from it; hookd parity replayed 0 calls and reported exit 0 (10/21)
metadata:
  type: feedback
---

2026-10-21, landing bulk-loop-guard. `hookd_replay.py parity` ran in the background from `../wt-bulk-fetch`, the land finished first, and I removed the worktree. Every replay then failed with exit 127 ("No such file or directory") and the job still exited 0, so the done reply had to say the check never finished. Rerun from the kit snapshot: 47,150 real calls, 0 mismatches.

**Why:** a background job reads its files when it gets to them, and the worktree it started in can vanish first. Exit 0 from a job whose rows all say 127 proves nothing.

**How to apply:** before `git worktree remove`, check no job of yours still runs from it (`ps -o etime,command -ax | grep <worktree>`). Run checks that outlive the worktree from `~/.chewbacca/kit/current` with absolute paths (`--hooks "$HOME/.chewbacca/kit/current/.claude/hooks"`, a relative `--hooks` also gives 127). Related: [[feedback_measure_exit_codes_directly]], [[feedback_bulk_reads_never_per_item]].
