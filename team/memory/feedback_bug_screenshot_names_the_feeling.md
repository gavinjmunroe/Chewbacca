---
name: feedback_bug_screenshot_names_the_feeling
description: "When he files a bug with a screenshot, log the symptom he felt (slow, wrong answer), not whatever the pixels happen to show"
metadata:
  node_type: memory
  type: feedback
  originSessionId: e2e171cb-f149-4f00-ab7e-a8b8c8276cdc
  modified: 2026-10-09T10:12:22.699Z
---

When Caleb reports a bug with a screenshot, the todo names what he felt, not
what the image happens to show. On 2026-10-09 he sent the HUD pill reading
"Working on it 0:22" over the Dock with "Hud is fried save to todo". I logged
a visual overlap bug. The real bug was that a plain "whats up" took 22s+. He
had to correct it: "No the problem is it took forever when I just said whats up".

**Why:** a running timer on a trivial ask is the evidence of slowness. Reading
it as a layout defect filed the wrong bug on the team board (CHW-184, since rewritten).

**How to apply:** before writing the title, ask what he was doing and what went
wrong for him. A timer, spinner or "working" state = latency. If the symptom still
isn't clear from the image, ask in one line before filing. Related:
[[feedback_todos_live_in_chewbacca]], a private note.

Known fact from the same report: the HUD voice path (hud-listen) sends small
talk down a 20s+ path; tracked as CHW-184 on the team board, not fixed yet.
