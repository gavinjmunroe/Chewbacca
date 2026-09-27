<!-- PLAN-GATES
# Machine readable, and the only part of this file a hook reads.
#
# Each phase names the artifacts that must EXIST before the phase counts as
# done, and the path prefixes that may be edited while it is the active phase.
# plan-guard.sh walks these in order, finds the first whose `requires` are not
# all present, and refuses a write outside that phase's `allows`.
#
# This exists because two plans in a row opened with a measurement phase and
# both times the measurement was skipped and the building started anyway.
#
# phase  <n>  <name>
# requires    <space separated paths that must exist>
# allows      <space separated path prefixes writable during this phase>

phase 0 The delta ledger
requires docs/SECTIONS.md docs/DELTAS.md
allows docs/ tools/ tests/ PLAN.md README.md .gitignore

phase 1 Structure
requires docs/STRUCTURE-DONE
allows docs/ tools/ tests/ index.html src/app.js src/styles.css PLAN.md

phase 2 Global tokens
requires docs/TOKENS-DONE
allows docs/ tools/ tests/ src/styles.css PLAN.md

phase 3 Per-section geometry
requires docs/GEOMETRY-DONE
allows docs/ tools/ tests/ src/ index.html PLAN.md

phase 4 The content gap
requires docs/MOCKUPS-DONE
allows docs/ tools/ tests/ src/ index.html PLAN.md

phase 5 Motion
requires docs/MOTION-DONE
allows docs/ tools/ tests/ src/ index.html PLAN.md

phase 6 States and breakpoints
requires docs/STATES-DONE
allows docs/ tools/ tests/ src/ index.html PLAN.md
-->

# Getting to 1:1

Rewritten 2026-09-27, after a day that produced two sections out of twelve.

## Why the last plan failed

The previous version of this file opened with "Phase 0. Stop flying blind" and
listed a full section inventory as the first thing to build. **Phase 0 was
never run.** Seven sections were built overnight from impressions instead, and
the whole of the next day went on measuring them one at a time and discovering
each was wrong: the brick wall was invented, the opacity was on the wrong
element, the plate padding did not exist, the tile field was a sheet instead of
a pentagon, and the animation stages ran in the wrong order.

That is not seven sections built. That is seven sections of rework queued.

**The rule this plan is organised around: measure everything, write it down,
then fix. Never measure-fix-measure-fix section by section.** One section a
morning is the rate that produces, and at twelve sections that is two weeks.

## What is actually done

| | state | evidence |
|---|---|---|
| Brand and third-party marks | done | 0 hits for the reference name in rendered innerText |
| Hero layout and type | parity | every anchor within 1px, six plates within 1px |
| Hero figures | close | all counts, extents, strokes and opacities match; rosette texture and sphere arc count still differ |
| Trace wall grid and states | close | 42 bricks on the measured grid, correct stage order |
| Everything below the trace wall | **untouched** | 10 sections |

## The instruments that exist

```
ux-scan     every element, every scroll position, delta-encoded
ux-rate     scroll rate per element (parallax bands), no sampling
ux-anim     animations, exact via getAnimations() where declared
ux-gap      structural inventory diff
ux-compare  offline side-by-side from a manifest
clone       the one-command sequence
```

**`ux-gap` compares inventories, not geometry.** It reported 27 gaps on a page
where every brick was rendering half its width off-position. It is useful and
it is not a fidelity measure. Do not steer by it alone. That mistake cost most
of a day.

The 90-chunk comparison is the instrument that works. Chunks are anchored to
paired section boundaries, not to page fraction, because the pages are 17,852
and 19,323 tall and a fraction pair drifts onto different content by the footer.

---

# Phase 0. The delta ledger

**Nothing gets fixed in this phase.** The entire output is one file,
`docs/DELTAS.md`, holding every measured difference across all twelve sections
on every axis. Fixing starts only when it is complete.

This is the phase that was skipped last time. It is the whole plan.

## 0.1 Section correspondence, written by hand

Their 11 sections against our 12, paired by position and role. Heading text
cannot do this: our copy is deliberately ours, so text matches on 5 of 11 and
an automatic match pairs the other 6 silently wrong.

Already known:

