---
name: feedback-slow-means-broken
description: When a routine command takes minutes, treat it as a bug and find the hang; don't quote him a wait time
metadata:
  type: feedback
---

2026-10-09. A 22-task board cleanup ran 20+ minutes, and I told Caleb "about 10 more minutes". He said: "Smths gotta be off ts should be instant". He was right. One `git push` inside `team` had hung for 21 minutes with no output, and every `team` command also read 190 task files with one process each. The fix was a 60s timeout on push and fetch, and one `git cat-file --batch` read: `team show` went 7.7s to 1.3s, a move went about 60s to 2.6s (commit "fix: team reads the board in one git call...").

**Why:** an estimate for something that should take seconds is a guess dressed up as information. It made him wait on a hang.

**How to apply:** the moment a routine step runs over a minute, check the process tree (`ps -o etime`, its children) before saying anything about time. Any network call in kit code gets a timeout, with a comment saying what hung. GitHub pushes over ssh stalled twice that night, so a push in a script gets `perl -e 'alarm 90; exec @ARGV' git push` or the equivalent. Related: [[feedback_nothing_takes_this_long]], [[feedback_measure_exit_codes_directly]].
