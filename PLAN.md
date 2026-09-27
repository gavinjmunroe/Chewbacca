# Getting to 1:1

Ordered. Each step names what it teaches, how it is verified, and what is
already known so nothing gets re-derived. Verification is a command or a
number, never an opinion, because every wrong turn on this build so far came
from a confident impression.

Rule for the whole list: **read the shipped source before measuring, measure
before editing, look at the render before claiming.** All three were skipped
at least once, and each skip cost a day.

---

## Phase 0. Stop flying blind (half a day)

Nothing below is reliable until these exist. They are unglamorous and they are
why the numbers keep drifting.

### 0.1 Section inventory with scroll offsets

Full-page capture at 1280, 1600 and 390, every section boundary as a scroll
offset, one screenshot each. The page is 17,852px and I have never had a
complete list of what is on it; Caleb's phone screenshots taught more in
thirty seconds than six hours of instruments, because they showed **what
exists** rather than how something behaves.

- Teaches: inventory precedes measurement. An instrument can only refine what
  you already know is there.
- Verify: `docs/SECTIONS.md` lists every section with its y-range, and the
  count matches a manual scroll.

### 0.2 The interaction sweep that was never done

For every component: default, hover, active, focus, disabled, loading, empty,
error, open. At 1280, 768 and 390.

This is the step that would have caught the header bar above every plate,
which is visible in all six reference frames and absent from all six of mine.

- Teaches: a missing state is invisible in a screenshot and obvious in use.
- Verify: `lenses/uselemma-states/` holds one capture per state per component,
  and every one has a matching entry in the spec files from 0.3.

### 0.3 Spec files before any more building

One markdown file per component under `docs/spec/`: exact computed values, DOM
structure, every state, verbatim text, assets, responsive behaviour.

Seven agents were dispatched at this page with no spec contract and produced
nothing usable, because each one went off to measure instead of build. A spec
is what makes a builder a builder.

- Teaches: the source of truth is a written spec, not a measurement in a
  transcript that scrolls away.
- Verify: every `fig` kind and every section in `SECTIONS.md` has a spec file,
  and each spec's numbers are reproducible by re-running its capture command.

### 0.4 Read the two chunks still unopened

`768-*.js` holds the reels and the 220ms transitions. `8331-*.js` holds
`TraceShowcaseVisual`, the isometric scenes, which is the largest thing on the
page and the least understood. Both are on disk in the scratchpad already.

Said twice in two sessions that this was next, done zero times.

- Teaches: grep the bundle for magic constants, never for the API you guessed.
  `setAttribute("cx"` found nothing; `.5888` found the exact file.
- Verify: `docs/spec/trace-showcase.md` and `docs/spec/reels.md` exist and name
  the generator, its parameters, and its timing.

---

## Phase 1. The hero, to exact (one day)

Position, size and node count already match on all six plates: 48, 12, 60,
864, 100, 2842. What is left is everything about how they look and move.

### 1.1 The header bar above every plate

Present on all six reference plates, absent on all six of mine. Measure its
height, offset, border and whether it is a sibling or a pseudo-element.

- Teaches: the state sweep exists to catch exactly this class of miss.
- Verify: element count and computed geometry match the reference's.

### 1.2 Density and weight

Mine render far darker and denser than the reference at identical node counts,
so the difference is stroke width, stroke opacity, or both. The circular
figures are the worst offenders.

Measure their actual `stroke-width` and `stroke-opacity` per figure rather
than tuning by eye, which has already failed twice.

- Teaches: identical element counts with wrong weight read as a completely
  different drawing. Weight is not a finishing touch.
- Verify: `ux-eye` ink coverage per plate within 15% of the reference's.

### 1.3 LEM 2.1 renders as a collapsed sliver

It should be a plane. `isoTiles` is producing a degenerate shape at the
current cols/rows. Find out whether the basis vectors or the `fit()`
normalisation is at fault.

- Teaches: a generator correct in the abstract can still be wrong at the
  parameters you called it with. Render it, do not trust the node count.
- Verify: the plate's bounding box fills its frame the way the reference's does.

### 1.4 The cube's top face

Theirs is a WebGL mesh gradient (`MeshGradient`, uniforms `u_swirl`,
`u_distortion`) masked to the rotating top face, with a `<canvas>` in the
plate. Mine is a flat SVG gradient, which is an honest stand-in and visibly
not the same object.

Decide: implement the shader, or keep the stand-in and write down that it is
one. Do not leave it undeclared.

- Teaches: where an approximation is acceptable, and that the cost of one is
  saying so.
- Verify: either a canvas exists with a running shader, or `docs/spec/cube.md`
  records the substitution and why.

### 1.5 Entrance order and stagger

Caleb: the frame animates top to bottom before the contents start, and
everything is synchronous.

Their chain is arithmetic: draw starts 0.42s, runs 1.1s, next stage at 1.52s,
because 0.42 + 1.1 = 1.52. Find the equivalent relationship for the plate
frame against its contents rather than inventing delays.

