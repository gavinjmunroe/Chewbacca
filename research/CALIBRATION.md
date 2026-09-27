# The gap, measured

Caleb, 2026-09-26: *"I think getting 1 site perfect could help us understand
what the gap between where we're currently at and what a perfect designer
would make is."*

That reframes what a replica is for. The page is not reusable and the
Lemma-specific facts transfer to nothing: their pentagon steps 6.10 degrees,
their dot grid is 40x50 at pitch 2.5. None of that helps anybody build
anything else.

**The distance does transfer.** Every row below is a standing bias of mine,
caught by measuring my default output against a professionally designed page
that had already made the opposite choice. Each was found by measurement, not
by opinion, and each one applies to the next site.

Sources: `ux-recover` against uselemma.ai's served geometry, `ux-diff` across
seven axes, `ux-scan` at 100% coverage, and the reference's own stylesheet.

---

## 1. Density: I build 10 to 40 times too sparse

| figure | reference | my first build |
| --- | --- | --- |
| hourglass plate | 714 paths | 60 |
| dot field | 2,000 circles | ~400 |
| ring | hundreds of bands | 30 |
| main scene | 1,746 paths | 42 rects |

This is the single largest gap and it is not a matter of taste. **Density is
what produces emergence.** At 60 lines an hourglass is a lattice you can
count. At 714 the strokes stop reading as strokes and the bright waist
appears as an interference pattern rather than a drawn highlight. At 30 bands
a ring is a flat donut; at 260 the eye integrates the spacing into a gradient
and it reads as a lit tube.

Nothing about colour, opacity, easing or composition can recover an effect
that only exists above a count threshold. I spent hours adjusting those
things on figures that were an order of magnitude too sparse to ever work.

## 2. I reach for the sophisticated construction when the real one is simpler

Their hourglass is **a pencil of 48 straight lines through a single point**.
Measured waist spread: 0.00. Every ray passes through exactly (50, 50).

I built a twisted ruled hyperboloid. It looks superficially similar and can
never produce that pinch, because its lines never actually meet.

The bias: given a shape, I reconstruct it with the most interesting
mathematics that could produce it, rather than the simplest thing that
produces it exactly. The simple version was also the one with the better
optical behaviour.

## 3. I trust labels over geometry

Their 60 paths carry `class="harmograph-line"`. They are 60 byte-identical
copies of a regular **pentagon**, each rotated 6.10 degrees. Not a
harmonograph. I read the class name, built a harmonograph, and the
coordinates had said otherwise the entire time.

Corollary, learned the hard way: I also handed those features to a semantic
model and asked it to name the construction. It answered "parametric curves"
at 0.99 confidence for a pencil of lines, a pentagon rose AND a tile lattice,
ranking the right answer at 0.00, because the features I passed could not
discriminate. **High confidence on insufficient features carries no
information.** The discriminating tests (do all curves share a point, are all
coordinate sets identical, are the paths closed quads) are exact and belong
in code.

## 4. I mask shapes; they use fields

Their dot plate looks like an arch, so I built an arch with a parabola mask.

There is no mask. It is a complete 40x50 rectangular grid over the entire
viewBox, half-width identical at every row. The radius takes exactly two
values, 0.221 and 0.589, split 1158 to 842. The arch is a **dither**: the
probability of the larger radius rises with depth from 0.025 in the top row
to 0.65 in the bottom.

The shape is made of probability. Adjusting a mask never arrives there.

And the right reconstruction copies the PROCESS, not the sample: per-dot fits
land at R^2 0.117, barely over chance, because each dot is a random draw.
Matching their exact dots would be overfitting to one seed of their RNG.

## 5. I border everything

My first pass at their testimonials and newsletter was bordered cards in a
three-column grid, which is the layout Caleb's own rules ban by name.

They separate by **surface** (white on grey) and by **hairline**, and almost
never by box. Bordering every element is the reflex that makes a page read as
a template rather than an instrument.

## 6. I animate whatever is present; they animate what the generator made

Reference: 214 animations, 4 of them infinite.
Mine, before correction: 1,969 animations, 0 infinite.

Two separate errors. I applied animation to every element that could take it,
including 700 circles in a dense field that the reference fades in as ONE
group. And the loops I did write matched no element, so the ambient layer
that makes their page feel alive while nothing is scrolling simply never ran.

## 7. I invent a coordinate system per figure

Every plate on the reference is `viewBox="0 0 100 100"`. One normalised box,
and the viewBox performs all scaling.

I took normalised generator output and hand-multiplied it per figure by
numbers I invented: `w*0.0082` here, `min(w,h)*0.24` there. That is a second
mapping alongside the one the viewBox already does, and the two disagreed
differently in every figure. Two plates rendered as empty frames from it.

This is `one-mapping-for-spatial-input`, arrived at again from a new
direction: map once, at the door.

## 8. I apply rules outside their domain

I capped a figure's draw stagger at 380ms citing the 400ms ceiling. That rule
governs entrance staggers on a LIST of UI elements arriving. Their sphere
staggers across 1,485ms, and the slow reveal is the effect. Capping it turned
a drawing into a flash.

A rule with a stated domain does not generalise past it just because both
things are called a stagger.

---

## What this predicts about the next site

1. Whatever count feels right, it is probably 10x low.
2. Prefer the simplest construction that produces the effect exactly, then
   check whether the simple one has better optical behaviour. It usually does.
3. Never take a name as evidence. Measure.
4. Reach for a field before a mask.
5. Separate by surface and hairline before reaching for a border.
6. Animate deliberately chosen elements, and give the page one or two things
   that never stop.
7. One coordinate system. Normalise at the boundary and never scale again.
8. Check a rule's stated domain before applying it.
