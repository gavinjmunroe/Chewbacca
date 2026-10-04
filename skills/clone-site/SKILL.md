---
name: clone-site
description: "Rebuild an existing website faithfully: a replica, a design study, or a page that has to match a reference. Use when asked to clone, replicate, copy, match or rebuild a site, when a reference URL is given as the target to hit, when the user says make it look like <site>, and when a build is being judged against a live page. Also fires on: clone, replica, reverse engineer, match this site, like their site, fidelity, pixel perfect, same as theirs, why is theirs better."
---

# Clone site

Rebuilding a page faithfully fails in two different ways, and doing one of
them well does not protect you from the other.

**Method A, inspect the surface.** Screenshot it, read `getComputedStyle`,
list the components, build from that. It is what most cloning guides teach and
it is thorough about states, tokens and breakpoints.

**Method B, read what was shipped.** Fetch the payload, parse the chunk
manifest, read the source that generates the thing. It is exact where A is
approximate, and it says nothing at all about hover states or breakpoints.

Doing only A means inventing a mechanism that happens to match the output.
Doing only B means shipping a component whose default state is perfect and
whose hover state does not exist.

Process discipline here is adapted from **JCodesMore/ai-website-cloner-template**
(MIT), which is the best-organised version of A I have read. The bundle work
and the instruments are this kit's. Both halves below are load-bearing.

## The evidence this is written from

A replica of one page, 2026-09-26 to 27, two full days.

Its densest figure was rebuilt as a fitted probability field:
`p(d) = -1.0125 d² + 1.4126 d + 0.0556`. That matched the real density to a
few percent. The figure is **Wolfram Rule 30**, 40 cells, 50 generations, one
seed, wrapping boundaries, and their component is named `CellularAutomataFigure`
in a lazy chunk that shipped the whole time. With the real generator: 842 live
cells and 1158 dead, matching exactly, with no tuned parameter.

Fitting a distribution to a generative figure's output is not recovering it.

The same two days also produced: a claim of "no parallax on the reference" from
an instrument that sampled 26 of 9,133 elements, a component declared dead code
that turned out to be the richest thing on the page, and six plates shipped at
the wrong size because the layout was read off a screenshot. The user's summary
was that four of his screenshots taught more in thirty seconds than six hours
of measurement, because they showed **what exists**. Measurement only ever
refines what you already know is there.

## Order of operations

### 0. Look at the whole thing first, with a human

Before any instrument. Scroll the entire page and capture every section. If the
user is present, ask them to scroll it and send frames; they will catch sections
you did not know existed. An inventory of _what is there_ precedes every
measurement of _how it behaves_, and no amount of the second substitutes for
the first.

Output: a numbered section list with scroll offsets. Nothing else starts until
this exists.

### 1. Take the assets and the payload

```
brand-grab <out> --site <url>      # their fonts, palette, images, photos
curl -sL <url> -o page.html        # the served HTML, which carries a lot
```

Parse the chunk manifest, not just what the HTML references. On the page above,
the HTML referenced 37 chunks and the webpack manifest listed 79; the generators
were in the half nobody had fetched.

```
curl -sL <origin>/_next/static/chunks/webpack-*.js      # or the equivalent
# check for source maps: a 200 on <chunk>.js.map ends the guessing entirely
```

Then grep the bundle for **magic constants**, never for an API you guessed.
`setAttribute("cx"` returns nothing because React does not emit that string.
A literal radius like `.5888` lands in exactly the file that generates it.

**Do not vendor their code, CSS, fonts or third-party logos into the repo.**
Read to learn the technique and the parameters, then write your own. Company
marks in a logo wall belong to those companies, not to the site being copied.

### 2. Sweep the states, not just the default

The step most often skipped, and the one that produces "it looks almost right
but feels cheap". For every component capture: default, hover, active, focus,
disabled, loading, empty, error, and open where it opens. Then desktop, tablet
and phone, and note where the layout actually shifts.

A missed state is invisible in a screenshot and obvious in use.

### 3. Write a spec before building

