---
name: feedback_morning_done_means_seen_live
description: In a morning check, a UI job is "done" only once it's seen on the live surface; finished jobs plus code on main get called "landed, not seen live" (10/12)
metadata:
  type: feedback
---

On 2026-10-12 at 5:45am the morning check called the HUD agents IDE lane "ALL done". It meant every overnight job had exited and its code was on main. Caleb asked "Ur sure the IDE is done?" and the honest answer was no. Every check had run in headless WebKit because the night's rule was never draw on the live HUD. The attach, drag-in, link and notification bridges had never been pressed. The live bundle was one layer commit behind main, and four known rough spots were still open: the raw JSON Allow card, a blank beat before it, Keep and Reject below the fold, and an 82 s turn.

**Why:** "done" in a status report reads as "go use it". A job's exit code and a commit on main say nothing about the surface he'll actually touch.

**How to apply:** in a morning or status check, give every UI or HUD item one of three words. Landed means the code is on main. Rehearsed means a headless or scratch run passed. Seen live means it worked on his real surface. Say which one, and list what's never been pressed for real. Also compare the live build stamp against main before saying the installed version is current. Same family as [[feedback_prove_it_on_prod]] and [[feedback_a_silent_guard_proves_nothing]].
