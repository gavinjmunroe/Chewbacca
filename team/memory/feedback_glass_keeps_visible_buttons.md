---
name: feedback_glass_keeps_visible_buttons
description: The HUD agents glass keeps visible, labeled buttons to every session, new session and back; subtraction never removes navigation, and Carlton's Realm nav is the baseline (10/12)
metadata:
  type: feedback
---

On 2026-10-12 at 3:38pm Caleb ran the agents IDE on his real glass for the first time, after two nights of headless rehearsals that all passed. It opened full-screen into a dead day-old Gemini session with a giant raw sign-in error, no visible way back (only Escape and a tiny x over his desktop icons), a meaningless red bar, and a see-through panel his desktop folders cut into. He said "Bro wtf is this ux I can't navigate anything???", then at 4:10pm: "study carlton's UX on realm, we need buttons to get through a UX ... the future is intuitive ux!"

**Why:** the glass layer hid Carlton's rail and sidebar with CSS and replaced his screens with a story view that had no buttons. The subtraction pass counted his navigation as clutter. The rehearsals ran on a clean scratch engine with no old sessions and no desktop, so they never met the screen Caleb met.

**How to apply:** every navigation affordance in Carlton's Realm (session list, new session, rail, back, transcript, reply) stays visible and pressable on the glass unless there's a reason Caleb would agree with; the story is a pane inside his frame, never a full-screen replacement. From any state, all sessions, another session and a new session are each one press on a labeled button. The first screen is the tiles, and a stale or failed session never auto-opens. Rehearse against his real session list, at his screen size, with desktop icons present, before calling it ready. Related: [[feedback_morning_done_means_seen_live]], [[feedback_hud_ide_tells_a_story]].
