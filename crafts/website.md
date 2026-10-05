# Website, finished

Learned 2026-09-22 to 2026-10-03 rebuilding uselemma.ai to within pixels, from
their shipped bundle, their live page and our own measurements, and then
holding the replica to it. `web-ux.md` decides what a site should LOOK like
(stance, refusals, removal). This file is what separates a page that looks
right in a screenshot from a site that feels finished in a hand. Every rule
below cost a day to learn. `site-gate` enforces the mechanical half.

## A site is four layers, and a screenshot shows one

1. Layout, meaning positions, sizes and type, the only layer a screenshot judges.
2. Choreography, meaning what happens on load, on scroll and on arrival.
3. Ambience, meaning what moves while nobody touches anything.
4. Response, meaning hover, focus, press, keyboard, and where every control goes.

The replica matched layer 1 for a week and still read as dead, because
layers 2 to 4 were missing. Plan all four before building any of them.

## Choreography: two clocks, never confused

**Timed and scrolled are different kinds of time.** A load entrance runs on a
clock from mount (theirs: 2200ms, plates wiping open top-down over 770ms each,
copy lines rising 12px over 400ms at staggered starts). A scroll scene runs on
one progress value. A sweep that plays once on entering a phase is timed even
though scroll triggers it. Write down which clock each motion runs on before
writing it.

**One progress value, mapped once.** Every scroll-linked layer reads the same
followed progress, computed once per frame. Two independent paths from input
to pixel produced six alignment bugs in one morning.

**Fixed distance per layer, one shared curve, is what reads as depth.** Six
plates leaving at 420, 500, 360, 240, 300 and 200px over the same window with
the same cubic ease-out finish together. Per-layer rates straggle.

**The easing is the feel.** The logo wall's exit used ease-out where theirs
uses a cubic ease-in on all four channels (rise, clip, row offset, fade). The
numbers at rest matched; mid-exit ours was half gone while theirs had barely
started. Check the curve at three points mid-transition, never only the ends.

**Where opacity is applied changes what you see.** Their intro fades the
wrapper AND each plate, so the visible value is the square. A group fade and
a per-element fade with the same number render differently whenever things
overlap.

**Reduced motion lands on the finished state**, never a blank one.

## Ambience: inventory it, do not guess it

A finished page has things moving at rest. The reference had six we lacked: an
orbiting loader in the hiring banner icon, a pulsing scroll cue across the
hero, a logo marquee, a figure in the trust section, a self-advancing
testimonial carousel, and a mesh gradient running at different speeds per use.
None show in a screenshot and none show in a DOM inventory.

**Find them with `site-gate idle`**: settle at each scroll position, list
infinite animations in view, and pixel-diff two frames 1.2s apart, which
catches the rAF and canvas loops the animation list cannot see. Run it on the
reference AND on yours, at the same positions, and compare in kind.

Every ambient loop pauses offscreen and on a hidden tab, banks elapsed time
so returning does not restart it, and holds still under reduced motion.

## Response: every control, three states, a keyboard, a destination

**Hover by actually hovering.** Effects are often group-triggered: hovering a
card moves an arrow or underline elsewhere in it. Reading CSS misses them.

**Every control needs hover, focus-visible and pressed**, each a computed
difference you can measure, plus keyboard reach in a sane order. A carousel
takes arrow keys; a pinned scene must be reachable without a mouse.

**Every control goes somewhere.** `href="#"` is a dead end a visitor finds in
their first ten seconds. Subpages, forms with validation and a success state,
a 404. A site with one page is a screenshot with a scrollbar.

## Copy is yours, and checks must fold the brand

Three feature leads shipped as the reference's sentences with the brand name
swapped, and an exact-match copy check passed them. Compare with brand names
folded to one token and flag any shared run of eight words.

## Measuring a living page

- **Read the source before fitting the output.** A curve fitted to scroll
  samples for days was a percentage of a 1480px box in their component. Two
  hours in the bundle beat the week of fitting. `clone-site` has the method.
- **Launch Chromium with Metal** (`--use-angle=metal --enable-gpu
--ignore-gpu-blocklist`). Heavy WebGL pages drop to 1fps headless with
  SwiftShader and screenshots time out; with Metal the same page ran 50 to
  61fps. A measurement taken at 1fps measures the test rig, not the page.
- **Settled values for scroll-linked things, step responses for feel.** Park,
  settle, read. Then one wheel step with an in-page rAF logger for the curve.
  A probe that costs a second per read on one page and 10ms on the other
  cannot compare timing.
- **Score data rows only.** A table header counted as a miss in every
  section for a week.
- **Your own hide script can fake a regression.** Hiding "banners and cookie
  cards" by class substring hid two figures, and the crop said they had
  vanished. Confirm a surprising frame without the probe.

## Ambition is measured too, because honest and dull still fails

On 2026-10-04 two rebuilt sites passed every check here, carried no false
claim, and Caleb called them "infinitely more ugly and boring" than the
reference. The brief had demanded honesty and restraint and never demanded
spectacle, so the builders produced well-sourced essays. `site-gate story`
measured the difference: the reference is 52% figure with motion on 19 of 19
screens; the essays were 4% and 0% figure, with motion on 8 and 0 screens.
Words per screen did not separate them.

So every site needs a **scroll narrative**: one set of objects that IS the
story and changes state as you scroll (theirs: a wall of runs, nine light up
as failures, the wall breaks into diamonds, they land on a lattice that
becomes the product). Plus parallax depth in the hero, a pinned section, and
a figure on most screens. `site-gate story` exits 1 under 0.35 figure share or
under 60% of screens with scroll-linked motion. A restraint rule never
overrides this; restraint applies to colour and claims, not to the craft.

