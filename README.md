# lemma-replica

A from-scratch rebuild of [uselemma.ai](https://www.uselemma.ai/), as a study.

Caleb, 2026-09-23: *"we are going to replicate the lemma ui/ux from scratch as
part of the learning process."*

Not a clone to ship. The point is that copying a measurement is not the same as
understanding a mechanism, and the only way to find out which one you have is
to rebuild the thing without looking at its source.

## What was measured first

Every number here came off their live page with `ux-crawl` and direct runtime
inspection, not from reading their CSS. The two readings disagree, which is the
first lesson: grepping `transition:` in their stylesheet suggested a tidy
two-tier 220/450ms system, and the runtime showed eight durations and three
infinite loops.

| | |
|---|---|
| Page height | 17,852px at 1440 wide |
| Sticky containers | 2, with parents of 10,800px and 3,600px |
| Share of page that is pinned | **81%** |
| Animations at load | 214 |
| Animations under `prefers-reduced-motion` | 4, so 98% suppressed |
| On-screen text elements | swings **14 to 139**, a 9.9x range |
| SVG nodes | 4,102 growing to 7,196, never unmounted |
| Canvas elements | 4, WebGL2, at 4x device pixel ratio |
| Accent | `rgb(117, 92, 254)` |
| Canvas colour | `rgb(242, 242, 242)`, not white |
| Body face | brittiSans, licensed. Labels in IBM Plex Mono |

## The mechanisms, in the order they matter

**1. The page is a scene machine, not a document.** A `sticky top-0 h-screen`
child inside a parent twelve viewports tall. You scroll, the screen holds
still, and the contents swap. That is the whole reason it catches you off
guard, and no amount of reveal-on-scroll gets you there.

**2. Scroll drives state, not transforms.** Their trace grid holds 42 rects
constant the entire way through while the text count goes 33 to 51 and the
filled count goes 0 to 9. Nothing animates. An animation-only capture reports
that scene as static, and it is the best effect on the page.

**3. One CSS animation per SVG primitive.** 48 nodes means 48 animations. That
is where 214-at-load comes from: not canvas, not a library, just a
stroke-dashoffset draw-on per element at 600 to 800ms linear with a 15 to 20ms
stagger.

**4. Hairlines.** `stroke-width` 0.12 to 0.25 on a 100-unit viewBox, `fill:
none`, one colour. This is the single largest reason theirs reads as an
instrument and a first attempt reads as clipart.

**5. The frame is not a card.** No border, no radius, no background, no
shadow, 18px padding. The visible rectangle is drawn inside the SVG in the
accent. Labels are 9px, lowercase, weight 400, 0.32px tracking, in the accent
rather than a muted grey, and they describe what the drawing is doing under a
force: "distortion under load", "state under tilt", "pattern from rotation".

**6. Entrance order follows reading order.** Badge, headline line one, headline
line two, subhead, buttons, then the plots last. What you read first arrives
first and the decoration arrives last. Staggering by DOM position instead is
the common failure and it builds a cascade that fights the reader.

**7. Density is composed.** 124 visible blocks at the top, collapsing to 8,
then rebuilding to 18. A uniformly dense page has no rhythm no matter how good
each section is.

## Running it

Run `python3 -m http.server 4310`, then open http://localhost:4310. No build step: the study is the mechanisms, and
a toolchain between an edit and seeing it is friction against learning.

All glory to God! ✝️❤️


## Reconstruction pass, 2026-09-23

The original geometry generators remain. Plate positions now use viewport-sized
coordinates; a text-sized containing block had moved the whole composition.
The same 42 trace cells persist from the labeled grid into an isometric field.
`tools/build-motion.py` calls the existing `ux-morph.correspond` solver to produce
`src/morph.json`. Total point travel is 12,004.45 versus 19,106.97 under index
pairing (37.2% shorter). The solver minimizes squared travel; the reported sum
is Euclidean travel. Orientation is meaningful here, so no Procrustes rotation
is applied. These are transport measurements, not taste scores.
The cell matrix and center spacing use the same isometric basis; projected
cell axes have equal length and meet at 120 degrees. Browser checks verify
that invariant on all 42 actual SVG transforms.

Text scenes use exclusive visibility. A partition of unity constrained total
opacity but still allowed two headlines to occupy the same pixels. Fading both
to zero instead produced an empty seam. Neither was a collision guarantee.

Remaining fidelity gaps: these are still original study copy and geometry,
not the full Lemma product page. The scene changes are discrete; the point
morph is continuous. The second pinned product narrative is not yet reconstructed.


The lens and harmonograph now animate their existing geometry equations at up
to 24 updates per second. Time drives their cycle; scroll modulates its amplitude.
The animation loop pauses when the hero is off-screen or the document is hidden,
and is not started with reduced motion. All six figures remain in the narrow
layout. The browser regression includes the actual 862×734 preview size.

The final rendered gate still refuses this study: it reports header overlaps
and a sparse isometric interval as dead space. A fresh isolated capture showed
a complete header where the multi-shot capture cropped it. The discrepancy is
unresolved; the gate is not reported as passing. Browser structure checks are
not a substitute for resolving that rendered discrepancy.
