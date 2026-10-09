---
name: feedback_push_only_your_commit
description: when local main carries other tabs' unpushed commits that conflict with origin, push only your own commit via a temp worktree off origin/main
metadata:
  type: feedback
---

On 2026-10-09 local main held other tabs' commits (a README line-count chore, two spiderverse-style edits) that conflicted with origin. `git pull --rebase` stopped on their conflicts twice, and the kit-autopush Stop hook kept reporting "PUSH FAILED" for commits that weren't mine.

**Why:** resolving another tab's conflict files somebody else's work under my judgment while that tab is still live, and an aborted rebase with `--autostash` can tangle their uncommitted edits.

**How to apply:** `git worktree add --detach /tmp/claude-501/pushwt origin/main`, cherry-pick only my commit, run my tests and `python3 tools/checksums.py --check` there, `git push origin HEAD:main`, remove the worktree. `git cherry -v origin/main HEAD` afterwards shows mine as `-` (already upstream), so their next rebase drops it cleanly. Leave their commits and conflicts to them, and say so in one line. For the manifest, rewrite only my files' lines in SHA256SUMS.txt, never regenerate it over a tree holding other tabs' edits. See [[feedback_always_land_on_main]].

**2026-10-10 addendum:** SHA256SUMS.txt can already hold another tab's uncommitted lines. Patching "only my lines" into the working copy and committing it still shipped theirs, and the clean push copy then failed `checksums.py --check`. In the push worktree, start from origin's manifest (`git checkout origin/main -- SHA256SUMS.txt`), then rewrite only your files' lines. And `git checkout <sha> -- <your files>` beats cherry-pick when the commit touched the manifest.
`tools/checksums.py` hashes what's staged, not the working copy: run `git add <your files>` first, then `checksums.py`, then `git add SHA256SUMS.txt`. Regenerating before staging left the manifest unchanged and the pre-commit manifest guard refused (2026-10-10). In a clean push worktree the full regenerate is safe, because only origin plus your files are there.
