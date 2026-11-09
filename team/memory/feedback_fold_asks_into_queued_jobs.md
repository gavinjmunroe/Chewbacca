---
name: feedback_fold_asks_into_queued_jobs
description: A queued `chewbacca jobs` prompt is read when the job starts, so a new ask that fits a queued job gets edited into its prompt file instead of becoming another job; a running job can't take edits (10/13)
metadata:
  type: feedback
---

On 2026-10-13 Caleb added asks every few minutes while 8 to 11 jobs ran ("are we even using jev&genui", "Same w dining halls", "Freemium type shi", "There's a reason only 2% of americans pay for ai"). Jobs submitted as `bash -lc '... claude -p "$(cat <prompt.md>)"'` read their prompt file only when the queue starts them, so each of those asks went straight into the matching queued job's prompt with a quoted line and a date, and no new job was needed. A job already running had read its prompt and couldn't take the edit; those asks became a follow-up job chained with `--after`.

**Why:** one more job per ask pushed load past 30 and split related work across sessions that never saw each other.
**How to apply:** check `chewbacca jobs list` first. Queued and the ask fits: edit its prompt file, grep the edit landed, tell Caleb which job carries it. Running: chain a follow-up with `--after <id>`. Keep about 4 running at once; the evening or morning summary job goes `--after` every job of the day so it reads every report. Related: [[feedback_chain_waits_in_the_queue]].
