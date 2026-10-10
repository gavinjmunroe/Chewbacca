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

Since 2026-10-09 `disk-guard` (UserPromptSubmit) does this automatically: below 20 GB free it starts one background prune of the safe list per 10 minutes and tells the agent; below 5 GB it says to start nothing large. Log: `~/.chewbacca/logs/disk-guard.log`. The third fill that night left 238 MB and the Bash tool couldn't start at all, since it writes output to a file; the Terminal panel tool still worked and was the way out.

The real cause of the refills that night (254 MB free at 21:45) was Chewbacca's own: `tools/write_log.py` kept a 6 MB repo fingerprint for every finished tool call in `~/.chewbacca/session-state`, 44,065 files and 14.2 GB. Snapshots older than an hour there are dead and safe to delete (`find ~/.chewbacca/session-state -name '*.json' -mmin +60 -delete`); the fix deletes them as each call finishes. Check that folder first next time, and `du` before clearing caches: the caches were 39 GB, the leak refilled them in hours.

On 2026-10-09 Caleb also had iCloud Photos turned off on this Mac and the 50 GB Photos library removed (all 172,673 assets were already uploaded; originals folder held 0 files). Photos on this Mac is now empty by his choice, so do not re-enable it to "fix" anything. Free space went 6 GB to 89 GB after he emptied the Trash; deleting the library from the Trash took over an hour because it is hundreds of thousands of tiny files.

Why each snapshot was 4 to 6 MB (found 2026-10-10): sync-chewbacca.sh mirrored ~/.chewbacca, session-state included, into ~/second-brain/chewbacca, and 22,245 of those snapshots got committed there. The brain is a repo write-log watches, so every new snapshot fingerprinted every old one. The mirror now excludes session-state/, a signed-in Chrome profile (api-anything/profile/), chat bridge keys (matrix/) and jobs/. A brain snapshot went from 30,304 files to 3,093. If snapshots balloon again, count `git status --untracked-files=all` in each watched repo first.
