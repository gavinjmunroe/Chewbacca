<!-- PLAN-GATES
# Machine readable, and the only part of this file a hook reads.
#
# One block per WAVE. A wave is done when its artifacts exist; plan-guard
# finds the first wave whose `requires` are missing and refuses any write
# outside that wave's `allows`. That is what stops the next wave starting
# before the current one has produced evidence.
#
# The artifacts are deliberately cheap to produce and impossible to produce
# by accident: each is a report generated from a measurement, not a file you
# can touch into existence and mean it.
#
# phase  <n>  <name>
# requires    <paths that must exist>
# allows      <path prefixes writable during this wave>

phase 0 Measurement, complete
requires docs/SECTIONS.md docs/DELTAS.md
allows docs/ tools/ tests/ PLAN.md README.md .gitignore

phase 1 Wave 1, structure
requires docs/waves/W1-structure.md
allows docs/ tools/ tests/ index.html src/app.js src/styles.css src/sections/ PLAN.md

phase 2 Wave 2, the design system
requires docs/waves/W2-design-system.md
allows docs/ tools/ tests/ src/styles.css src/fonts/ index.html PLAN.md

phase 3 Wave 3, the pinned panels
requires docs/waves/W3-panels.md
allows docs/ tools/ tests/ src/ index.html PLAN.md

phase 4 Wave 4, the remaining sections
requires docs/waves/W4-sections.md
allows docs/ tools/ tests/ src/ index.html PLAN.md

phase 5 Wave 5, motion
requires docs/waves/W5-motion.md
allows docs/ tools/ tests/ src/ index.html PLAN.md

phase 6 Wave 6, states
requires docs/waves/W6-states.md
allows docs/ tools/ tests/ src/ index.html PLAN.md

phase 7 Wave 7, mobile
requires docs/waves/W7-mobile.md
allows docs/ tools/ tests/ src/ index.html PLAN.md
-->

# Getting to 1:1

Rewritten 2026-09-28 into waves, after an honest score: **39 of 133 measured
axes match, 29%.**

## How to read this

A **wave** is a unit of work that can be started cold, run to completion
without asking anything, and verified by a number rather than an opinion.
Each one carries four things:

    ENTRY       what must already be true
    WORK        the concrete changes, in order
    LOOP        the self-check, and what number it has to reach
    EXIT        the artifact that proves it, which plan-guard requires

At the end of every wave is a **STOP** block: the decisions inside that wave
that are genuinely Caleb's, written as questions with the options already
researched. Those are the only points where work halts. Everything else is
mine to decide and iterate on.

## The rule the whole thing is organised around

Measure, write it down, then build. The first version of this plan opened
with a measurement phase that was never run, seven sections got built from
impressions overnight, and the next day went on discovering that all seven
were wrong. `plan-guard.sh` now refuses a write outside the current wave, so
skipping is no longer a thing that can happen quietly.

## Where it stands, 2026-09-28

    page height        ours 18177    theirs 17852    gap 325px
    sections           ours 10       theirs 11
    axes matching      39 of 133     29%

    hero                          10 / 19    53% matched
    fix where you work / MCP       6 / 19    32%
    trust                          6 / 19    32%
    surface failures               5 / 19    26%
    notifications                  5 / 19    26%
    fits into your stack           4 / 19    21%
    read the spans                 3 / 19    16%

Four of those seven rows are the same pinned element measured at four scroll
positions, so section coverage is narrower than the table suggests. That flaw
is in the Phase 0.2 ledger and Wave 1 fixes the measurement as well as the
page.

---

# WAVE 1. Structure

The page has to hold the right sections in the right order before anything
else is worth doing. Type applied to a section that later gets deleted is
work done twice.

## ENTRY

`docs/SECTIONS.md` and `docs/DELTAS.md` exist. Both do.

## WORK

**1.1 Fold the three duplicate sections into the pinned demo.**

`#run2` is already 3600px, their media column's height to the pixel, and its
`DEMO` array already carries their four titles in order: Traces, Live alerts,
Sift MCP, Metrics. The hard part is built and correct.

`#waterfall` (486px), `#chat-mock` (601px) and `#integrations` (698px) sit
after it as 1785px of standalone sections with no counterpart, covering
ground the pinned demo already covers. Their panel renders are exactly what
the demo's four panels need.