```
theirs                             ours                        delta
hero + trace scene   y209  10967   hero + trace  y239  10337   -630
Surface failures     y11176  928   Surface fail  y10576 3425   +2497  3.7x
Get notified         y12104  908   Hear about it y15616  601
Fix it where you work y13012 886   Two lines     y16217  949
Ship with confidence y13898  662   Read every span y15046 570
Fits into your stack y14560  697   Fits          y17166  517
Trust                y15257  588   Trust         y17684  482
What people saying   y15845  674   (no h2, unregistered)
Subscribe            y16488  670   Friday brief  y18166  577
Start improving      y17158  694   Start         y18743  580
                                   failure-wall  y14001  781   OURS ONLY
                                   counter       y14782  264   OURS ONLY
```

**Exit gate:** `docs/SECTIONS.md` lists all 11 of theirs and all 12 of ours
with y-range, role, and an explicit pairing, and every pair increases
monotonically on both sides.

## 0.2 Per-section measurement, all twelve, in parallel

For each paired section, on both pages, at 1440:

- heading: size, leading, tracking, weight, alignment, x, width
- body: size, leading, colour, max-width, gap from heading
- container: content width, padding, and the element inset inside each frame
- children: element counts by tag, and their extents
- controls: count, size, hit-target size, hover and focus states
- media: is there a product-UI mockup, and what is in it

These twelve are genuinely independent, so they fan out. Nothing writes to a
shared file until the results merge.

**Exit gate:** `docs/DELTAS.md` has a row per section per axis with both
numbers and the difference, and no cell says "approximately".

## 0.3 Motion measurement, all sections

`ux-rate` across the whole page on both, and `ux-anim` for declared animations.
Record for each section: which elements are pinned, which parallax and at what
rate, which are one-shot reveals, and the stage order where a scene has stages.

**Scroll-linked and one-shot are different things and a downward-only capture
cannot tell them apart.** Record it per section rather than guessing, and check
the reverse scroll.

**Exit gate:** every section in `docs/DELTAS.md` carries a motion row naming
its kind, and the trace wall's stage table is reproduced from measurement.

## 0.4 The palette audit

Today's lesson in miniature: the brick wall was first a uniform lattice, then
overcorrected to a seeded random masonry, and the truth was four widths in a
fixed sequence with alternating row centres. **Uniform and random are both
guesses.**

For every repeated element set on the page, extract the actual distinct values:
widths, heights, gaps, colours, opacities, delays. A set of four values is a
palette. Twenty values is probably random. One value is probably uniform. Read
which it is.

**Exit gate:** every repeated set on the reference has its distinct-value list
recorded, and no generator in our source draws from a range where the reference
uses a palette.

---

# Phase 1. Structure

Everything downstream depends on the page having the right sections in the
right order at the right heights. Doing type or figures first means doing them
twice.

## 1.1 Resolve the two extra sections

`failure-wall` and `counter` exist on ours and not on theirs. `failure-wall`
currently renders a solid purple wall in the middle of their feature sequence
(chunk 62), which reads as a duplicate of the trace wall.

Decision required, and it is Caleb's: cut them, or keep them as deliberate
divergence. **If they stay, they are excluded from the parity score and said so
in writing**, because a clone judged against a page that does not have them
will always show a gap there.

## 1.2 The Surface-failures section is 3.7x too tall

928px on theirs, 3425px on ours. This single section is most of the 1,471px
height difference between the pages.

## 1.3 The four feature sections

Theirs are each roughly 900px with a left-aligned heading, a short paragraph,
and a large product-UI mockup beside them. Ours vary from 517 to 949 and the
headings are centred or `start`.

**Exit gate:** section count matches after the 1.1 decision, every paired
section's height is within 5% of its counterpart, and total page height is
within 2%.

---

# Phase 2. Global tokens

Cheap, mechanical, and they touch every section, so they come before per-section
work or they get applied twice.

Already found and fixed: letter-spacing was -0.02em everywhere against their
uniform -0.01em, and `.hero h1` was lumped with every section h2 at 36px, which
silently beat `--t-hero: 40px`.

Still to audit: h3 and below, body sizes at every breakpoint, the full colour
ramp, border colours, radii, shadow values, and the spacing scale.

**Exit gate:** a computed-style sweep of every text node on both pages produces
the same set of (size, leading, tracking, weight, colour) tuples, and any
deliberate difference is listed.

