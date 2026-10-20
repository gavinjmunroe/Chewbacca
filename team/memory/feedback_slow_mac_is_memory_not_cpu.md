---
name: feedback_slow_mac_is_memory_not_cpu
description: A slow Mac with every tab lagging was swap and leaked processes, not CPU; orphan-reap now sweeps every 5 min
type: feedback
---

A slow Mac is usually memory, not CPU. On 2026-10-19 Caleb said all three Claude
tabs were "insanely slow". Load read 110, but live CPU was low. Swap was 87% full
with 34% of memory free.

The leaks, ranked by memory:
- Three Ollama embedding models (about 1.7 GB) held on 2h and 30m keep_alives
  by brain-retrieval and skill-route
- Twelve `kit/bin/web.py` servers from tests/test_chewbacca_daemon.py, orphaned
  for 14 to 16 hours
- An idle agent Chrome, plus chrome-devtools-mcp servers from dead sessions

After cleanup, load fell to 15 and free memory rose to 54%.

Fix, 88aad0e9: the daemon runs `orphan-reap --kill --pressure --min-age 7200`
every 5 min. It reaps test sandbox servers. It unloads Ollama only when swap is
at least 80% AND free memory is at most 40%, since swap alone stays high after
the pressure is gone. Daemon tests now pkill their own sandbox.

How to apply: diagnose with the mac-debug skill's "The Mac is slow" section.
When something leaks past the sweep, add it to orphan-reap with a fixture row,
and don't hand-kill it again.
