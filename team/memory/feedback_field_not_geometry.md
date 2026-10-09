---
name: feedback-field-not-geometry
description: "A smooth continuous visual belongs in a shader, not in stacked opaque shapes; ten hours of portal bugs were all the same wrong tool."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 97f1fab6-2b4c-4ae0-bcd5-b8462babccdb
  modified: 2026-09-21T22:14:44.849Z
---

A whole evening of portal bugs on 2026-09-21 were one bug: a smooth,
continuous field being approximated with discrete opaque geometry in Canvas
2D. Caleb reported them as six unrelated visual faults, and each was answered
with more geometry, which created the next one.

| What he said                           | What it actually was             |
| -------------------------------------- | -------------------------------- |
| "it just looks like a pie"             | a radial cut with no falloff     |
| "cloudy, not outline with sparks"      | a cap is a shape, not weather    |
| "the white blobs are back"             | erasing to fake softness         |
| "a bubble forming and then popping"    | a stamp's edge is a skin         |
| "puzzle pieces clicking"               | the stamp ladder's rungs showing |
| "should go into each other seamlessly" | two falloffs, two mechanisms     |

The fixes were stamped ribbons, semicircular end caps, a shape drawn off
canvas so only its blurred shadow landed, and erased blobs at the ends. About
150 lines, all of it approximating a gradient.

He asked the right question himself: **"Is there an easier, better way to
animate this? This seems rlly difficult."** Yes. A fragment shader computes
the field directly, and the whole 150 lines became about 25 of GLSL.

**Why:** seamlessness is not something you arrange between two mechanisms, it
is what multiplying two smooth functions does. A ladder of stamps always has
rungs; a blur is always symmetric so it can never be pushed ahead of a moving
edge; an opaque shape always has an edge that reads as a skin. None of those
are tuning problems and no amount of tuning removes them.

**How to apply:** when a visual is a continuous field (a soft boundary, a
gradient that has to move, two fades meeting), reach for a shader on the first
bug, not the sixth. The test is whether the fix is "add another shape to
approximate the smoothness." If it is, the shape is wrong. Related:
[[feedback_the_screenshot_beat_the_code]], [[project_portal]].

**Three plumbing traps found getting WebGL onto the HUD**, all silent:

- A page loaded with `loadFileURL` taints an `<img>` for WebGL, and `fetch` of
  the same file fails with "TypeError: Load failed". Emit the image as a
  `data:` URL at build time; it is same origin, so it neither taints nor needs
  fetching.
- The upload throwing inside `image.onload` aborted the rest of that handler,
  so even unrelated log lines vanished and it looked like the shader did
  nothing. Never throw out of a capability probe.
- `ctx.drawImage` reads a canvas as **straight** alpha. Handing it a
  premultiplied WebGL canvas darkens in proportion to transparency and draws a
  dirty ring exactly where the edge fades out.

And one that was not WebGL at all: `openGapFrom` was declared and assigned
**nowhere in the file**, sitting at 0 for the life of the process, which made
the completion animation re-anchor to angle zero and appear to reverse
direction. Grep for assignments, not just uses. See
a private note.
