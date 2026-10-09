---
name: feedback_timeout_is_missing_on_this_mac
description: GNU `timeout` is not installed on this Mac, so any timing wrapped in it returns instantly and reports a fake number
metadata:
  type: feedback
---

`timeout` and `gtimeout` are both absent on this machine (no GNU coreutils).
A command written as `timeout 20 ./thing.sh` does not run `thing.sh` at all. It
fails with "command not found" in about 0.03s, and if the exit status is being
discarded the whole thing looks like a script that ran and was fast.

On 2026-09-21 this produced a wrong conclusion that was reported to Caleb before
it was caught: every SessionStart and UserPromptSubmit hook was timed this way
and declared "innocent, 0.03-0.05s". Measured properly, `brain-check.sh` was
**5.72s** on every session start, the single largest cost in starting a session.

**Why:** a measurement that silently measures nothing is worse than no
measurement, because it closes the question. The conclusion was "the hooks are
not the problem, stop looking," and the actual problem was a hook.

**How to apply:** never wrap a benchmark in `timeout` on this machine. To bound
a command, background it and poll, or use `perl -e 'alarm N; exec @ARGV'`.
Before trusting any timing, confirm the thing under test actually produced its
expected output. A suspiciously round or suspiciously tiny number is the tell.

See [[project_session_startup_profiled_2026_09_21]].
