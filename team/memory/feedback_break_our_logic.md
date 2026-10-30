---
name: feedback_break_our_logic
description: Before any pitch, call doc or client deliverable is called done, attack it like the other side would; call-doc enforces 3 break lines
metadata:
  type: feedback
---

Before a pitch, call doc or client deliverable is called done, try to break it the way the person across the table would. Check every number against its source, run their money math against our price, check lead times (warmup, approvals, boards), compare what we say their product does with what their own site says, and find who actually decides.

**Why:** On 2026-10-30 the OPTRA call doc read as finished until Caleb said "try to break our logic". One pass found 7 holes. The worst was a 2 to 4K a month retainer pitched to a company whose own plans are $39 to $129 a month, where the benchmark funnel (1 to 2 customers per 1,000 contacts) meant the retainer could never pay back. Others: "run out of money" for an award end date, no warmup lead time, sample emails claiming coverage OPTRA's site never claims. Caleb: "fix chewbs to always find a way to break our logic - it will make us stronger".

**How to apply:** `chewbacca call-doc` refuses a script with fewer than 3 `x <attack> -> <finding>` lines (or `--no-breaks "<why>"`), and renders them as a "What we tried to break" section the caller can use as Q&A prep. For deliverables that aren't call docs, do the same pass and say what broke in the reply. See [[feedback_client_review_is_the_gate]].
