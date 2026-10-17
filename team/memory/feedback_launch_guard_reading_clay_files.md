---
name: feedback_launch_guard_reading_clay_files
description: Reading repo files that mention Clay: launch-guard refuses any shell line with "clay" in it plus echo, xargs, globs, python -c that writes, or a heredoc, so use the Read tool or one plain grep
metadata:
  type: feedback
---

launch-guard refuses a whole Bash call when the command text mentions Clay
and uses anything beyond known reads joined by ; && || |. On 2026-10-17 three
plain read-only calls were refused in one session while writing a doc about
the Clay bridge: a `sed`, a `python3 -c` that printed JSON, and an `echo ---`
separator between greps. Each cost a retry.

What works: the Read tool for any file whose path says clay, single `grep`
or `head` calls without echo or xargs, and `chewbacca clay <op>` for live
data. The guard reads the command string, not file contents, so a path
like `skills/clay-navigation/` alone triggers it.

Why: the guard exists to stop unreviewed writes and sends near Clay
(see clay-navigation's mistakes list). Don't loosen it for reads, route
around it with the Read tool.
