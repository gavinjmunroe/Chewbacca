# Simple motion: focus, flow, motion

Source: jayd3nfx, "Why Simple Edits LOOK So Much BETTER" (YouTube `yUFLi6hSaPE`, 9:36),
sent by Colin Sweeney 2026-10-31, studied 2026-11-03. The creator switched to an
Apple-style minimal edit and found it was easier to make and viewers liked it more.
His rules, with the numbers he actually used. They apply to video, motion graphics,
and web motion alike.

## 1. Focus: one focal point at a time

- When everything moves, everything competes for attention and nothing wins.
- One text animation, one focal point per beat. The viewer's eye should never have to
  choose.
- His finished frames: a white field, one short line of dark sans text centered, at most
  one accent color on the key word or two ("they become **easier** to **understand**").
- More transitions and effects do not mean more engagement. Cut before adding.

Text reveal recipe (After Effects, transferable to CSS/Remotion): a per-character animator
on position (offset ~100), blur (45) and opacity (0), range selector shape Ramp Up, ease
high 50 / ease low 100, offset keyed from fully off to 100 over a few frames, easy ease plus
a soft graph. Each letter slides up, unblurs and fades in, in reading order.

## 2. Flow: transform what's already on screen

- Apple's motion "feels related": a shape becomes a button, a button becomes a card, a card
  becomes an interface. Morph the existing element instead of introducing something new.
- Connected change reads as one idea and is easier to follow than a cut to a new object.
- Shape morph recipe: keyframe size, position and roundness on one rounded rectangle, copy
  the target shape's values onto a later keyframe, delete the helper layer, easy ease, then
  in the speed graph push both influence handles in so it starts and lands softly.

## 3. Motion: things accelerate, overshoot, settle

- "Most beginner animations move. Professional animations feel alive." Real objects never
  start or stop instantly.
- Ease every move. Let an element arrive gently instead of snapping into place.
- Bounce recipe on a parent null: rotate 11 and scale 113 at +2 frames, then -6 and 90 at
  +5 or 6 frames, then 7 and 104, then back to rest; easy ease all keys; add motion blur.
  Decaying amplitude is the point: big, smaller, smaller, still. Smaller numbers for subtle.
- Unlink scale (X and Y) for squash and stretch when it should feel bouncy.

## What it is not

- Not "copy Apple." Understand why it works, then add your own flavor. The principles apply
  to any style.
- Not zero effects. A few, each with a job.

## Checks before calling a piece done

- Pause on any frame: is there exactly one thing the eye goes to?
- Does each new element grow out of the previous one, or appear from nowhere?
- Scrub every move: does anything start or stop at full speed?
- Background white or near-white (or one dark surface), one accent color, one typeface.
