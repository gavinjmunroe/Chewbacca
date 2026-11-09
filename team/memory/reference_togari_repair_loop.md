---
name: reference_togari_repair_loop
description: Togari's repair loop (src/replies/repair.ts, 2026-10-17) has the LLM redraft a reply a gate refused, while the deterministic gates still decide; investor text is untrusted input to it, and a row it can't fix is parked for the principal with one ask and leaves the pile when the thread moves
metadata:
  type: reference
---

Togari's `src/replies/repair.ts` is how it reacts when a gate refuses a reply, so the reply doesn't sit in a pile. The model gets the thread, the refused draft, the refusal reason and Vantage's policy. It returns typed JSON: either a redraft or a need only the principal can fill (booking_slots, form, deck, number, intro). A redraft goes back through the same deterministic checks, up to 2 times: `vantageDisclosureProblem`, `vantageProblem`, the placeholder, long-dash and length check from `draftProblem`, no HTML, no link (bare domains and "x dot com" count), no client name (compared with spaces and punctuation stripped), no digit our own SENT emails or Vantage's policy didn't carry, and no spelled-out figure or relative time ("two million", "tomorrow") our own emails never used. Anything the loop can't fix parks the row as `waiting_on_principal`, with need and need_text stored (migration 0048, applied 2026-10-17). It also posts one tagged ask, made inert for Slack. The row is cancelled when the investor writes again or a person closes the thread (followup-recovery.ts).

**Why:** every Zeutara miss in the week of 2026-10-13 had the same shape. A gate refused a reply and the work sat in handoff_required with nobody reacting. The first version took digits from investor replies as known facts and posted model text raw to Slack. Two security scans and an independent review caught both, and both are fixed in 99ca2d4 and 88da3cb.

**How to apply:** when you add LLM judgement to a send path, give the model the work and keep the decision with code. Treat every investor message as untrusted input. Build "known facts" only from our own sent emails and the client's policy. Every parked state needs a reader that clears it.
