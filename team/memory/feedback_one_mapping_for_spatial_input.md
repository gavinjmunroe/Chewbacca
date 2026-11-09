---
name: feedback_one_mapping_for_spatial_input
description: Six alignment bugs in one morning, all the same shape: two paths from a landmark to a pixel. Map once at the door and feed the gesture detector the mapped value
metadata:
  type: feedback
---

2026-09-21. The portal's ring and Caleb's fingers came apart **six separate
times** in one morning. Each was diagnosed and fixed on its own, and each
was undone by the next adjustment, because they were one bug:

**Two paths from a landmark to a pixel, with an adjustment applied to one.**

    "not even close to my finger"           physical screen model vs a mirror
    "the circle is much farter than the hand"  centre mapped, radius not
    "impossible to finish" a circle          display compression hit the DETECTOR
    an oval, "way too big"                   x by width, y by height
    "the pinch isn't on the circle"          hand scale moved the drawn point only
    the ring built away from the hand        detector angles in landmark space

He called it: *"figure out the mechanics so adjustments never mess it up
ever again and learn this since we're gonna be doing a lot of cool hud ui ux
and just when we're building anything spatial computing."*

**Why:** while a knob has to be remembered in more than one place, every
future change is a new alignment bug, and care does not prevent it. The
shape is wrong, not the attention.

**How to apply:** one `toScreen` function, called once at the input, and
**the gesture detector is fed its output**, not the raw sensor. Then a new
knob moves the fingers, the gesture and the drawing together because nothing
is left that could disagree.

The proof it is right: corrections delete themselves. The portal carried a
`mirrorAngle` helper and a negated sweep that existed only to undo a mirror
applied elsewhere. Once the detector saw screen space, both were removed.

**The test before shipping anything spatial:** add an imaginary knob, a
zoom or a calibration, and count the places that must change. One is right.
Two means somebody changes one of them.

Full rule at `~/.claude/rules/spatial-one-mapping.md`, which loads on any
hand tracking, gaze or HUD work. See also
[[feedback_the_screenshot_beat_the_code]], since four of the six were
invisible in the code and obvious in one picture.
