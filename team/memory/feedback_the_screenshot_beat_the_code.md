---
name: feedback_the_screenshot_beat_the_code
description: On visual work, one screenshot from Caleb beat an hour of reading my own code; 47 passing tests said nothing about whether it looked right
metadata:
  type: feedback
---

Building the portal on 2026-09-21, I shipped four visual bugs at once: a
squashed ellipse, a flat orange wash over the whole disc, a neon hairline
instead of a band of fire, and sparks pinned to the rim. **All four were
obvious in one screenshot and invisible in the code**, and 47 passing tests
had nothing to say about any of them.

The same night: sparks rendering as fat dots, because `lineCap = "round"`
draws a half-disc at each end, so a 2px stroke 2px long is an exact circle.
Unreadable in source, unmissable in a picture.

**Why:** correctness tests and appearance are different axes. A least-squares
circle fit can be mathematically right and visually absurd, which is exactly
what happened when a small flick fit a circle bigger than the screen. Tests
of correctness never catch a plausibility failure.

**How to apply:** on anything visual, get an image before reasoning about the
code, and ask for one early rather than after the third guess. Then write
tests that assert PLAUSIBILITY, not just correctness: a radius that must fit
the frame, a centre that must stay on screen. Also test with realistic input
noise: the circle detector fired 0 times out of 20 on a jittery circle while
passing every test built from a perfect one.
See a private note and [[project_portal]].
