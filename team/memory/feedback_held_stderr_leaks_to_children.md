---
name: feedback_held_stderr_leaks_to_children
description: A hook that holds the host's stderr on a spare fd leaks it into every child it forks, so the host waits on the child; on 10/12 the watchdog's sleep kept it open 5 s per hook
metadata:
  type: feedback
---

Step 6 of the reengineer plan (every verdict logged) made lib.sh hold each
hook's stderr in a file and keep the host's real stderr on fd 8 until exit,
so the verdict row could quote the refusal. bash sets no close-on-exec on
fd 8, so the watchdog subshell forked after it, its `sleep`, and every
`( ... ) &` in a hook inherited the host's pipe. A review on 2026-10-12
measured stderr EOF at 5 s (the hook's timeout) instead of 0, and the new
test file took 27 to 47 s instead of 7. The same review found a `set -e`
hook turning a refusal into exit 137 (wait on the killed watchdog returned
137 inside the EXIT trap), and a gws timeout's str() carrying a mail's
subject and body into the log.

**Why:** a guard that logs must never change what the host sees, and a
held fd changes timing even when every byte arrives.
**How to apply:** take the spare fd only after the hook's own background
forks, close it (`8>&-`) on every later `&` spawn, and time EOF through a
pipe in the test, not just the bytes. For send rows, log the exception type
and a masked recipient, never str(err). tests/test_verdicts.py checks all
three, and it sits beside [[feedback_guard_precise_path_never_judges_less]]
and [[feedback_hooks_run_on_stock_python]].
