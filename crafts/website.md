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

## Done means

`site-gate check <url>` and `site-gate story <url>` exit 0 at 1440 and 390: no console errors, no
horizontal scroll, no dead links, every control changes on hover or focus,
nothing infinite under reduced motion. `site-gate idle` shows the ambient
layer you planned. Every subpage you link exists. Then look at it beside the
thing you are matching or beating, frame by frame, because the pixels outrank
every number above.
