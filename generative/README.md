# Generative line art, with measured constants

Researched 2026-09-23. Every algorithm here was implemented in Node, rendered
to PNG, and looked at. Constants that are published but produce mud are marked
as such. Constants with no published value were derived by sweep and are
labelled as findings rather than citations.

Ships as `generative.mjs` rather than as a document, because a parameter set in
prose gets retyped wrong and a parameter set in a module gets imported.

## The quality gate, which is the most useful thing here

**Ink coverage between 3% and 12%. Reject anything over 15%.**

Below 3% the canvas looks unfinished. Above roughly 20% the drawing turns to
mud no matter how good the math is. The researcher's note: a first harmonograph
sweep sat at 20 to 37% coverage and every image was worthless; the final set
sits at 5 to 8%. One rasterise-and-count check would have caught every bad
output in the session.

`ux-ink` implements it.

## The three findings that are ours, not citations

**1. Harmonograph detuning has a quantity, and it is `Δf·T`.** No source states
it. Paul Bourke says only that frequencies "should be different and not integer
multiples"; Wikipedia gives no example values at all. Measured: the precessing
rosette needs the detune to accumulate half a turn to one full turn of phase
drift across the run, so `Δf = driftPi·π/T` with `driftPi` between 0.5 and 2.0.
At 0 the figure is static and inert. Past 4 it is scribble.

Bourke's "not integer multiples" advice is right for a physical harmonograph
and wrong for a legible drawing: non-integer ratios measured at 19.6% ink, which
is over the mud threshold. Use near-integer ratios and detune them slightly.

**2. Samples-per-cycle, not sample count.** A first sweep at 477 cycles and 5
samples per cycle produced an aliased star of straight chords rather than a
curve. Keep samples-per-cycle at 40 or above, cycles between 30 and 60.

**3. Damping is set by where you want it to end.** Pick the final amplitude as
a fraction of the initial, then `d = -ln(decayTo)/T`. Good band is 0.20 to
0.30. A raw damping constant is useless advice because the right value moves
by 10x with the run length.

## Primitive economy, measured

Your stagger is per element, so element count is the hard budget: 300 elements
at 17ms is a 5.1 second draw-on, which is already the ceiling.

| recipe | elements | points |
|---|---|---|
| harmonograph, detuned | **1** | 2200 |
| superformula | **1** | 361 |
| chladni, contours stitched | **15** | 1275 |
| flow field, separation-packed | 46 | 1345 |
| circle moire, as `<circle>` | 52 | **0** |
| truchet 10x10, as SVG arcs | 200 | **0** |
| phyllotaxis, as `<circle>` | 280 | **0** |

Two structural wins worth knowing:

**Stitch marching-squares output.** Raw Chladni contours at n=3 m=5 are 812
separate segments; stitched into polylines they are 8. A hundredfold reduction,
and the draw-on becomes one continuous stroke per contour instead of a hundred
disconnected ticks appearing at random.

**Emit circles and arcs as `<circle>` and `A` commands.** Phyllotaxis,
circle-moire and Truchet all become zero-point primitives.

## What does not work at this budget

**Strange attractors cannot be drawn as line art.** They are density histograms
needing 100,000 scattered points, and consecutive iterates jump across the whole
domain, so connecting them gives noise. Three workarounds were tested; one
survives: fold a family of parallel seed lines through the map exactly once.
Arc length grows about 1.42x per iteration, so by the sixth the curve is
space-filling and renders solid black. Call the result attractor-flavoured,
because it is not an attractor.

**Line-grid moire is partly a rasterisation artifact.** The interference is a
beat against the device pixel grid: it changes on retina versus non-retina,
shifts on browser zoom, and shimmers during scroll. Two offset families of
concentric circles produce true hyperbolic fringes in the geometry itself and
are resolution independent.

## Taste, from Tyler Hobbs

**Randomness entering early versus late is the whole distinction.** Randomness
applied to foundational structure gives genuinely different instances that still
cohere; randomness sprayed across everything gives a screensaver. His method is
randomness filtered through dependency: the random number is an input to a
deterministic rule, never the output. A random number you can see is noise; one
you can only infer is authorship.

**Gaussian, not uniform.** Uniform distributions clump and run far more than
people expect, and `Math.random()` on a parameter is the most reliable way to
make generative work look cheap.

**Tune the floor, not the ceiling.** For work that ships unseen, generate 200
seeds, sort by ink coverage, and look only at the worst 20. Fix the ranges until
those are acceptable, then stop.

**The squint test.** If squinting leaves an even grey field, that is texture and
not composition. Something has to survive the squint: a density gradient, a
void, an axis.

**Collision avoidance is the highest-value single technique.** Fidenza's stated
aesthetic property is non-overlapping curves that run alongside neighbours
without colliding. Enforcing separation cut 90 candidate flow curves to 46 and
the result was immediately more composed.

**The composition trap specific to these algorithms:** harmonograph,
phyllotaxis, superformula and circle-moire are all radially symmetric about the
origin. Four of them in a row read as a set of clip-art medallions however good
each one is. Mix in the translationally structured ones, Chladni, Truchet and
flow fields, and crop off-centre.

## Monochrome, and why it is not a limitation here

A draw-on animation is already the second dimension of interest. Stroke-dashoffset
with staggered entry creates hierarchy, directs the eye and gives the piece a
time axis, which is the work colour would otherwise do. Adding colour means two
systems competing to say what matters. Spend the one variable on opacity or
stroke-width, and derive it from the same function that generated the geometry
so the variation is structural rather than decorative.

## Sourced, and not

Verified against primary sources: the Clifford and de Jong constant sets (all 16
run 60,000 iterations without diverging), the Gielis superformula, Vogel's
phyllotaxis model and the golden angle, Smith's 1987 Truchet variant, the moire
fringe-spacing derivation, and Hobbs' flow-field numbers.

Not verified: **inconvergent.net returned HTTP 403 on both attempts**, so every
claim attributed to Anders Hoff is secondhand from search summaries. His Hyphae
algorithm is a circle-packing structure and would emit as zero-point `<circle>`
elements, which is potentially the best primitive economy available, and it is
worth checking his GitHub directly before implementing.

Also unverified: none of this was rendered by a browser SVG engine or animated
with a real stroke-dashoffset setup. `pathLength="1"` is emitted on every path
so the existing normalisation should hold, but that is untested.
