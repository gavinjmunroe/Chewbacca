---
name: feedback_optimisation_relocates_taste
description: Solving a composition by energy minimisation converged perfectly to a perfect lattice; the solver was right and my objective was wrong
metadata:
  type: feedback
---

2026-09-23, building `ux-place` after Caleb said "every single decision on a site
should be intentional, nothing based on vibes" and "I want every possible thing
in this that can be optimized by math to be optimized by math."

I replaced twelve hand-picked scatter coordinates with an energy function and
basin-hopped L-BFGS. It converged to energy 0.0014, hit the occlusion budget
exactly and the centroid exactly, and produced **nearest-neighbour spacing
cv = 0.000**: every gap identical, a perfect lattice. That is precisely the
catalogue the spacing term was written to prevent, because I wrote the term as
"minimise variance" instead of "target a variation".

**Why:** the solver was correct. The objective was wrong. Optimisation does not
remove the vibes, it RELOCATES them into the energy function. Twelve arbitrary
coordinates became six named weights.

That is still a real gain, and the reason is worth keeping: weights are
explicit, inspectable, and tunable against measurement, and coordinates are none
of those. But it is not the elimination of taste, and saying it was would be the
numerology this whole line of work exists to avoid.

**How to apply:** when math replaces a judgment, say where the judgment WENT.
Then check the objective against a known-good reference rather than trusting
convergence: the target cv of 0.31 came from measuring the reference's scatter,
not from preference. A solver reaching its target proves nothing about whether
the target was right.

Related: a private note, [[feedback_seal_the_test_set]],
[[project_ux_math_layer]].
