---
name: feedback_land_workflow_traps
description: Four traps that cost the core lane edits on 2026-10-10 while landing from worktrees; checksums hash the index, never chain cleanup with ;, overrides must lead, zsh lists need arrays
metadata:
  type: feedback
---

Landing from a detached worktree with `chewbacca land` ([[feedback_push_race_retry_loop]]) on 2026-10-10 hit four traps, each one costing a retry or a lost edit:

1. **`tools/checksums.py` hashes the index, not the disk.** Run it after `git add`, then add SHA256SUMS.txt. Run before staging, it silently writes the old hashes and the pre-commit manifest guard refuses. Order: `git add <files> && python3 tools/checksums.py && git add SHA256SUMS.txt`.
2. **Never chain cleanup after a commit with `;`.** `commit ...; land ...; worktree remove --force` ran the land on a stale "wip:" commit (930f716c reached main) and later removed a worktree holding the uncommitted edit. Use `&&` from commit through land, and remove the worktree in its own call after reading the land line. land now refuses wip/fixup/squash subjects (28cf74ae).
3. **`DESTRUCTIVE_OK=1` only counts as the command's first word.** destructive-guard matches `^DESTRUCTIVE_OK=1 `, so `cd x && DESTRUCTIVE_OK=1 git reset` is still refused. Lead with it: `DESTRUCTIVE_OK=1 bash -c 'cd x && ...'`.
4. **zsh never word-splits `$F`.** A space-separated file list in a variable reaches git as one path. Use an array: `F=(a b c); git add "${F[@]}"`.

**Why:** each trap looked like a different failure (manifest refusal, a WIP on main, a guard refusal, a pathspec error), and each was paid once already.

**How to apply:** follow the order in 1 and 2 on every worktree land. Related: [[feedback_shared_checkout_mid_merge]], [[feedback_remove_only_your_worktree]].
