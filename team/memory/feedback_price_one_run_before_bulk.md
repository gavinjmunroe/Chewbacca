---
name: feedback_price_one_run_before_bulk
description: Measure the credit cost of ONE run (balance before/after) before launching any bulk Clay enrichment or Claygent job.
metadata:
  type: feedback
---

2026-10-05 night: I tested the Zeutara Claygent workflow on one firm, checked only that the output was right, then fired it at 548 leads with 20 workers. 150 rows in, Jonah's workspace balance had dropped 10,665 to 7,420: about 21 credits a row, about 57 credits per usable line. The full run would have cost more than the whole balance. Killed it at 150.

**Why:** a Claygent run is many model calls plus web browsing; its price is not on the action and the test run's cost was never read. Client credits are client money.

**How to apply:** for any bulk run, read `clay credits balance` before and after ONE test row, multiply by the row count, and say the number before starting. Stop and report if it exceeds a few hundred credits. Related: a private note, [[feedback_use_the_ui_not_just_cli]].