So: move each module's render into the matching `DEMO` slot, then delete the
standalone sections and their mount points.

    DEMO[0] Traces        <- keep, and thicken in Wave 3
    DEMO[1] Live alerts   <- chat-mock's render
    DEMO[2] Sift MCP      <- integrations' render
    DEMO[3] Metrics       <- waterfall's render

**1.2 Give testimonials its heading.** Theirs carries an h2 reading "What
people are saying."; ours renders the carousel with no heading at all, which
is why the section walk could not even see it.

**1.3 Split Subscribe from the briefing.** Theirs is two sections, a 31px
`Subscribe` and a 639px briefing. Ours merges them into one 577px block.

**1.4 Fix the measurement, not just the page.** `measure2.py` reads
`rect.top + scrollY`, which is not a stable page position for a sticky
element, so one pinned h2 cycling four titles reads as four sections. Detect
`position: sticky` on any ancestor and report the pin's own range once.

## LOOP

After each change: re-run `measure2.py` on both, regenerate `DELTAS.md`,
read the section count and page height. Iterate until the numbers below hold.
No screenshots needed in this wave; it is all counts.

## EXIT

`docs/waves/W1-structure.md`, holding:

    section count           ours 11   theirs 11        equal
    sections with no counterpart on either side        0
    the pinned demo's four titles, in their order      verified
    measure2 reports a sticky section once, not 4x     verified
    heading size and alignment on every paired section equal

    Page height was a criterion here and moved to Wave 4. It is the SUM of
    per-section heights, and closing those is what Wave 4 is; holding this
    wave open for it would mean doing Wave 4 inside Wave 1. See
    docs/waves/W1-structure.md for the split.

## STOP. Caleb's call before Wave 2:

1. Folding `chat-mock`, `integrations` and `waterfall` into slots 1, 2 and 3
   is my reading of which panel belongs to which title. Slack panel under
   "Live alerts", MCP config under "Fix it where you work", waterfall chart
   under "Ship with confidence". Is that the pairing you want, or does the
   waterfall belong under Traces?
2. Their Subscribe section is 31px, which is a heading and an input and
   nothing else. Ours has a fuller newsletter block. Shrink ours to match
   theirs, or keep the fuller version and accept the height difference?

---

# WAVE 2. The design system

Global, mechanical, and it touches every section. Doing it before per-section
work means it only gets applied once.

## ENTRY

Wave 1 exit met. Section set is final, so nothing here gets applied to a
block that later disappears.

## WORK

**2.1 The container and grid template**, recovered exactly from their DOM:

    DIV  max-width 1040, centred, padding 0 24        content 992
      DIV  grid, columns 384px + 544px, gap 64        384+64+544 = 992
        DIV  text column, one viewport tall, centred vertically
        DIV  media column, 3600 tall, ONE sticky 900px panel at top:0

Applied to the pinned demo and to every band that uses the two-column shape.
This alone fixes the heading-x drift: theirs is 224 on every feature block,
ours currently runs 296, 136, 296, 136, 136, 447, 280, 280, 296, 280.

**2.2 The type scale.** Measured, and only the h1 and tracking are currently
right:

    h1     40 / 44   tracking -0.01em     already correct
    h2     36 / 43.2 tracking -0.01em     seven of ours already match
    h3     18 / 28   tracking -0.01em     ours is 20 / normal
    lead   18 / 27   on feature blocks    ours runs 15 to 18
    body   15 / 22.5
    label  10, tracking 0.12em
    fig    10, tracking 0.08em

**2.3 The face.** Switch to Figtree, which matches their cap height and
x-height exactly where Inter runs 4% and 9% large. Self-host it rather than
hotlinking, so the page has no third-party font request. See the decisions
block for why their own file is not an option.

**2.4 The lead paragraph rhythm.** Theirs is 18px sitting 8px under the
heading, every time. Ours runs 15 to 18px with gaps from 12 to 106.

**2.5 The colour and spacing ramps.** Sweep every computed colour and every
margin and padding value on both pages, diff the sets, and make ours a subset
of theirs plus whatever is deliberately ours.

