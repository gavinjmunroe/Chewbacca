---
name: feedback_outbound_numbers_from_own_list
description: Every number in an outbound sequence comes from that region's own current audit; the SoCal follow-up cited 15 Dallas sites
metadata:
  type: feedback
---

Firm Foundation's step 2 follow-up said "we checked 15 church sites in Dallas-Fort Worth and only 2 had a plan a visit form" in both the DFW and the SoCal sequences. That number came from the early 15-site DFW audit (research/DFW-AUDIT.md). The full audits on 2026-10-11 covered 688 in-band SoCal sites and 609 in DFW, so a SoCal pastor would have read about Dallas, from a sample 40 times too small. Caught on 2026-10-18 before anything went out.

The fix: SoCal now says 100 of 688 had a working plan a visit form, and DFW says 125 of 609, counted from ops/lists/*-2026-10-11.csv (plan_visit_form == "yes").

How to apply: when a region's sequence is written or copied, recount every stat in it from that region's own list and name the CSV column it came from. A number copied from another region's copy is a bug, even when the copy grades well.
