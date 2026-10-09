# Lemma scroll handoffs: direct browser study

Live source: https://www.uselemma.ai/. Inspected at 1280 × 720 with the hiring banner present. This supplements the earlier endpoint captures, which were insufficient to characterize the transitions. No replica changes are claimed from this study.

## Observed sequence

1. Failure cards retain their staggered rows while selected cells expand horizontally to expose red failure descriptions. The headline remains above the field.
2. On leaving the failure explanation, the heading clears, cell labels and red fill disappear, and the outlines remain. Cards narrow toward squares before rotating into diamond-like tiles. The rectangular array then changes into a scattered projected field. A fine lattice grows visible underneath. The reverse pass showed these stages in reverse, including the recovery of labels and red failure states.
3. A wave of outlined, stacked cubes crosses the projected lattice while a trace counter changes above it. Later observations show the broad wave gone and a small remaining cube at the right. These are observations during scrolling, not proof that every component is driven exclusively by scroll. The counter and cube timing need held-scroll measurements before classifying their drivers.
4. The search headline wipes away horizontally while the plane persists. “With Lemma, you don't” takes its place. Purple tile/cube structures assemble into the Lemma mark in stages: sparse pieces, rising segmented runs, then the resolved shape. The lattice remains a common ground throughout.
5. The completed mark and plane move upward out of the viewport, with the first product demonstration entering below. This handoff is ordinary spatial continuity after the longer pinned transformation.
6. In the product sequence, left-hand descriptions scroll past while a consistently positioned right-hand demo presents traces, Slack alerts, a coding agent, and issue/metrics states. Intermediate captures show overlapping outgoing/incoming demo content. Internal typing/loading/progress states occur too; do not assume they are all scroll-scrubbed.
7. After metrics, the demo leaves above the integrations heading. Integration setup panels then lead into security with normal document scrolling and section rules. The observed lower boundaries do not establish another geometric morph.

## What the previous replica missed

- It treated card-to-plane as one interpolation. Lemma makes loss of detail, shrinking, tilting, redistribution, and lattice reveal legible as stages.
- It dropped the shared visual world at scene boundaries. Lemma carries the ground plane across the search explanation and the mark assembly.
- It used exclusive text windows to solve overlap. The reference coordinates text departure and arrival with continuing geometry.
- Its bottom sections contain generic facts/cards. The reference changes what happens inside a continuing demonstration area while moving the explanation alongside it.

## Implementation implications, not claims about source code

Use explicit overlapping progress intervals for detail removal, width change, orientation, position, ground reveal, and extrusion. Keep cell identity where the story requires correspondence. Reuse ux-morph only for unknown assignment and the existing projection math for a coherent plane. Do not drive every property with one common easing curve. Text masking must be evaluated with the geometry at intermediate positions and in reverse.

The next implementation should include intermediate target states and complete beginning-to-end narrative behavior before another round of cosmetic endpoint polish. Validate slow forward scroll, reverse scroll, and held-scroll behavior separately. Rank and travel distance do not tell us whether this sequence communicates the story.

## Limits

This pass inspected 30 forward screenshots from the trace transition through security and 8 reverse screenshots through the tile/card morph, plus an initial and return view. A subsequent nine-step finer pass timed out and is not counted as evidence. Screenshot reads and scroll-position reads were not atomic; smooth scrolling can continue between them, so exact pixel boundaries are deliberately not asserted. These are sampled rendered observations, not a frame-complete recording, source-code audit, or timing fit. Hero-to-logo-grid transitions were examined in the earlier pass; footer/testimonials were not revisited here.
