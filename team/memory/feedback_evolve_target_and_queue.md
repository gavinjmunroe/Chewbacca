---
name: feedback_evolve_target_and_queue
description: "The self-fix loop (bin/evolve) failed on 10/10 because its target was a question, not a bug; give it a real bug with a judge that fails first. A paused heavy job holds the queue's heavy slot, so kill your own stale ones (2026-10-17)."
metadata:
  type: feedback
---

Learned 2026-10-16/17 rerunning the self-fix loop (`bin/evolve`, ledger task 75663364).

- **The 10/10 "judge failed" was a bad target, not a bad fix or a bad judge.** The target was the `ru` voice shape ("Ru plugged into chewbacca"), a question whose honest answer depends on live state. The proposer correctly declined a canned fast path and wrote an empty diff, and the judge correctly said nothing was fixed (`~/.chewbacca/evolve/b9d9f314`). Before a run, check that the target is a real bug and that the `--expect` judge FAILS on the unchanged commit, still catches the true positives, and passes only on the fix.
- **Budget the proposer.** `claude -p` shares the session's weekly cap (it ran out 10/10 and 10/16). Use one `codex exec` call with stdin closed and no retry. Inputs for the 10/16 rerun: `~/.chewbacca/evolve/inputs/` (target: gtme_lessons' privacy check reads two dates as a phone number).
- **The jobs queue pauses heavy jobs while the Mac is hot, on battery or in use.** A paused heavy job still holds the heavy slot. My own full-suite job sat paused all night and kept the evolve job queued for 13 hours. Kill your own stale heavy jobs (`chewbacca jobs kill <id>`) once you no longer need them.
- **`deliver.Failed` is a SystemExit**, so `except Exception` doesn't catch it. Name it when a batch must survive one refusal.
- **Scope "we're good" to what you mean.** ready-guard refused "Yeah, we're good" about next-move work bc Zeutara was NOT READY. Say "this tab's work is landed", never a bare "we're good".
