---
name: feedback_vantage_refuses_founder_next_to_call
description: Vantage refuses any reply that puts "founder" next to a call or meeting word, and Togari's own out-of-office follow-up did exactly that, so every one parked as handoff_required and nobody followed up (Zeutara, fixed in Togari 48fe0e2, 2026-10-17)
metadata:
  type: feedback
---

Vantage's sending rules (Togari `src/replies/vantage.ts`, `vantageProblem`) refuse a draft that uses a meeting word (call, meet, chat, book, schedule) together with "founder", "CEO" or "client's team", because Vantage's times belong to the reply owner. They also refuse a day or date Vantage didn't offer, and any link to a deck. Togari's out-of-office return note (`followupBody` in autopilot.ts) ended "Open to a short call with the founder?", so Vantage refused every one. Each became a handoff_required row, and on 2026-10-17 Caleb asked "why aren't we replying to ppl? I thought we tried to fix this 10 times". James Madden at Carrick had been back from vacation since 10-16 with no follow-up.

**How to apply:** any text Togari drafts on its own has a test that runs it through `vantageProblem` with the observed context (`src/replies/__tests__/vantage.test.ts`, "passes the follow-up Togari drafts itself"). When a reply is stuck at handoff_required, dry-run the draft through Vantage first (zrec-ops/nudge.ts, without --apply). The refusal reason usually says exactly which word to drop. A Vantage record that throws "unsupported material, meeting-owner or verdict semantics" has to be fixed in Vantage itself, as Joe Akpan's (Nok) was blocked on 10-17.
