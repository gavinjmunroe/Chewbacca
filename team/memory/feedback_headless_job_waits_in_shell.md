---
name: feedback_headless_job_waits_in_shell
description: A `claude -p` job told to "wait until job X is done" backgrounded its poll, ended its turn, and the queue marked it done with zero work; put waits in the shell script (2026-10-11)
metadata:
  type: feedback
---

On 2026-10-11 two overnight `claude -p` jobs (the realm night pass, 1011-204051-c75c, and
its verifier, 1011-204321-880e) were each told to wait for an earlier job. Each started its
poll with run_in_background, wrote "I'm polling, I'll start once it's done", and ended its
turn. A headless session ends when its turn ends, so the poll died with it. `chewbacca jobs
list` showed both as done within minutes. Neither wrote its report, and the next job in the
chain (the morning rehearsal) found no realm-morning-verify.md to read.

**Why:** in `claude -p` nothing re-invokes the model when a background task finishes, and
the jobs queue reads exit 0 as done.

**How to apply:**
- Waits between overnight jobs live in the chain's shell script
  (`~/.chewbacca/overnight/chain.sh` polls `chewbacca jobs list` in bash, then runs each
  `claude -p` step). The prompt says the earlier jobs are already finished.
- A headless prompt that must wait anyway says "poll in the foreground, never in the
  background: this session ends when your turn ends".
- "done" in the jobs list is not evidence. Check the report file the job was meant to write
  before trusting it; a missing report means the job didn't run.
- Related: [[feedback_workers_never_wait_on_tail]], [[feedback_built_but_never_fires]].