One file per component: exact computed values, DOM structure, every state,
verbatim text, assets, responsive behaviour. The spec is the source of truth
and the build reads from it.

This is also what makes parallel builders work. Seven agents dispatched at a
page with no spec contract produced nothing usable, because each was measuring
rather than building. Agents given a spec build; agents given a URL wander.

### 4. Build, then diff

```
ux-scan <url> --out lenses/<name>     # every element, every scroll position
ux-rate lenses/<name>                 # what moves against scroll, and at what rate
ux-recover lenses/<name>              # recover generators from served geometry
ux-diff lenses/<ref> lenses/<mine>    # rank the gap by axis
design-gate <url> --shots 8           # refuses a page that is broken
```

`design-gate` catches broken, never bad. It passed the replica above on a turn
the user called the result unusable, and its own docstring says so. Fidelity is
`ux-diff`'s job; treat a green gate as "not broken" and nothing more.

## The traps, each paid for

**An instrument that samples is an instrument that lies.** Check its coverage
before believing a negative result. "No parallax on this page" came from 26
elements out of 9,133; the real figure was 38% of elements moving at a rate
between pinned and normal flow.

**Measure the observable, not the implementation.** That instrument read each
element's own `transform`. The reference animated containers, so a parallaxing
child reported `transform: none`. An element's rect against scroll offset
cannot be fooled by which ancestor or which property carried the motion.

**Counts are per element, not per page.** A path total attributed to one figure
sent a 714-path construction into a frame that holds 48.

**Fixed pixels or percentages is a measurable question.** Measure at three
viewport widths. If sizes hold and only offsets move by half the delta, it is a
capped centred container, and percentage positioning will pull the composition
apart on a wide screen.

**Delays that are not round numbers are usually chained.** A draw starting at
0.42s running 1.1s, with the next stage at 1.52s, is `0.42 + 1.1`. Each stage
begins as the previous ends. An `index * 100ms` stagger cannot express that,
because it never knows how long anything takes.

**Normalise path lengths for a draw-on.** `pathLength="100"` with
`strokeDasharray="100"` makes twelve edges of different screen lengths finish
together. Without it the short ones land first and the object assembles
raggedly.

**A declared transition is not a running one.** 842 circles carried
`transition: cx 220ms` and none of them ever moved on load or on pointer move.
It fires on click, after an entrance completes. Probing found nothing twice;
the source said it outright.

## The traps from the second pass, 2026-09-27

Added after a morning where the page still looked wrong and three DOM
measurements in a row said it did not.

**THE PIXELS OUTRANK THE DOM.** Three probes were wrong in one morning: "the
ring renders 0 paths" (the selector did not count `polygon`), "the ring is
missing its 0.6 opacity" (it was on the `<svg>` and the probe read the `<g>`),
"every plate is 6px too low" (they were 6px too SHORT and top-anchored, so the
bottoms already matched). Each would have become a commit that fixed nothing.
Crop the same region from both screenshots and look. That found in one image
what three probes missed.

**When two things measure identical and render differently, ask WHERE the
value is applied, not what it is.** Sixty rotated pentagons: identical
geometry, identical stroke width, identical effective opacity (0.6 on both
sides, walking the parent chain and multiplying). Theirs crosshatched, ours a
smooth airbrushed donut.

    per element   two crossing strokes at 0.6 give 1-(1-0.6)^2 = 0.84, so
                  crossings are darker and the moire survives
    on the group  all 60 composite into one layer at full alpha FIRST, every
                  crossing saturates, THEN the finished layer fades

No measurement of the effective value can find this, because the effective
value is correct. Filters, transforms, blend modes and masks all compose
differently on a group than on its children.

**Measure the element's inset inside its container.** Their figures sat in a
well: `l19 t24 r19 b19` on some plates, `l1 t6 r1 b1` on others. Ours all
filled the frame. Missing 19px each side of a 202px box draws the contents 19%
too large while every internal measurement stays correct, which is the most
confusing possible combination. It is also not one rule: check every container,
because a page will have two or three classes of them.

