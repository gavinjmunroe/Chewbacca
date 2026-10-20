---
name: feedback_chewbacca_main_only
description: "Chewbacca keeps exactly one branch, main, locally and on GitHub; work happens in detached worktrees and lands with chewbacca land."
metadata:
  node_type: memory
  type: feedback
  modified: 2026-10-19T21:20:00.000Z
---

Chewbacca has one branch: main. Caleb, 2026-10-19: "Chewbacca should only ever
have 1 branch: main".

That night there were 28 local branches and 12 on GitHub. A content check showed
every one already on origin/main, so all were deleted. Tips are backed up in
`~/.chewbacca/branch-archive/2026-10-19.bundle` with a SHA list beside it.
Worktrees that held a branch were detached in place, uncommitted files kept.

How to work: `git worktree add --detach <path> origin/main`, commit, then
`chewbacca land <sha>`. Never `git push origin <branch>`. A `claude/*` branch from
EnterWorktree gets deleted as soon as its commits land.

Gavin's fork (`gavin` remote) is his repo, not ours, and was left alone.