---

# Phase 3. Per-section geometry

Now, and only now, fix. One section per pass, but with the whole ledger already
written so no measurement happens inside the fix.

Order by chunks affected, which is the honest impact measure:

| section | chunks | note |
|---|---|---|
| the four feature sections | ~19 | largest by far, and mostly missing content |
| extra sections and order | ~8 | blocked on the 1.1 decision |
| closing CTA | 5 | needs the full purple gradient block |
| testimonials | 5 | ours renders, position differs |
| logo wall | 4 | theirs holds pinned across more scroll |
| trust, stack, subscribe | 3 each | |

**Exit gate per section:** its row in `docs/DELTAS.md` is all zeros or all
explained, and the chunk pair renders the same scene at the same scale.

---

# Phase 4. The content gap

This is the biggest single item on the page and it is not styling.

Each of their four feature sections carries a large product-UI mockup: a trace
table with rows and severities, a Slack-style notification panel, a dark code
editor, and a chart. Ours have small panels or empty space. That is about 19 of
90 chunks.

These are original artwork, not copies. Read their structure to learn what
information a panel carries and at what density, then build ours with our own
data, our own copy and our own product's shape. **Nothing of theirs gets
vendored.**

**Exit gate:** every feature section has a mockup at the same visual weight and
information density as its counterpart, built from our own content.

---

# Phase 5. Motion

Deliberately after geometry, because a parallax rate measured against the wrong
section height is a wrong number.

- scroll-rate bands per section, matched to the Phase 0.3 record
- stage sequences where a scene has them, in the measured order
- entrance kinds: one-shot versus scroll-linked, per section
- chained timings, never index staggers. Their load is 0.42 + 1.1 = 1.52, each
  stage starting as the previous ends. An `index * step` delay cannot express
  that because it never knows how long anything takes.
- reduced-motion: figures hold at full opacity, only movement goes

**Exit gate:** `ux-rate` on both pages produces the same distribution across
pinned / slower / normal / faster bands, within 3 points per band.

---

# Phase 6. States and breakpoints

Everything Phase 0 measured was the default state at 1440.

- hover, focus-visible, active, disabled on every control
- the plate geometry scale is already measured at 1280/1440/1600/1920 and
  stored; the rest of the page is not
- 390 and 768 widths
- empty, loading and error states where the mockups imply data

**Exit gate:** a state sweep produces the same set of state-to-style mappings
on both pages, and nothing at 390 scrolls horizontally.

---

# Phase 7. The gate

`design-gate` catches broken, never bad. It passed this page on a turn Caleb
called the result unusable, and its own docstring says so. Treat a green gate
as "not broken" and nothing more.

The real gate is the 90-chunk comparison with a number attached: for each pair,
a perceptual difference score, and a ranked list of the worst remaining chunks.

**Done means:** every chunk pair either scores under the threshold or has a
written reason it does not, `docs/DELTAS.md` has no unexplained rows, nothing
of theirs is vendored in the repo, and the page carries no third-party mark.

---

# The traps that already bit, kept here so they do not again

**The pixels outrank the DOM.** Three probes were wrong in one morning: a
selector that did not count `polygon`, an opacity read off the `<g>` when it
was on the `<svg>`, and "6px too low" when the elements were 6px too short and
top-anchored. Crop the same region from both screenshots and look.

**When two things measure identical and render differently, ask WHERE the value
is applied.** Group opacity composites every child into one layer at full alpha
and then fades the layer; per-element opacity lets crossings accumulate. Same
number, different picture, and no measurement of the effective value can find
it.

**An instrument that samples is an instrument that lies.** "No parallax on this
page" came from 26 elements out of 9,133.

**Measure the observable, not the implementation.** A child parallaxing because
its container moves honestly reports `transform: none`.

**Counts are per element, not per page.** A page-wide path total attributed to
one figure sent a 714-path construction into a frame that holds 48.

**A clipped element still reports its full rect.** Rects say where a thing
would be, never what is painted.

**Mid-morph overlap is not a packing bug.** Measure at the settled state and
confirm the numbers repeat at several scroll positions before believing them.

**Stage order carries the meaning.** Same states, same colours, wrong sequence,
and a wall with nine faults in it reads as a wall that flickered.
