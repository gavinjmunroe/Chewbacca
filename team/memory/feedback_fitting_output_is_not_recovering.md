---
name: feedback-fitting-output-is-not-recovering
description: "Fitting a distribution to a generative figure's output is not recovering its generator; read the shipped bundle first."
metadata:
  node_type: memory
  type: feedback
  originSessionId: fbc6e4f2-bde8-442d-97fe-35337209f230
  modified: 2026-09-27T07:13:48.076Z
---

Spent a session measuring uselemma.ai's densest plate and fitting a quadratic to its
dot density, `p(d) = -1.0125 d^2 + 1.4126 d + 0.0556`. It matched the density profile
to a few percent, and the mechanism it described was not the one the page uses.

The plate is **Wolfram Rule 30**, 40 cells wide, 50 generations, one live seed at index
20, periodic boundaries. Their component is named `CellularAutomataFigure` and the rule
number is decomposed into its 8 bits, in a lazy webpack chunk that shipped the whole
time. With the real generator: 842 live cells, 1158 dead, matching exactly, zero tuned
parameters. The fitted version hit the same counts by choosing a fill fraction, which is
the identical mistake wearing a different hat.

**Why:** a separable `p(row) * f(col)` cannot express Rule 30's interior, which is
chaotic on one side and periodic on the other. No amount of refitting reaches a structure
the model class cannot represent. Matching an output distribution says nothing about the
process, and the closer the fit the more convincing the wrong answer looks.

Three compounding failures in the same session, all the same shape:

- Declared the hero figure generators "unrecoverable" after fetching 39 chunks. The
  webpack manifest listed 79. An agent parsed it and the generators were sitting there.
- Reported "no parallax on the reference" from `ux-film`, which tracks 26 elements out of
  9,133 and reads only each element's OWN transform. Lemma animates containers, so a
  parallaxing child reports `transform: none`. Caleb: "They use a lot of parallax???"
  Re-measured: 38.1% of elements move at a rate between pinned and normal flow.
- Probed the live page for what drives 842 circles' `cx`/`cy`. Found nothing, twice. The
  source says it is a click handler that only arms after the reveal finishes.

**How to apply:** before building an instrument to observe a web artifact, spend one
minute checking whether the answer is served. `curl` the page, parse the webpack manifest
for every chunk (not just the eager ones referenced in the HTML), check for source maps,
and grep the bundle for the artifact's magic constants: a radius, a duration, a color.
Minified JS keeps literal numbers, so a constant like `.5888` lands in exactly the file
that generates it. Observation is for behavior that only exists at runtime. Everything
else is reading.

Corollary: grep for the constants, not for the API you guessed. `setAttribute("cx"` found
nothing because React does not emit that string.

Related: a private note, a private note,
[[feedback_the_screenshot_beat_the_code]], [[feedback_seal_the_test_set]],
[[project_ux_engine]], a private note
