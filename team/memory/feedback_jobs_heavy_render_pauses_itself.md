---
name: feedback_jobs_heavy_render_pauses_itself
description: A multi-worker Remotion render in chewbacca jobs --heavy pushes load past the 35 pause line, gets SIGSTOPped, and Chrome times out; run it with 2 workers
metadata:
  type: feedback
---

On 2026-10-29 the FF hero render failed three times in a row through `chewbacca jobs submit --heavy`, at frames 61 to 64, with Remotion timeouts ("delayRender ... not cleared", "Target closed"). One job's record showed `ran: 53` seconds across 47 minutes of wall clock. The queue SIGSTOPs a heavy job when load passes 35, and 3 or 4 Remotion Chrome workers on a Mac already at load 15 to 20 pushed it over, so the render froze itself until Chrome's own timers gave up. The same render with `--concurrency=2 --timeout=900000` finished in about two minutes.

**Why:** the pause protects Caleb's machine, but a browser-driven job can't survive being frozen mid-frame.

**How to apply:** for any Chrome-driven heavy job (Remotion, Playwright captures), keep workers at 2 so the job stays under the pause line, and give it a long timeout. If it fails, check `ran` in `~/.chewbacca/jobs/<id>/job.json` against wall clock before blaming the code.