- Teaches: chained timing, where each stage starts as the previous ends, reads
  as composed. `index * 100ms` cannot express it because it never knows how
  long anything takes.
- Verify: `getAnimations()` on both pages returns the same count, and the
  delay of each stage equals the sum of the durations preceding it.

### 1.6 The middle column

Sizing and placement are off. Measure their headline size, line height,
max-width in ch, the gap stack down to the buttons, and the button metrics.

- Teaches: a centre column is a measured object, not a vibe. Their whole page
  runs at `font-weight: 400`, so hierarchy is size, colour and opacity only.
- Verify: every value matches, in px, at 1280 and 1600.

---

## Phase 2. Scroll behaviour (one day)

Currently zero of this exists on the replica, which is the single largest gap.

### 2.1 Parallax, which is real and was denied

38.1% of 9,133 measurable elements move at a rate strictly between pinned and
normal flow. Clean bands at rate 0.20-0.25 (564 elements) and 0.85-0.95 (139),
plus 52 moving faster than scroll.

- Teaches: an instrument that samples 26 of 9,133 will hand you a confident
  negative. Check coverage before believing a null result. And measure the
  observable, an element's rect against scroll, never its own `transform`,
  because containers carry the motion.
- Verify: `ux-rate lenses/replica` reports the same band distribution as
  `ux-rate lenses/full`.

### 2.2 The hero depth stack

Seven layers translating fixed distances on exit: 500, 420, 412, 360, 240,
117, 78 px, under one shared opacity ramp from 1.0 to 0.015 over 552px,
identical to three decimals across every layer.

- Teaches: saturation distances are timing-independent and trustworthy;
  instantaneous rates near a scroll jump are contaminated by the smooth-scroll
  lerp and are not.
- Verify: the seven travels and the shared ramp reproduce.

### 2.3 Wipes

`maskRevealDown`, `maskHideUp` and `lemma-vt-bottom-up` are `clip-path: inset()`
animations. 321 elements carry a clip-path. Their page transitions use the
real View Transitions API.

- Teaches: a wipe is a clip animation, not an opacity fade with a gradient.
- Verify: clip-path element count and the inset values at both ends.

### 2.4 Scroll-linked versus one-shot

Every reveal is one or the other, and a downward-only capture cannot tell them
apart. Scroll past each section and back up.

- Teaches: the distinction decides the implementation entirely, and it is
  cheap to test and impossible to infer.
- Verify: each spec file records which, from an observed reverse scroll.

---

## Phase 3. The sections below the hero (two to three days)

None have been touched. In page order, with what is already known.

### 3.1 Logo wall

Label sits in a centre cell of the grid rather than above it. Cells populate
and empty (`lg-cell`, r² 0.23-0.61, so state-swapping rather than tweening).
Use `brand-grab` for geometry. **Do not vendor other companies' marks**; build
the grid and use our own placeholders.

### 3.2 Trace brick wall

Solid bricks land first, become outlined chips with ids, then some flip to a
failure state with a quote. The blobs are a stage, not a bug, which is the
opposite of what was previously written down.

### 3.3 The isometric scenes

The largest and least understood: a ground plane of tiles, a single cube, a
headline with a number animating under blur, and a large extruded form built
from isometric cubes. Source is in `8331-*.js`, unread. The 564 elements at
one-fifth scroll rate live here.

### 3.4 Trace waterfall panel

Spans, nested rows, durations, coloured bars, expandable occurrences.

### 3.5 Slack mock

`slackTyping 1.2s ease-in-out infinite` already found and previously had no
known use. Also `termLineArrive .16s` and `termCursorBlink 1.1s step-end` for
a terminal elsewhere.

### 3.6 Integrations

Logo row plus two code panels with a copy affordance.

### 3.7 Testimonial carousel

Twelve dots, three cards visible, edge cards partially faded. Constrained to a
column, not full-bleed, which the current build gets wrong.

### 3.8 Footer

---

## Phase 4. Gate it so it cannot regress (half a day)

### 4.1 Wire `ux-diff` as a fidelity gate

`design-gate` is now wired and catches broken, never bad. It exited 0 on a
build Caleb called unusable. A fidelity gate reads `.design-gate-ref` for a
reference lens and refuses when a ranked axis regresses.

- Teaches: a gate that passes bad work is not a gate. Per the kit's own rule,
  exit 2 or it is a log line.
- Verify: make it refuse a deliberately worsened build, then pass the restored
  one. A guard that has never refused anything proves nothing.

### 4.2 Hold the numbers

214 animations at load, a 9.9x on-screen text swing, 700ms draw-ons at 15-20ms
stagger. Named as targets weeks ago and never once checked.

---

## Standing constraints

- Read to learn technique and parameters; write our own code. Their CSS, JS,
  fonts and third-party company marks do not go into this repo.
- `.design-gate-url` is committed so the gate can see the page every turn.
- Every constant carries the observation that set it, not the reasoning.