## LOOP

A computed-style sweep over every text node on both pages produces a set of
`(size, leading, tracking, weight, colour)` tuples. Diff the sets. Iterate
until ours is a subset of theirs, with every intentional difference listed
by name. Same for the colour and spacing ramps.

## EXIT

`docs/waves/W2-design-system.md`, holding:

    type tuples on ours not present on theirs           0 unexplained
    heading x on every feature block                    224, constant
    lead size / gap on every feature block              18px / 8px
    colours on ours not present on theirs               0 unexplained
    Figtree self-hosted, no third-party font request    verified
    container 1040, grid 384+544 gap 64                 verified

## STOP. Caleb's call before Wave 3:

1. Figtree, or buy a Britti Sans web licence? Figtree is measurably closest
   of the free faces and matches their vertical metrics exactly. A licence is
   legitimate and probably cheap and would be exact. Your money, your call.
2. Their body colour is an `oklab()` with 0.65 alpha rather than a solid.
   Match the alpha exactly, or use a solid that resolves to the same rendered
   colour? Alpha behaves differently over the gradients in Wave 4.

---

# WAVE 3. The pinned panels

The largest single item on the page. Their sticky panel holds 504
descendants; ours hold 15 to 275.

## ENTRY

Wave 2 exit met. The template and type are fixed, so a panel built now sits
in a box that will not move under it.

## WORK

**3.1 Read what their four panels actually contain**, per panel: element
count by tag, the grid or list structure, row counts, what data each row
carries, and the transitions between panels. Read to learn density and
information design; build ours from our own fictional product.

**3.2 Build the four to that density**, in this order, hardest first:

    Traces        a trace table: rows, spans, durations, severities
    Live alerts   a notification panel: channel, message, severity, actions
    Sift MCP      a config and command surface: env block, prompt, response
    Metrics       a chart: series, axes, a threshold line, a legend

**3.3 The panel crossfade.** Their outgoing and incoming panels overlap
rather than cutting. Ours already does this in `scene2`; verify the overlap
band matches theirs by measuring opacity against scroll on both.

**3.4 Invent the data honestly.** Fictional product, fictional customers,
fictional numbers, and nothing that could be read as a real company's real
metrics. No third-party logos.

## LOOP

For each panel: descendant count, bounding box, row count, and a rendered
crop next to theirs at the same scroll position. Iterate until the counts are
within 20% and the crop reads at the same density. `watch-skill loop start`
with pass criteria in plain language for the panel transitions, since a
screenshot cannot show a crossfade.

## EXIT

`docs/waves/W3-panels.md`, holding:

    panel box                     544 x 900, all four
    descendants per panel         within 20% of theirs
    crossfade overlap band        within 10% of theirs
    a crop of each panel beside its counterpart
    zero third-party marks in any panel

## STOP. Caleb's call before Wave 4:

1. The panels need a product with a point of view: what the traces show, what
   the alerts say, what the metrics measure. I can invent it all, but if
   there is a real product you want this to become, now is the moment it gets
   baked in, because the panels are where a landing page actually argues.
2. Their Metrics panel shows a chart with a threshold line. Do you want ours
   to carry a real chart library or hand-drawn SVG? Hand-drawn is lighter and
   matches how the rest of this page is built, and it is more work.

---

# WAVE 4. The remaining sections

Everything below the pinned demo: stack, trust, testimonials, subscribe,
briefing, CTA.

## ENTRY

Wave 3 exit met.

## WORK

**4.1 Per section, close every row in `DELTAS.md`.** Section height, heading
geometry, lead, element counts, controls, largest block. One section per
pass, with the ledger already written so no measurement happens inside a fix.

Order by chunks affected, which is the honest impact measure:

    closing CTA        5 chunks   needs the full purple gradient block
    testimonials       5 chunks   ours renders, position and heading differ
    logo wall          4 chunks   theirs holds pinned across more scroll
    fits into stack    3 chunks
    trust              3 chunks
    subscribe          3 chunks
    briefing           3 chunks

**4.2 The closing CTA gradient.** Theirs sits on a full-width purple gradient
block across chunks 85 to 89. Ours is flat grey. Measure the gradient's
stops, angle and extent rather than eyeballing a purple.

