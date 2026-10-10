---
name: reference_disk_full_cleanup
description: When the Mac's disk is full, which caches are safe to clear, which command hangs, and what is never ours to delete.
metadata:
  type: reference
---

On 2026-10-09 the data volume hit 100% (2 GB free of 926) with 16 tabs running, and everything was crashing. Clearing regenerable caches got it to 17-19 GB.

Safe, and they rebuild themselves: `uv cache prune --force` (16.6 GB; without `--force` it waits forever on another tab's uv lock, it hung 10 minutes), `brew cleanup -s --prune=all` (3.5 GB), `npm cache clean --force`, `pnpm store prune`, `xcrun simctl delete unavailable`, `~/Library/Caches/pip` and Spotify's cache.

Never ours to delete: `~/Library/Messages` (213 GB of attachments; shortening history deletes old texts, his call), the iMovie library (51 GB), and the Trash (emptying is permanent, he does it).

Measure with `df -h /System/Volumes/Data`, not `/`: the root volume reads mostly empty on APFS. Related: [[feedback_high_load_reads_as_bugs]], [[feedback_slow_means_broken]].

Second time, 2026-10-09 21:35: down to 1.1 GB free, so every shell call failed with ENOSPC and two HUD tests failed that pass on their own. uv had nothing to prune; ShipIt update caches (Mirror, Loom) and pip freed about 9 GB, and removing seven merged agent worktrees under .claude/worktrees freed another 2.5 GB (they hold Swift .build dirs, 300 to 600 MB each). Remove a worktree only when its branch is on origin and `git status` in it is clean, by exact path.
