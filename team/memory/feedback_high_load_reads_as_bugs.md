---
name: feedback_high_load_reads_as_bugs
description: "At load 40 to 100 from many tabs, hook timeouts and hung tests are the Mac, not the code; run my own checks niced in the background."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 4a9e1a87-8258-4d6e-9ff5-f4bdcc04127b
  modified: 2026-10-09T22:36:15.330Z
---

On 2026-10-09 with 15+ tabs open, load sat between 44 and 110. Doctor reported 12 "failed" hook runs, and every one was a watchdog timeout (brain-recall 3s, skill-route 5s, kit-autopush 30s). A guard test that normally takes seconds ran past 120s in the foreground, one case "hung reading a device", and the old and new hook both failed the same case, so the failure said nothing about the change. Caleb: "Wtf taking so long", then "Bruh" after the tab got force quit mid-run.

**Why:** a timeout under load looks exactly like a bug, and a foreground test that blocks the reply is what he feels as lag.

**How to apply:** check `uptime` before reading timeouts as defects. Test logic directly first (call the function or the extracted detector with no watchdog), then run the touched test file with `nice` in the background or through `chewbacca jobs submit`. Never run a full suite when load is over about 20. Related: [[feedback_one_job_not_six]], [[feedback_slow_means_broken]], [[feedback_fix_the_core_not_a_guard]].