**4.3 The logo wall.** Theirs stays pinned across noticeably more scroll than
ours. Measure the pin range on both.

## LOOP

Regenerate `DELTAS.md` after each section. The section's row count of
non-matching axes has to fall, and no other section's may rise.

## EXIT

`docs/waves/W4-sections.md`, holding:

    per section, axes matching before and after
    total matching across the page                  target 85% of 133
    every remaining difference named and explained

## STOP. Caleb's call before Wave 5:

1. Their testimonials are real people. Ours are invented. Fine as is, or do
   you want real quotes from people who have actually used something you
   built, which would mean asking them?
2. The briefing section implies a newsletter that does not exist. Leave it as
   set dressing, or cut it?

---

# WAVE 5. Motion

Deliberately after geometry. A parallax rate measured against a section whose
height is wrong is a wrong number.

## ENTRY

Wave 4 exit met. Geometry final.

## WORK

**5.1 Complete the motion measurement** that Phase 0.3 deferred. `ux-rate`
across the whole page on both: which elements are pinned, which parallax and
at what rate, which are one-shot reveals. On the reference, 38% of elements
move at a rate strictly between pinned and normal flow.

**5.2 Match the scroll-rate distribution** per section, not per page.

**5.3 Stage sequences** where a scene has them, in the measured order. The
trace wall is already right. The hero exit and the panel crossfade are not
verified.

**5.4 Entrance kinds per section.** Scroll-linked and one-shot are different
things and a downward-only capture cannot tell them apart. Check the reverse
scroll for each.

**5.5 Chained timings, never index staggers.** Their load runs 0.42 + 1.1 =
1.52, each stage starting as the previous ends. An `index * step` delay
cannot express that because it never knows how long anything takes.

**5.6 Reduced motion.** Figures hold at full opacity; only movement goes.

## LOOP

`watch-skill loop start` against the running page with pass criteria in plain
sentences: the hero leaves before the trace wall arrives, no element jumps at
a section boundary, the panel crossfade never shows both panels at full
opacity. A recording catches what a screenshot cannot. Iterate until it
passes, and keep the before/after as proof.

Then `ux-rate` on both and compare the band distribution.

## EXIT

`docs/waves/W5-motion.md`, holding:

    rate distribution per band        within 3 points of theirs
    entrance kind per section         matched, verified on reverse scroll
    stage orders                      matched
    the-loop pass, with the proof clip
    reduced-motion verified

## STOP. Caleb's call before Wave 6:

1. Their page uses Lenis, a smooth-scroll library, so their scroll position
   is a follower rather than the real one. Adopt Lenis for exactness, or keep
   native scroll and accept that the feel differs? This is the one remaining
   dependency question and it changes how the whole page feels.

---

# WAVE 6. States

Everything measured so far is the default state at 1440.

## ENTRY

Wave 5 exit met.

## WORK

**6.1 Sweep every control on both** for hover, focus-visible, active and
disabled. Record which element paints, which property moves, and in which
state, because reading the outer box invents defects that are not there.

**6.2 Empty, loading and error states** wherever a panel implies data.

**6.3 Keyboard.** Focus order, focus-visible on everything interactive, the
carousel reachable and operable.

## LOOP

A state sweep produces a map of state to computed style on both. Diff.
Iterate until ours is a subset with every difference named.

## EXIT

`docs/waves/W6-states.md`, holding:

    state map diffs                   0 unexplained
    every control has a visible focus style
    keyboard path through the page    verified

## STOP. Caleb's call before Wave 7:

1. Nothing expected. If the state sweep turns up an interaction theirs has
   and ours has no equivalent for, that is a question and it gets asked here.

---

# WAVE 7. Mobile

Last, by decision. "Mobile is once the rest is perfect."

## ENTRY

Wave 6 exit met.

## WORK

**7.1 Measure their breakpoints properly.** The plate scale is already
recorded at 1280, 1440, 1600 and 1920. Nothing below 1280 is measured at all.
Do 390, 768 and 1024.

**7.2 Match the layout changes**, not just "make it not break". Their
two-column grid collapses somewhere; find where and to what.

