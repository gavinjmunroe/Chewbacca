---
name: feedback_shared_checkout_mid_merge
description: The shared Chewbacca checkout can be mid-merge by another tab or autopush at any moment; never stage there to fix a gate, compute fixes in a detached worktree of HEAD.
metadata:
  type: feedback
---

The shared checkout at ~/code/chewbacca is written by a dozen tabs and by kit-autopush, so it can be halfway through someone else's merge when you look.

On 2026-10-09 the autopush gate refused a push because SHA256SUMS.txt didn't describe the committed tree. The fix staged a manifest built from the pre-merge HEAD, and `git commit -- SHA256SUMS.txt` failed with "cannot do a partial commit during a merge". Another process was merging origin/main right then. It finished seconds later and regenerated the manifest itself, so nothing bad landed, but the staged file could have gone into that merge commit.

**Why:** a merge in progress means the index belongs to whoever started it. Anything you `git add` goes into their commit.

**How to apply:**
- Before touching the shared index, check `git status` for "still merging" (or `.git/MERGE_HEAD`). If it's there, wait and recheck. Don't stage.
- Build any regenerated file (checksums, README counts) in a detached worktree of HEAD (`git worktree add --detach <scratch> HEAD`), and confirm with `git diff --quiet` there that the committed manifest is already right before changing anything.
- Do your own commits in your own worktree off origin/main and push from there. Related: [[reference_shared_checkout_sync]], [[feedback_push_only_your_commit]], [[feedback_remove_only_your_worktree]].
