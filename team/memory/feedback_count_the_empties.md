---
name: feedback_count_the_empties
description: "Bulk ingest isn't done until empty outputs are counted; a 429 saved blank transcripts with no error"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 1616f3ef-4fd1-4c0f-91c3-dbab0478cf71
  modified: 2026-10-09T18:04:58.913Z
---

This applies to any bulk ingest. Before reporting a number, count the outputs that came back empty and say why each one failed.

On 2026-10-09, the dev-creator ingest (a private note) hand-rolled `yt-dlp --write-auto-subs`. YouTube 429'd every caption request, and the script saved 10 blank transcripts without one error. After that was fixed, 22 of 134 still came back empty: a 300 s timeout killed long videos mid-transcription, and an id starting with "-" got read as a flag. The youtube-transcripts skill already said not to hand-roll caption fetches, and a hook had pointed at that skill before the ingest started, unread.

**Why:** a blank file looks like a finished file. Only a count catches it, and Caleb would have built on a corpus that was 16% empty.

**How to apply:** read the skill the hook names before writing a bulk fetcher, and prefer `yt-bulk` / `yt-transcript`. Write the failure reason into every empty record. Report "N of M empty, because X" alongside the total. Fixed in the product: yt-transcript 719eab0 (dash ids), chewbacca f2ad3b23 (load-guard no longer blocks lookups at high load, fusion-guard no longer reads "The" as a name). Related: [[feedback_stage_only_finished_files]], [[feedback_a_silent_guard_proves_nothing]].
