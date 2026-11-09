---
name: feedback_hidden_pane_stale_scroll_frames
description: Screenshots of a scroll-driven scene in a hidden browser pane can show stale or blank canvas frames because rAF throttles; wait 3s or check state via JS before calling it a bug
metadata:
  type: feedback
---

On 2026-10-31, while checking the FF hero, screenshots taken 1.2s after a scroll often showed the frame from the previous scroll position. Some had a blank canvas, too. The scene's follower and its canvas weather loop both run on requestAnimationFrame, and the pane was throttling rAF. After waiting 3s, the same positions rendered correctly.

**Why:** A stale frame looks just like a real bug, such as "the rock never drew" or "stakes standing on nothing". Chasing it wastes a round of fixes on code that works.

**How to apply:** When you screenshot a scroll scene:
- Wait at least 3s after the scroll.
- Read the scene's own state in JS before trusting the picture, for example a CSS variable like `--hs-n` or `--tw-dusk`.
- Treat a frame that doesn't match the progress you asked for as a timing artifact. Retake it before editing anything.

Related: [[feedback_measure_the_painted_thing]].
