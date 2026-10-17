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

5. **A land piped through `| tail` can say exit 0 and push nothing.** On 2026-10-16 `... && chewbacca land HEAD 2>&1 | tail -1` waited past the 600 s tool timeout, went to the background, and the laptop closed mid-queue. The notification said exit 0 (the pipe's exit is tail's) with empty output, and the commit wasn't on main. Never pipe land, and after any land run `git fetch && git merge-base --is-ancestor <landed sha> origin/main` before calling it landed. Use the sha land prints ("land: d5a50b35 ..."), never your local commit: land cherry-picks onto fresh main, so your local sha is never an ancestor and the check fails on a good land (2026-10-17).
6. **`chewbacca land HEAD` landed nothing before e02d3650.** Inside its temp worktree HEAD was origin/main. Fixed: refs resolve in the caller's checkout.
7. **Under heavy load pre-push refuses on a timing test, not on your change.** On 2026-10-17 at load 140 a two-file ready-guard fix was refused because tests/test_hookd.py's "one hookd dispatch answers like separate hooks" took 5.27 s against its 5 s cap. Read which check failed before touching your diff; if it is a timing check unrelated to the files you changed, rerun the land when `chewbacca machine` shows the load down.

**Why:** each trap looked like a different failure (manifest refusal, a WIP on main, a guard refusal, a pathspec error), and each was paid once already.

**How to apply:** follow the order in 1 and 2 on every worktree land. Related: [[feedback_shared_checkout_mid_merge]], [[feedback_remove_only_your_worktree]].
