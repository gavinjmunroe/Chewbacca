# Motion, measured at runtime instead of grepped

Measured from uselemma.ai, 2026-09-20, with `ux-viewer motion`, which reads
`document.getAnimations()` in a real browser and captures a frame strip.

## The correction that produced this file

An earlier version of this page claimed Lemma ran a clean two-tier system,
220ms and 450ms, and praised it. That came from grepping `transition:` in the
shipped CSS. **Runtime disagrees.** There are 8 distinct animation durations
and 3 infinite loops.

Both readings were of real things and they are different populations:
CSS `transition` declarations that fire on interaction, and keyframe
animations that run on load. Counting one and reporting it as the system is
how a tidy, wrong story gets written. **Read the runtime.**

## What it actually does

| | |
|---|---|
| Distinct animation durations | **8**: 300, 450, 600, 700, 800, 1000, 1800, 2400ms |
| Infinite loops | **3** |
| Dominant easing | `linear`, 8 of 10, which is correct: it is on the looping plots |
| Expressive curve | `cubic-bezier(0.34, 1.56, 0.64, 1)`, an overshoot, used once |
| Material standard | `cubic-bezier(0, 0, 0.2, 1)`, used once |
| Settles by 4000ms | **No.** 97 to 99% of the frame still changing at every sample |

`linear` on 8 of 10 is not laziness. research/03: use `linear` only for
constant-rate motion. The looping wireframe plots are exactly that, and giving
them an eased curve would make them pulse.

## The thing worth stealing: entrance order follows reading order

The frame strip shows the cascade arriving as badge, headline line one,
headline line two, subhead, buttons, then the plots last. **The element you
read first arrives first, and the decoration arrives last.** Most generated
entrances stagger by DOM position or by grid index, which produces a cascade
that fights the reading order instead of leading it.

## The page never settles, and that is a real trade

Continuous motion means every screenshot of this site is of a different page,
and it means the plots are always pulling at peripheral vision while you read
the headline. Defensible here, because the animated traces ARE the product
being sold. Not defensible on a page whose job is to be read.

## Refuse

- Reporting a motion system from source greps. Run `ux-viewer motion` and read
  what the browser resolved.
- An eased curve on a continuous loop. `linear`, or it pulses.
- Staggering by DOM order when reading order differs.
- 8 duration tiers with no rule for choosing between them. Lemma gets away
  with it; a system that cannot say WHEN each duration applies has 8 accidents
  rather than 8 tiers.

## The defect, measured

**`prefers-reduced-motion: reduce` is not respected.** Re-loaded under the
reduce preference, **4 animations still run**. Continuous small-element motion
is precisely the vestibular case research/03 flags, and this is the one thing
to do better than the reference.

## Benchmarks to compare against

From the HTTP Archive Web Almanac, which parses CSS across millions of crawled
pages (17.2 million sites in the 2025 run). These are the population numbers a
single-site reading should be held against.

| | |
|---|---|
| Transitions that use an easing function | **80%** |
| Mobile pages running non-composited animations | **39%** |
| Desktop pages running non-composited animations | **42%** |
| Transitions vs keyframe animations, at the median | transitions used **6x** more |

Non-composited means animating a property that forces layout or paint instead
of `transform` and `opacity`. Four pages in ten still do it, which is why
"they animate only transform, opacity and SVG coordinates" is a real
compliment and not a given.

Source: [almanac.httparchive.org](https://almanac.httparchive.org/en/2022/css)

## What nobody appears to have built

The Almanac parses CSS statically from a crawl. Products like slicer.dev
extract from one page at load. Chrome's animation panel is manual. Every one
of them reads the ENTRANCE.

Most of an interface's motion is not on load. It is on hover, on press, on
menu open, on validation failure, on route change. Harvesting that means
DRIVING the interface and sampling `document.getAnimations()` at each state,
which is `ux-flow`'s state graph walked with the motion capture attached to
every transition.

`ux-viewer motion` currently has exactly this hole: it watches the entrance
and nothing else. Recorded so the limitation is known rather than discovered.
