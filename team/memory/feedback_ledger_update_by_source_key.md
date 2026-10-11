---
name: feedback_ledger_update_by_source_key
description: Close or edit a work-ledger task by its source_key, never by grepping the list for an id; a grep marked the wrong active task done (10/11)
metadata:
  type: feedback
---

On 2026-10-11 I grepped `work-ledger list` output for a phrase and took the first id in the matching line. The list is one JSON line, so the first id was the top task, "Chewb for every USC student" (active), and it got marked done with another task's evidence. Caught and restored the same minute.

**Why:** the ledger is the record of what Caleb committed to; a wrong "done" hides open work for days.

**How to apply:** `work-ledger list --scope <scope>` prints JSON. Parse it and select by `source_key` (set one on every add), then update that id. Read back the title in the update's output before reporting.
