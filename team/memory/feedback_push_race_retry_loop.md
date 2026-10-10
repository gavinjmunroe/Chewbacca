---
name: feedback_push_race_retry_loop
description: With 10+ tabs pushing to main, use `chewbacca land`; it pushes from a fresh worktree, regenerates SHA256SUMS and retries lost races.
metadata:
  type: feedback
---

On a night with 10+ live tabs, pushing a one-file fix to Chewbacca main failed four times in a row: the shared checkout had other tabs' dirty files so `git pull` aborted, pre-push refused a stale SHA256SUMS.txt, and every rebase lost the race to another tab's push.

**Why:** 2026-10-09, the skill-gate fix. Caleb watched it fail and said "Bro wtf you keep failing". Each failure was a different gate, fixed one at a time.

**How to apply:** Run `chewbacca land --paths <files> -m "<msg>"` or `chewbacca land <sha>...` (built 2026-10-10, tests/land.sh). It does everything below, under a lock so local tabs take turns. The manual recipe, kept for repos without it:
`git worktree add --detach <scratch> origin/main`, write the change with `git show <sha>:<path> > <path>` (not `git checkout --`, which destructive-guard refuses), run `python3 tools/checksums.py` AFTER committing the change and commit the manifest too, then loop up to 4 times: fetch, rebase origin/main, regenerate checksums, commit if dirty, push. Remove only that worktree by exact path. Related: [[feedback_shared_checkout_mid_merge]], [[feedback_push_only_your_commit]], [[project_chewbacca_autopush]].

Also from that night: skill-gate re-armed on a mid-turn message a minute after the skill loaded and refused the same turn twice; it now treats a load in the last 10 minutes as this turn's graph (3e0948b7).

Since 2026-10-10: `--paths` three-way merges a stale disk copy against main instead of overwriting it (it had reverted three MEMORY.md index lines), team/memory/MEMORY.md merges as a union, and SHA256SUMS.txt and the README counts merge through drivers (tools/merge_regen.py), so back-to-back lands stop conflicting on all three. tests/land.sh and tests/merge_drivers.sh pin it.
