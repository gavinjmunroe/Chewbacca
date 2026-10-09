---
name: project_ux_math_layer
description: The math layer in ux-engine, what each tool computes, and the one number that proved it discriminates (rank 2.39 vs 1.01)
metadata:
  type: project
---

2026-09-23. Caleb: "Chewbacca exists outside the ui/ux, it shouldn't be living 1
element at a time?" and "maybe we lowk gotta include some math here?" Both were
right, and they named two different missing senses.

**The diagnosis.** The kit had a rich PER-ELEMENT sense and no whole-image sense
at all. `ux-crawl` measured 260 elements across 1,885 frames and could not tell
that a numeral was sitting on a paragraph, because nothing was wrong with either
element. Taste is almost entirely relationships.

**The tools, all in `ux-engine/bin/`:**

- `ux-eye` renders the page and measures the IMAGE: background purity behind
  every text box, pairwise box collision, edge-energy centroid, squint test.
  Grounded in Treisman (preattentive processing across the whole field in
  <250ms) and Itti-Koch saliency.
- `ux-modes` differentiates the film. Fits `a + b*y` per channel: the b's are the
  rate field, the residual is every non-linear effect. Channels are normalised by
  just-noticeable-difference first, or position in pixels swamps opacity in 0..1.
- `ux-derive` checks whether each value is DERIVABLE from the page's own
  generators (lattice `k*baseline`, scale `base*r^n`). Un-derivable = a vibe.
- `ux-morph` homotopy over a shared point set. Hungarian assignment (discrete
  optimal transport) + orthogonal Procrustes via SVD.
- `ux-place` composition as energy minimisation. See
  [[feedback_optimisation_relocates_taste]] for what it got wrong.
- `design-gate` exits 2. Proven firing.

**The number that proved it discriminates.** Reference page: 186 pinned, 42
parallax at 7 distinct rates, residual effective rank **2.39**. My replica: 0
pinned, 23 parallax at **1** rate, rank **1.01**, and 253 of 253 moving pairs
correlating >0.98. Every element moved identically. That critique is invisible in
source.

**Measured constants worth keeping:** optimal point pairing saves 73-84% of
travel vs pairing by index. A 17,000px page with 774 perceptible channels has
about 2.5 degrees of freedom.

**Two coordinate-frame bugs, both of which INVERTED the result.** Viewport
`top` makes static elements appear to move at scroll rate (rank 1.34, the mode
was scrolling). Document coords left rank 1.08 because a pinned element genuinely
travels with the document. There are TWO nulls, rate 0 and rate 1, and removing
one at a time reports the other as design.

Related: [[project_ux_engine]], [[feedback_the_screenshot_beat_the_code]],
[[project_design_gate_structural_flaw]].

## Told to Karthik, 2026-09-23, and the gap in it

Caleb described the engine to Karthik as understanding "an entire website's
ui/ux at once with all the factors and how they relate," named partial
derivatives as implemented, and said the plan is to "regurgitate that engine
into the rest of how chewbacca operates": understanding a person, a concept,
any software. Karthik: "let's iterate tomorrow," and he wants Caleb to know the
diff eq and neural-mapping math well.

**The gap, if that iteration happens.** Partials exist on ONE axis:
`d(channel)/d(scroll)`, the b coefficients of the `a + b*y` fit in `ux-modes`.
Mouse position, viewport and time are not captured at all. The Jacobian is one
column wide.

**Caleb also said "it's low level enough that there's no need for creativity or
human judgement, so there's no need for me to be in the loop."** The same
session produced four confident wrong answers at exactly that level: effective
rank 1.34 where the dominant mode was scrolling; a 2px baseline at 98%, the
trivial divisor; a 1.077 type ratio fitted through noise; and a composition
solve converging to spacing cv 0.000, a perfect lattice. All four converged
cleanly and reported success, and all four were caught by looking, twice by
Caleb sending a screenshot. See [[feedback_optimisation_relocates_taste]]: the
loop moved into the objective function, it did not close.

**On generalising to people and concepts:** a private note records
that a typed-edge graph over the second brain already died to a shuffled-label
control. The mode math works because a page is a dense numeric signal sampled
along a controlled axis. Carry the control test over with the ambition.