**Spectacle is held by taste.** Caleb, the same night: "Be tasteful. Lemma had
the most tasteful site ever." What made it tasteful is checkable:
- one visual language, with every figure drawn from the same vocabulary and
  stroke family
- one accent with one meaning, on a calm ground
- motion only where it tells the story, never bouncing
- a lot of space
- no element that looks imported from a tool's default style (a 3Blue1Brown
  black box, stock three.js lighting)

More tools on the page is not more ambition. Pick the one that draws this
story best.

## What Lemma's design system teaches, measured

These come from Wave 2 of the replica (`lemma-replica/docs/waves/W2-design-system.md`),
where matching its design system took the score from 29% to 59%. They
transfer to any site.

- **Choose the face by measurement, not by name.** Figtree matched the
  reference's cap height and x-height exactly. Inter ran 4% and 9% large, and
  that size difference read as "heavier" more than the letterforms did.
  Self-host it. Use two or three faces in strict lanes: one sans for display
  and body, and mono only for small labels.
- **Light type, flat leading.**
  - Headings at weight 400 (bold is the amateur tell), 36/43.2, tracked
    -0.01em.
  - The lead at 18/28, in the same ink at 65% opacity, sitting 8px under the
    heading.
  - Few type tuples, and every one used on purpose.
- **Ink, not black.** A dark indigo ink, a muted version of the same ink, a
  warm off-white ground, and one accent.
- **Containers:**
  - two widths, a narrow 880 and a wide 1280, with padding inside the
    container
  - a 384 + 64 + 544 grid for copy beside a figure
  - one left edge that every heading shares (224 on all four feature blocks)
- **Figures are one family:**
  - hairline strokes (0.12 to 0.25 in a normalised 0 to 100 viewBox)
  - one accent
  - each figure sitting in a padded well inside a 1px frame
- **Repeated sets are neither uniform nor random.** Ten of the twelve on the
  reference were uniform. The other two used a four-value palette in a fixed
  sequence. Read which before you draw.
- **Where a value is applied matters.** Opacity on a group renders
  differently from opacity on its children whenever things overlap.
- **Controls are square-cornered and quiet:** a dark-ink primary, a light grey
  secondary, and hover, focus and pressed each measured. The effects are
  often group-triggered, so hover by hovering.
- **In CSS, last does not mean winning.** Specificity beat source order three
  times in that wave, and once more on 2026-10-04, when it blanked a live
  button.

## A second reference: Gavin Munroe's site

`calebnewtonusc/gavin-munroe`, which Caleb called "insanely creative" on
2026-10-04. Lemma shows restraint. This site shows invention. What carries
over:

- **A story as a journey through places.** Each chapter is a city, joined by
  a flight line drawn on a map, with a stop number and a coordinate readout.
  A narrative with geography beats a list of sections.
- **One bold colour block per chapter**, from a single sunset palette, with a
  dithered or pixel scene inside it. Limiting the palette per scene is what
  keeps a loud page from turning messy.
- **The x-ray.** Drag across a scene to see how it's made: skeletons, paths,
  live readouts. It shows the craft and invites play.
- **Working demos inside the page,** in OS-style windows, plus Cmd-K to jump
  anywhere.
- **`verified` flags on every claim,** with unverified ones hidden in
  production. That puts the honesty rule in code instead of in a review step.
- **`reference/STEAL.md`** records what was borrowed from which site and why,
  so taking inspiration stays deliberate and credited.

**Steal like an artist, and write it down.** Gavin's method, from his
`reference/STEAL.md`:
- Before building, study the practitioners: an Awwwards juror's criteria (art
  direction, directed motion, 60fps) and The Pudding's scrollytelling rules
  (one step, one visible change; reversible; never hijack the scroll).
- Take techniques from the best sites online, and record each one in a
  STEAL.md table: From, What, Why it is ours. Include a "Not stolen, on
  purpose" list.
- Use real data, such as real geography from openly licensed GeoJSON or
  topojson projected with d3-geo, with attribution where the licence asks
  for it.
- Self-host every library at a pinned version with sha256 sums, and never use
  a runtime CDN import.

Go online for all of this. The best reference is rarely on disk already.

**Copy answers the reader; the picture illustrates the answer.** On
2026-10-04 the T Combinator animation landed, and Caleb said the copy "makes
absolutely no sense to a yc company looking at this ... and it makes no
sense to a USC student". The captions had narrated the animation ("Your
neighborhood. 232", "One lit window") when they should have answered the
reader. Before writing a caption:
- Name each reader and the moment they arrive (here, a founder replying
  "more info" to a DM, and a student who heard about the club).
- List the questions they have, in order.
- Assign one question to each beat.

A metaphor stays scenery and never carries meaning on its own. Write the copy
as one document, `docs/COPY-<site>.md`, by one author, and have builders
implement it verbatim.

**No hard cuts between sections.** Caleb, 2026-10-04: "There's no creative
transitions between sections." Both sites had a beautiful pinned story, then
stacked the sections after it like slides. Lemma never cuts: its bricks
become diamonds, the diamonds the lattice, the lattice the mark. Gavin's site
keeps one camera and a flight line from city to city.

Every section hands off to the next through a shared object (a light trail
that becomes a list's spine, a ground grid that flattens into a page, a sun
that becomes a colour band). Each handoff is scroll-driven and reversible,
checked at three points (before, middle, after).

## Done means

`site-gate check <url>` and `site-gate story <url>` exit 0 at 1440 and 390: no console errors, no
horizontal scroll, no dead links, every control changes on hover or focus,
nothing infinite under reduced motion. `site-gate idle` shows the ambient
layer you planned. Every subpage you link exists. Then look at it beside the
thing you are matching or beating, frame by frame, because the pixels outrank
every number above.
