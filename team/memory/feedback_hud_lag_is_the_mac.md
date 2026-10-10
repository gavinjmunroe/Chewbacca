---
name: feedback_hud_lag_is_the_mac
description: "HUD is extremely laggy" on 10/10 was the Mac at load 95, not Kyber (1.4% CPU); 14 Claude tabs, 47 Pythons, other tabs' Swift builds and XprotectService starved the voice path
metadata:
  type: feedback
---

On 2026-10-10 at 10:55 Caleb said the HUD was too laggy to talk to. Measured once: load average 95, Kyber itself at 1.4% CPU. The CPU went to 14 Claude tabs (74%, 1.6 GB), 47 Python processes, two other tabs' Swift builds (swift-frontend x3 plus ld), and XprotectService at 86% for 1h46 (macOS scanning freshly built binaries and pulled images). Each of the 13 peekaboo processes was an idle per-tab MCP server, not a hang.

**Why:** the voice path (key, speech, listener, model) needs a few free cores to feel instant; a dozen tabs building and testing at once takes them all, and no tuning inside Kyber fixes that.

**How to apply:** when he says the HUD lags, measure `uptime` and Kyber's own CPU before touching HUD code. If load is high and Kyber is idle, the fix is fewer tabs and fewer parallel builds: stop idle background stacks (`chewbacca chat down` freed the Matrix bridges), pause workers, and consolidate tabs. Related: [[feedback_high_load_reads_as_bugs]], [[feedback_one_job_not_six]], [[feedback_slow_means_broken]].
