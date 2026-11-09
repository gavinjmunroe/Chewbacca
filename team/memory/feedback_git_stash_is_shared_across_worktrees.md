---
name: feedback_git_stash_is_shared_across_worktrees
description: git stash is one list for every worktree of a repo, so a stash pop in a temp worktree can apply another tab's stash; to test a revert, copy the old file from git show instead
metadata:
  type: feedback
---

Every worktree of a repo shares one stash list. On 2026-11-03 a temp worktree
tried `git stash push -- <hook>` to test the old version of a guard. The
destructive-guard refused the push, and the `git stash pop` after it applied
stash@{0}, another tab's WIP from fix/people-sub-help, into the temp worktree
with conflicts in BACKLOG.md and tests/run.sh. The stash entry was kept, so
nothing was lost, but only because the pop failed.

What to do instead: to run a test against the old version of a file, copy the
fixed file aside, write the old one with `git show origin/main:<path>`, run
the test, then copy the fix back. Never pop a stash you didn't just push and
see succeed.
