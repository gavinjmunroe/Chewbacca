---
name: feedback_a_silent_guard_proves_nothing
description: A guard that never ran and a guard that found nothing are both silent; on 2026-09-21 two authorship guards had never fired once and nobody could tell.
metadata:
  node_type: memory
  type: feedback
  originSessionId: 6940fed2-fc13-42fa-b382-e83c69742a27
  modified: 2026-09-21T07:26:33.288Z
---

On 2026-09-21 the kit had two guards against one session committing another
session's work: `.githooks/pre-commit` and `.claude/hooks/write-log.sh`, both
written 2026-09-20. Both read `~/.chewbacca/write-log.tsv`.

**That file did not exist.** `~/.claude/hooks/write-log.sh` had never been
installed, and `~/.claude/settings.json` had no entry registering it. So the
hook never ran, the log was never written, and `pre-commit` fell through to its
documented "no write log: stays silent" path on every commit. The guards had
protected nothing, ever, and the repo looked exactly the same as if they were
working.

Then the same mistake was made a third time in one night: a session-aware fix
was added to `stop-check.sh`, tested green in a sandbox, committed, pushed, and
reported as done. It reads the same missing log and could not fire on that
machine either. The sandbox had a log because the test wrote one.

**Why:** a guard that finds nothing and a guard that never ran produce identical
output, which is nothing. Every check in the kit reads as passing. `doctor.sh`
made it worse by checking that hook _files_ exist rather than that they
_produce_ anything, and its list did not include `write-log` at all, so the
green check mark was measuring the wrong thing.

**How to apply:** after writing or fixing any guard, make it refuse something on
purpose before calling it done. Construct the bad input, run the real installed
path rather than a fixture, and watch it fail. If it cannot be made to fire, it
is not installed, and a passing test suite is not evidence. For anything that
writes state, check the state file exists on disk after a real tool call, not
that the script is executable.

Once it was wired up by hand, the guard refused this session's own commit within
the hour.

See a private note,
[[feedback_fix_the_product_not_your_machine]],
[[feedback_enforce_dont_document]],
[[feedback_never_close_without_updating_chewbacca]].

See also a private note: brain-sync committed nothing for days because write-log never saw Bash writes, and it swallowed the brain lint refusal silently.