**Neither uniform nor random. Go and read the palette.** A wall of 42 bricks
was first a rigid lattice with `i % 4` failures, then, correcting that, a
seeded random masonry with widths drawn from 96..208. Both wrong. Theirs:
seven rows of six, four widths only (154, 182, 197, 221) in a fixed sequence
per row, and row centres alternating between two values 38px apart. The
ragged look came from the alternating centre, not from random widths.
Overcorrecting from uniform to random is still not measuring.

**Stage ORDER carries the meaning, so measure the sequence, not just the
states.** Our failure highlight fired while the wall was still solid and was
gone before the outlines arrived. Theirs: solid wall, wall goes quiet, then
the nine that failed light up against the quiet. Same states, same colours,
and ours read as a wall that flickered rather than a wall with faults in it.

**Pair sections by position, never by heading text.** A clone has its own
copy, so headings match on maybe 5 of 11 sections and an automatic text match
silently pairs the other 6 wrong. Write the pairing by hand, assert it
increases on both sides, interpolate between anchors. Where a paired gap is
wildly unequal (928px on theirs against 3425px on ours) that is not a matching
failure, that is the finding.

**Compare at 90 chunks, not 20.** At one screen per frame a section's
internals never appear next to their counterpart. At 90 the same scene shows
up in several frames at different offsets, which makes a spacing difference
visible rather than inferrable.

**Check brand and third-party marks before anything visual, in the RENDERED
innerText.** A clone will quietly keep the original's real customer names,
real email addresses, real investor badges and real repo paths. Ours shipped
twelve real people's real quotes, a real employee's email and a real investor
logo, all still rendering after a rebrand pass that only touched the source.
Grep the DOM text, case-insensitively, for the original's name.


## The traps from the third pass, 2026-10-03

**Their headless page runs at 1 fps without Metal.** Launch Chromium with
`--use-angle=metal --enable-gpu --ignore-gpu-blocklist`. On SwiftShader the
reference's traces scene timed out a screenshot after 30 s and a crossfade
showed one frame; on Metal it ran 50 to 61 fps and the crossfade measured
484 ms against our 483.

**A fitted curve was a percentage all along.** Six plates had been placed by
a scale curve "interpolated, probably a breakpoint set". Their component put
each one at a percent of a box capped at 1480px wide and one viewport tall.
Every plate was also exactly 96px high. Read the component before fitting.

**The ease is the feel, and the ends hide it.** The logo wall's exit matched
at rest and at the end. Theirs runs every channel on `t*t*t`; ours used an
ease-out on three of four, so mid-exit ours was half gone while theirs had
barely moved. Compare at three points inside every transition.

**Inventory what moves at rest, on both pages.** `site-gate idle <ours> --ref
<theirs>` found six ambient loops the replica lacked, none visible in any
screenshot or DOM count: a banner loader, a scroll cue, a marquee, a trust
figure, an auto-advancing carousel, and a mesh running at a different speed
per use.

**A brand swap is still their copy.** Three leads shipped as their sentences
with the product name replaced, and an exact-match check passed them. Fold
both brand names to one token and flag any shared run of eight words.

**Your own probe can fake a regression.** A script that hid "banner" and
"cookie" elements by class substring also hid two figures, and the crop said
they had vanished. Confirm a surprising frame with the probe removed.

## Done means

Every section from step 0 is built, `site-gate check` exits 0 on every page, and `site-gate idle --ref` shows the same ambient layer as the reference. Every component has a spec and every state
in that spec renders. `ux-diff` has been run against the reference and its
ranked gaps are either closed or written down, `design-gate` exits 0, and
nothing of theirs has been vendored into the repo.

## Credit

Phase structure, the spec-file discipline, the mandatory interaction sweep and
the visual QA diff are adapted from
[JCodesMore/ai-website-cloner-template](https://github.com/JCodesMore/ai-website-cloner-template),
MIT, © 2025 JCodesMore. Its method is Method A done properly and it is worth
reading directly. It does not cover bundle reading, which is the half that
makes generative figures recoverable rather than approximable.
