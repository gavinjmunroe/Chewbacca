---
name: feedback_rebase_reapply_hunks_not_files
description: When a push is rejected, reapply your hunks to fresh main; checking out your whole old file reverts other tabs' lines. Stage before checksums.py.
metadata:
  type: feedback
---

On 2026-10-10 a push of a 6-line setup.sh change was rejected, so the fix was moved onto fresh origin/main with `git checkout <my-commit> -- setup.sh`. That copied the whole old file and silently reverted 3 lines another tab had landed minutes earlier (the agent-nice link and the machine-budget matcher). It was caught only by reading `git diff HEAD~1 -- setup.sh` after the push, and needed a second commit to restore.

**Why:** `git checkout <commit> -- <file>` takes the file as it was in your commit, not your change. With 10+ tabs landing on main, any file you touched has probably moved. `chewbacca land` also stopped on a SHA256SUMS.txt cherry-pick conflict, which is what pushed the manual route.

**How to apply:** On a rejected push, check out fresh origin/main and reapply only your hunks (a patch script or Edit on the fresh file), never a whole-file checkout. Before committing, read `git diff origin/main` line by line: every `-` line must be yours. For bin/ and setup.sh, `git add` your files first and then run `python3 tools/checksums.py`, because it hashes what's staged; running it before staging left the manifest stale and the commit refused twice. Related: [[feedback_push_only_your_commit]], [[feedback_push_race_retry_loop]].
