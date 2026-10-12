---
name: feedback_chain_waits_in_the_queue
description: Chained overnight jobs wait with `chewbacca jobs submit --after ID`, never a "wait until" line in a claude -p prompt (10/11)
metadata:
  type: feedback
---

On 2026-10-11 four overnight `claude -p` jobs were each told in their prompt to wait for the job before them. Two put that wait in the background, their turn ended, the session exited, and the queue marked them done having done nothing: the floating audit and the verifier never ran. Caught at 9:54pm only because Caleb said "Don't settle for mediocre tonight" and the job list was read against the plan.

**Why:** a `claude -p` session lives exactly one turn; anything it backgrounds dies with it, and exit 0 reads as success.

**How to apply:** chain with `chewbacca jobs submit --after <id> -- ...` (364a3cfc), which holds the job in the queue until each listed job has ended. Prompts never contain a wait. After queueing a chain, check `chewbacca jobs list` order against the plan before telling Caleb it's set.
