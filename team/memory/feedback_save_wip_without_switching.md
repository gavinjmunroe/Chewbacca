---
name: feedback_save_wip_without_switching
description: Saving a shared checkout's dirty work to a branch by committing and switching back wipes other agents' untracked files; snapshot without moving the tree
metadata:
  type: feedback
---

To get a shared checkout's uncommitted work off the machine, never commit it
on a new branch and `git switch` back. On 2026-10-10 in TTS-Dev, a "push the 16
dirty files now" step did exactly that: the switch back to main removed every
newly tracked file from the working tree while three agents were mid-edit, and
one had to restore its own files from the WIP commit.

**Why:** a branch switch rewrites the working tree for everyone sharing it, and
files that are untracked on the target branch disappear.

**How to apply:** snapshot without touching the tree. Use a temporary index:
`GIT_INDEX_FILE=/tmp/wip.idx git add -A` then `git write-tree`,
`git commit-tree <tree> -p HEAD -m wip`, and
`git push origin <sha>:refs/heads/wip/<name>`. Or use `git stash create`, which
returns a commit without changing files. The working tree and index stay
exactly as the other agents left them. See [[feedback_remove_only_your_worktree]].
