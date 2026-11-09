---
name: feedback_background_writers_say_so
description: Nothing on macOS says which process wrote a file without root, so background work that writes where tabs work (a queued job, a mirror rsync) marks its run in background-writers.tsv, or the write-log credits its files to whatever call is open
metadata:
  type: feedback
---

On 2026-10-12 the Rust write-log's shadow logged 14,691 rows the Python one didn't, and the Python one itself carried about 5,500 rows that weren't its calls' writes. Every one came from two background writers: the creator-transcripts job (cwd ~/second-brain/raw/creators, ran 10/9 to 10/12) and people-sync's rsync --delete of ~/.chewbacca into the brain, which also mirrored the kit runtime's snapshots (239MB of linked worktrees). 3,111 snapshot deletions went to one Bash call in the togari tab.

FSEvents carries no pid, a status diff carries none, and fs_usage, dtrace and Endpoint Security all need root or an entitlement. So the process that starts background work marks it: `begin|end <ts> <pid> <root>` rows in ~/.chewbacca/background-writers.tsv. Both write-logs drop a Bash-inferred row under a root whose run overlapped the call and whose mtime falls inside that run (or that was deleted). Exact Write/Edit rows and committed paths are never dropped.

**Why:** brain-sync commits a session's rows under that session's prompt, so a misattributed row puts another job's files into a tab's commit, and parity between the two write-logs can't reach 0 while both guess differently about the same background write.

**How to apply:** `chewbacca jobs submit --heavy` or `--net` marks a job whose cwd is a folder inside a repo on its own; a build, a light job or a job at a repo's top that writes into a repo tabs use takes `--writes DIR`. Anything else that writes in the background into a repo tabs use runs under `python3 tools/write_log.py background --root DIR -- CMD`. Tests: tests/test_write_log.py (background cases), tests/test_writelog_rust.py, tests/jobs.sh. See [[project_chewbacca_reengineer_2026_10]].