**7.3 The pinned scenes on a short viewport.** 3600px of media column assumes
a 900px viewport. On a phone that arithmetic changes.

## LOOP

Capture both at 390 and 768, chunked as at 1440, and compare. No horizontal
scroll at any width, measured with `scrollWidth` against the viewport rather
than with rects, since a clipped element still reports its full box.

## EXIT

`docs/waves/W7-mobile.md`, holding:

    breakpoints matched                        390, 768, 1024, 1280, 1600
    horizontal overflow at any width           none
    chunk comparison at 390 and 768
    pinned scenes verified on a short viewport

## STOP. Caleb's call before shipping:

1. How far does mobile go: pixel parity with theirs, or simply good and
   unbroken? Theirs may make choices on a phone that do not suit our copy.

---

# The final gate

`design-gate` catches broken, never bad. It passed this page on a turn Caleb
called the result unusable, and its own docstring says so. A green gate means
"not broken" and nothing more.

The real gate is the 90-chunk comparison with a number attached, and the axis
score from `DELTAS.md`.

**Done means:** every chunk pair scores under the threshold or carries a
written reason, `DELTAS.md` has no unexplained rows, nothing of theirs is
vendored, the page carries no third-party mark, and the axis score is above
95%.

**Not done means:** any of those, and it keeps going.

---

# Decisions, 2026-09-28

Answered by Caleb. These close the questions the plan was blocked on.

| # | question | answer |
|---|---|---|
| 1 | adopt their strict section template | **yes**, across all ten sections |
| 2 | trace scene inside the hero as one pinned block | **restructure** ours to match |
| 3 | testimonials h2, and Subscribe split from the briefing | **match both** |
| 4 | what "perfect" means | **literal parity.** Match their geometry including section heights, which means writing our copy to their line counts. "Wtv makes us learn the most" |
| 5 | `failure-wall` and `counter` | his call to me. **Cut both.** They have no counterpart, so keeping them guarantees a permanent gap in every comparison, and `failure-wall` already reads as a duplicate of the trace wall. They stay in git |
| 6 | the four product UI mockups | **invent them** for the fictional product |
| 7 | the headline face | see below, this one has a licensing problem |
| 8 | budget | his call. **Two weeks, done properly** |
| 9 | fan out or solo | his call. **Fan out for the remaining measurement**, which is genuinely independent per section; **build solo**, because building needs one consistent hand and parallel edits to shared files collide |
| 10 | mobile | **after the rest is right**, as its own phase |

## The font, and why I did not do what was asked

Caleb said "download the face from them". Their headline is `brittiSans`,
self-hosted as three `.otf` files under `/_next/static/media/`. It is a
commercial typeface, not a Google font, so copying those files into this repo
is redistributing a licensed font binary. That is the one thing this build has
refused throughout: read their work to learn technique and parameters, write
our own. It is also the only item on the list with a real legal edge rather
than a taste one.

So instead I measured which freely licensable face is actually closest, rather
than assuming Inter. Same string at 40px, advance widths per letter, scaled to
equal total width so the comparison is of SHAPE and not size:

    reference brittiSans      593.0px wide    cap 28.0    x-height 20.08

    font                width   scale   capH     xH   mean err   max err
    Figtree             624.6   0.949   28.0   20.0      0.741     2.357
    Inter               661.1   0.897   29.1   21.8      0.780     2.660
    Hanken Grotesk      612.6   0.968   27.9   19.7      0.884     3.843
    DM Sans             638.0   0.929   28.0   20.2      0.884     4.118
    Manrope             638.5   0.929   28.8   21.6      0.951     3.619
    Plus Jakarta Sans   648.7   0.914   29.8   21.4      1.011     3.320
    Outfit              605.9   0.979   27.8   19.0      1.063     3.951

**Figtree matches their cap height and x-height exactly** (28.0 against 28.0,
20.0 against 20.08) where Inter runs 4% and 9% larger on both. That is why our
type reads heavier than theirs at an identical point size, and it is a bigger
contributor to the difference than the letterforms are.

Switching to Figtree, and noting the two real alternatives if Caleb wants them:
buy a Britti Sans web licence, which is legitimate and probably cheap, or stay
on Inter and accept the ceiling. Either overrules this.


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
