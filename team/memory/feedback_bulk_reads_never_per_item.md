---
name: feedback-bulk-reads-never-per-item
description: Large data is read in bulk (one call per field or batch), never one item at a time; a per-card AppleScript loop over Contacts ran 5+ min vs 3.7 s
metadata:
  type: feedback
---

2026-10-21, renaming A2F to GenCollege across Caleb's Contacts. The first scan was an AppleScript `repeat with p in people` that read six fields per card, so every card cost six Apple Events. It was still running at 5 minutes when he asked "What's taking so long?". Reading each field as one column (`Application("Contacts").people.lastName()`) pulled the same data in 3.7 s, and writing the 41 matching cards by id took about a second. He then said "Fix chewbs to never take an inefficent route when navigating a large amount of data".

**Why:** the slow route was the first one written, and nothing stopped it. Per-item round trips scale as items x fields, so the loop that is instant on 5 notes is minutes on a whole address book.

**How to apply:** before touching a whole collection (an app's items, rows, files, API records), read each property for all items in one call and filter in memory; write back only the matches. Not sure of the cost? Time 20 items and multiply before the full run. Enforced by `.claude/hooks/bulk-loop-guard.sh` (refuses the per-item Apple Event loop, `per-item:` overrides for a few ids in hand), and the default path for Contacts is `contacts-bulk find|replace|undo`. Related: [[feedback_slow_means_broken]], [[feedback_nothing_takes_this_long]], [[feedback_fix_the_default_path]].
