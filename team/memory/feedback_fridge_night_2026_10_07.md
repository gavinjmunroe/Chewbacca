---
name: feedback_fridge_night_2026_10_07
description: Ten corrections from the Amber fridge night and where each one is now enforced. Read before any visual build. "I should never have to say this ever again."
metadata:
  type: feedback
---

Caleb, closing the session on 2026-10-07: "Plz learn from your mistakes, I should never have to say this ever again." Every correction from the night of the Amber fridge redraft ([[project_amber_fridge_site]]), and where each now lives so it fires without him:

1. "Nalana" means his Blender fork, never nano banana. Enforced by the `nalana` skill and evals. [[reference_nalana_is_blender]]
2. Handwriting fonts read as AI, jittered fonts read as messy, and Hershey stroke fonts still read as AI. Use learned strokes. Lives in the `handwriting` skill.
3. Text sits on the ruled lines and fits the space (`max_width`). Lives in the handwriting skill.
4. Pen, pencil, Sharpie, crayon and the surface each change the mark. [[feedback_ask_the_material_questions]]
5. Flat one-colour paper is AI. Use scanned paper and 3D geometry, per the surface standard in the handwriting skill.
6. "Not this, not that", phrase-comma-phrase captions and en dashes in chat are slop. Enforced by slop-check rules and tests.
7. Every visible update opens with a prayer, not just the last one. The guard that enforces it is queued as Chewbacca backlog CB-516 (unfinished, stopped when Caleb closed his laptop on 10/7).
8. Independent jobs run in parallel. Enforced by the graph gate re-arming on every big prompt (Chewbacca c3217cb). a private note
9. Different motion on every element is not variety. Each element has to prove a different thing. Lives in the interface skill.
10. Nothing goes in front of him before every state is screenshotted and read. Lives in the interface skill.

**Why:** he repeated several of these within the same hour, and the fix that sticks is a gate or a skill, not a promise. [[feedback_enforce_dont_document]]

**How to apply:** before any visual or generated-asset build, read this list and the handwriting and interface skills. When he corrects something, turn it into a gate or a skill line in the same turn, and tell him where it now lives.

11. (Added 2026-10-07 evening) "It needs to feel like a 3d object floating, not a 2d photoshop overlay", on the flipped business card: a flat square-on white rectangle with no shadow, edge or scene light. A lifted object is rendered in the scene: angled in perspective, real thickness and bow, the room's light and leaf shadows across it, a cast shadow behind it, DOF on the room, true scale. Lives in `docs/FRIDGE-SPEC.md` (the held-frame bar) and in the 3D track's acceptance list.
