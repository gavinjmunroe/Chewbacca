---
name: feedback_workers_never_wait_on_tail
description: A subagent that backgrounds the suite and waits on `tail -f` stalls forever after the run ends; run long suites in the foreground (2026-10-10)
metadata:
  type: feedback
---

On 2026-10-10 a suite-fix worker started `tests/run.sh` in the background and waited on a
`tail -f` of its log. The suite finished (667 passed, 2 failed, 1093s) and the worker sat
idle 18 more minutes, with two fixes committed and unpushed, until the coordinator found the
orphaned tail with `ps` and killed it.

**Why:** `tail -f` never exits, so nothing wakes the agent when the run ends.

**How to apply:**
- Workers run `bash tests/run.sh` in the foreground with a long timeout, never backgrounded.
- A coordinator whose worker reports "still waiting" twice checks `ps` for the run before
  waiting again.
- Under 10+ tabs the suite runs at load 30 to 97; a group that fails in the full run but
  passes alone is load, see [[feedback_high_load_reads_as_bugs]].
