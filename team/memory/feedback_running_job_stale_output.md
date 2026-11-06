---
name: feedback_running_job_stale_output
description: A queue job marked running can be wedged; compare its output file's age before calling its processes ownerless, and give page reads a per-site limit
metadata:
  type: feedback
---

On 2026-11-06 the ledger called 3 Playwright Chromes "no owner". Tracing their parents led to FF speed job 1105-171813-9116, listed as running, with speed.jsonl last written 4 minutes after it started: 20 of 1041 rows in 8 hours. Two renderers each had burned about 2 hours of CPU.

The cause: `page.goto` had a 60s timeout but `page.evaluate` had none, so a site pinning its renderer in a JS loop held a slot forever. The fix wraps each site in `asyncio.wait_for`. The limit has to start after the semaphore is held, or queued rows time out while waiting, and the cancel path has to close the context, since that's what kills the renderer. Test it with a local page running `while(true){}` plus good pages behind it.

**How to apply:** "running" only says the process exists. Before killing or trusting a long job, check when its output file last changed. Any scrape loop needs an overall per-item limit, not just a navigation timeout.
