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

Since 2026-10-09 `disk-guard` (UserPromptSubmit) does this automatically: below 20 GB free it starts one background prune of the safe list per 10 minutes and tells the agent; below 5 GB it says to start nothing large. Log: `~/.chewbacca/logs/disk-guard.log`. The third fill that night left 238 MB and the Bash tool couldn't start at all, since it writes output to a file; the Terminal panel tool still worked and was the way out.
