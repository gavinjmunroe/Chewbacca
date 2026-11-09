---
name: feedback_vanished_commit_check_reflog
description: "When a commit disappears from the shared Chewbacca checkout, another tab rewrote history; recover from the reflog in a worktree, never redo the work."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 042ca149-71bc-47cb-b8c9-641327d629d6
  modified: 2026-10-09T10:46:28.752Z
---

A commit missing from `git log` in the shared `~/code/chewbacca` checkout usually means another tab rebased or reset it away, not that it failed. On 2026-10-09 at 03:39 a tab ran a rebase onto origin/main that picked only its own commit (7ce39dc3, re-landed as 1fe430f7) and dropped four local commits from three other tabs: the jev route fix, startup-finance CSV quoting, the goodnight000 docs, and chewbacca api. The working tree followed, so the edits vanished from disk too.

**Why:** the dropped commits were never pushed, so the reflog was the only copy. Redoing the work by hand would have cost the jev fix and lost the other tabs' commits entirely.

**How to apply:** `git reflog` for the missing sha, `git branch -r --contains <sha>` to see whether it reached origin, then cherry-pick the unpushed ones in a fresh worktree off origin/main and push from there. Skip any commit whose owner is visibly restaging the same files (chewbacca-api was being redone in place). Related: [[feedback_inferred_authorship_misfires]], [[feedback_always_land_on_main]].
