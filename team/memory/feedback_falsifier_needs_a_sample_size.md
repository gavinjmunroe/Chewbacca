---
name: feedback_falsifier_needs_a_sample_size
description: A "this would prove me wrong" number has to be big enough to show it; 25 cold emails with no replies proves nothing at a 1% reply rate
metadata:
  type: feedback
---

Before stating what result would settle a call, work out the chance of that result if the plan is fine.

**Why:** On 2026-11-05 an agent told Caleb that no replies from the first 25 emails would mean the FF pitch was off. At a 1% reply rate, 25 emails get zero replies about 78% of the time (0.99^25). The plan's own first_test already said 200 contacts. The agent caught this hours later and corrected it.

**How to apply:** Read the plan's test size first and compute the odds of the bad result under the floor rate. At 10 a day, 200 contacts takes about 4 work weeks, so say that when someone wants an answer sooner. Related: [[project_ff_outbound_state_2026_11_05]].
