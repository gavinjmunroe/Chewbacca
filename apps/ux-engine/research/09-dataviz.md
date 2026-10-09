# Data visualization and dashboards

Researched 2026-09-20. **18 papers downloaded, 15 parsed to full text and read
as primary sources**, not summaries. `papers/fetch.sh` reproduces them; the
extracted texts are gitignored because they are copyrighted.

**Three widely-repeated things turned out to be wrong.** They are marked below.

## 1. Cleveland and McGill 1984, and what everyone gets wrong about it

*JASA* 79(387), pp. 531-554. The ranking, verbatim from the paper:

1. **Position along a common scale**
2. **Positions along nonaligned scales**
3. **Length, direction, angle**
4. **Area**
5. **Volume, curvature**
6. **Shading, colour saturation**

**Ten tasks, six ranks.** Items 3, 5 and 6 are explicit ties. Anyone quoting
this as a flat list of ten is misquoting it.

### WRONG THING #1: only three of these were actually tested

**Only position, length and angle were run in the experiments.** Area, volume,
curvature, shading and saturation were placed **by prior psychophysics and
theory**, not by these experiments. This is the most-ignored fact about the
most-cited paper in the field.

The studies: 51 analyzed subjects each. 2,550 judgments in the position-length
experiment. Error measured as `log2(|judged - true| + 1/8)`, summarized with
midmeans.

| Result | Number |
|---|---|
| Worst length vs best position | **1.32 log units = 2.5x** |
| Best length vs worst position | 0.51 log units = 1.4x |
| The paper's own summary | *"average errors for length judgments are 40%-250% larger than those for position"* |
| **Angle vs position** | **0.97 log units = 1.96x**, significant |
| Large errors, position-length | 78% were length judgments, though length was 2 of 5 types |
| Large errors, position-angle | 88% were angle judgments, though angle was half |

**The bar-beats-pie tradition rests on a factor of 2, from 51 people, in 1984.**

## 2. Heer and Bostock 2010, the replication

*CHI 2010*, N = 50 per chart, 3,481 responses, same error measure deliberately.

**What held:** *"the rough shape and ranking of judgment types by accuracy
(T1-5) are preserved."* Position beat length significantly. The core result
survived 26 years and a move from a lab to the open web.

**What changed:**

- **Theory failed on angle.** *"Theory also suggests that angle should perform
  worse than length, but the results do not support this."*
- **Rectangular area accuracy matches circular area.** A treemap is not
  perceptually better than a bubble chart.
- **Squares performed WORST** among aspect ratios (p < 0.05), inverting the
  expectation. Proposed mechanism: viewers compare side lengths as a proxy for
  area, which maximizes error exactly when shapes are square. So viewers
  *benefit* from a squarified treemap algorithm failing to hit 1:1.

**Two numbers worth hard-coding:**

- **Gridline alpha 0.2** is a safe default, corroborated.
- **Charts under 40px tall produce significantly more error (p < 0.001).
  Accuracy plateaus around 80px**, which roughly coincides with pixel and data
  resolution matching. And **separate gridlines by at least 8 pixels.**

A practical note for anyone crowdsourcing: a pilot without a qualification
test produced **over 10% unusable responses**.

## 3. WRONG THING #2: angle is the worst cue in a pie chart, not the operative one

Skau and Kosara, *EuroVis 2016*. 92 analyzed participants,
F(5, 4650) = 121.955, p < 0.001.

| Variant | Mean log error |
|---|---|
| **Donut** | **1.000** |
| **Pie** | **1.032** |
| Arc length only | 1.294 |
| Area only | 1.306 |
| **Angle only (pie)** | **1.967** |
| **Angle only (donut)** | **2.279** |

**A donut, which has no centre angle at all, is at least as accurate as a
pie.** Arc length is doing the work. A 20% inner radius (1.162) beat a solid
pie (1.327).

**The standard anti-pie argument is "pies use angle, angle is rank 4." The
premise is false.** The real ranking for a pie is closer to arc length, which
ties with length at rank 3.

Pies are fine for: part-to-whole that genuinely sums to 100%, five or fewer
slices (**convention, not a measured threshold**), and reading one slice
against the whole. They still fail for ranking similar slices, comparing
across multiple pies, and anything 3D.

## 4. Truncated y-axis: the fixes do not work

Correll, Bertini and Franconeri, *CHI 2020*. Three experiments, 40 / 32 / 25
participants.

1. **Truncation inflates perceived severity.** F(2, 76) = 89, p < 0.0001.
2. **It happens in line charts too.** No robust difference between chart types.
   **This kills the rule "bars must start at zero, lines need not."**
3. **Broken axes and gradient fills do not fix it.** No significant difference
   between the three designs. **Signalling the truncation does not de-bias the
   reader.**
4. **Forcing people to read the numbers does not fix it either.**
   F(1, 20) = 11, p = 0.003.
5. **The bias is not a misreading.** Trend estimation error did not vary
   (p = 0.96). It is visual magnification, not a numeric mistake.

The authors *"reject the unequivocal dichotomy of 'honest' and 'dishonest'
charts"* and *"resist the interpretation that all charts with quantitative
axes should include 0."*

**The rule that follows: the y-axis range is a claim about what magnitude of
change matters. Make it on purpose and defend it. "I started at zero" is not a
defense and neither is a broken-axis glyph.**

## 5. WRONG THING #3: decluttering does not improve memory. Annotating does.

Ajani et al., *IEEE TVCG* 28(10), 2021. Cluttered → decluttered → decluttered
plus focused (headline stating the pattern, one subset highlighted, written
annotation). 24 participants, Latin square, 10-second exposure then redraw
from memory.

| Outcome | Result |
|---|---|
| Memory for the relevant pattern | effect of design, η²p = 0.15, **p < 0.001** |
| Focused vs cluttered | Est = 0.75, **p < 0.001** |
| Focused vs decluttered | Est = 0.62, **p = 0.007** |
| **Decluttering vs cluttering, on memory** | **no significant difference, p = 0.81** |

Decluttering bought higher **professionalism** ratings. Focus bought
**aesthetics, clarity and actual recall.**

**Removing gridlines makes a chart look more professional and no more
memorable. A headline plus a highlight plus one sentence is what moves recall.
This contradicts the order most people work in.**

### The chartjunk counterexample

Bateman et al., *CHI 2010*: Holmes-style embellished charts versus plain ones.
**No difference in interpretation accuracy**, and **recall after two to three
weeks was significantly better for the embellished charts.**

This does not license chartjunk. It does mean **"maximize the data-ink ratio"
is an unvalidated aesthetic preference past a certain point**, and that
memorability and accuracy are separate axes that can move in opposite
directions.

### Direct labeling

**Label the series at the end of the line, in the series colour, and delete
the legend.** A legend forces a mark-to-key-to-mark round trip per series. It
is also the single strongest colourblind accommodation, because it removes the
colour-matching step rather than mitigating it. Specific lookup-cost timings
are **[UNVERIFIED]**.

## 6. Chart selection as a procedure

Munzner's **what / why / how**: data abstraction, then task abstraction as
**{action, target}** pairs, then idiom. The nested model is domain → data →
task → idiom → algorithm, and **errors at an outer level cannot be fixed at an
inner one.**

Magnitude channels, best to worst: **position on common scale, position on
unaligned scale, length, tilt/angle, area, depth, colour luminance, colour
saturation, curvature, volume.**

Identity channels: **spatial region, colour hue, motion, shape.**

### The procedure

1. Write the question as an {action, target} sentence. If you cannot, you do
   not have a chart brief yet.
2. Pick the FT Visual Vocabulary category: deviation, correlation, ranking,
   distribution, change over time, part-to-whole, magnitude, spatial, flow.
3. Within it, pick the mark that puts the quantity you most need read
   accurately on the **highest-ranked channel available**.
4. Check it against the failure list above.

**Selected rows:**

| Question | Use | Note |
|---|---|---|
| How big is each? | horizontal bar, **sorted by value** | sort unless the category has inherent order |
| How does it change? | line | position and slope, both cheap |
| Many series over time | **small multiples, shared scales** | beyond ~5 lines |
| Two variables related | scatterplot | rank 1 on both axes |
| Share of total | 100% stacked bar, or pie under 5 slices | only the bottom band of a stack is rank 1 |
| Distance from target | **diverging bar from zero**, or bullet graph | show the variance, do not make them subtract |
| Where is it, a rate | choropleth | **rank 7.** Only when geography is the question |
| Where is it, counts | proportional symbol map | **never choropleth raw counts** |
| Exact value needed | table | |

### Dual axes

Three mechanisms: the scales are arbitrary and can be tuned to make series
track or diverge; proximity manufactures correlation; and the form looks like
a normal line chart, which is why it is not read like one.

**Alternatives in order:** small multiples, an **indexed chart** (everything to
100 at a base period), prioritize one series and annotate the other, or a
**connected scatterplot**.

### 3D

The measured effect is smaller than the rhetoric: **2D height error 4.10mm vs
3D 4.62mm, a difference of 0.52mm**, and it **disappeared when a short delay
was introduced**. Cite the 0.52mm, not a slogan.

Genuinely disqualifying: **3D pie charts** (perspective enlarges near slices,
a lie-factor problem), occlusion, and any chart where the **depth axis encodes
data** (rank 6).

### Stacks

**Only the bottom band sits on a common scale.** Every band above is read
against a moving, data-dependent baseline. Put the series you most need read
accurately on the bottom.

## 7. Colour

### How many categories before it fails

| Source | Number |
|---|---|
| ColorBrewer hard limit | 12 classes, and *"only a few schemes remain differentiable"* at that |
| ColorBrewer practical | *"cartographers seldom use more than seven"* |
| Munzner | 6-12, **and the count must include text, gridline and background colours** |
| Munzner, small scattered regions | **fewer than 8** |
| Datawrapper, colourblind-safe | **3 to 4** |

**Design to 6. Hard stop at 8.** Above that the encoding has failed and you
need faceting, direct labels, or top-N-plus-other.

### Colourblindness, sourced

| Condition | Prevalence |
|---|---|
| **Red/green CVD, men** | **8%** |
| Red/green CVD, women | 0.5% |
| **Deuteranomaly** | **~5% of men.** The most common by far |
| Tritanopia / tritanomaly | ~1 in 30,000 to 50,000 |
| Acquired deficiency | **up to 3% of the population**, concentrated over 65 |
| Scandinavia | up to 10-11% |

**Red-vs-green as the only distinction fails for one in twenty male readers.**
Tritan defects are rare enough that **blue-yellow is the safe direction**,
which is why every recommendation converges on blue and orange.

**Practice:** vary lightness not just hue ("get it right in black and white"
and it works for every deficiency at once), direct-label instead of a key, add
a second encoding, test with a simulator.

### Rainbow

Borland and Taylor, *IEEE CG&A* 2007, "Rainbow Color Map (Still) Considered
Harmful". Three charges: it **confuses** (no perceptual ordering), it
**obscures** (yellow is a luminance spike mid-range), and it **actively
misleads** by creating **false edges where data is flat**.

Viridis was built against four criteria simultaneously: perceptual uniformity
measured in **CAM02-UCS**, **monotonically increasing luminance**, uniform in
grayscale too, and legible under simulated deuteranomaly.

**The honest dissent, so you are not caught flat:** Ware et al., *IEEE CG&A*
2023, "Rainbow Colormaps Are Not All Bad", argues the avoidance has hardened
into dogma and rainbow has legitimate uses where fine local discrimination
across many levels beats ordered reading.

## 8. Dashboards

Few's definition: *"the most important information needed to achieve one or
more objectives; consolidated and arranged on a single screen so the
information can be monitored at a glance."*

**Pitfall #1 is a cognitive claim, not an aesthetic one:** *"we can only hold a
few chunks of information at a time in short-term memory. Relying on the
mind's eye to retain a visualization that is no longer visible is a limited
venture."* Scrolling and tabbing both break simultaneity of vision.

**Pitfall #3, excessive precision:** `$3,848,305.93` should be `$3.8M`.

**Pitfall #4, the one most dashboards violate:** if the viewer needs the gap
between actual and budget, **show the gap.** And prefer **`-10%` over
`-$8,066`**, because a percentage compares across departments of different
sizes. A small department $5,000 over can matter more than a large one $50,000
over, and only the percentage shows it.

### A stat tile needs

Measure name, current value at decision precision, unit stated once, **at
least one comparison** (*"To state that quarter-to-date sales total $736,502
without any context means little. Compared to what?"*), the variance expressed
**directly** as a percentage, a preattentive qualitative read, and a trend
only if shape changes the decision.

**Bullet graphs** replace gauges: a bar against a scale, a comparison marker,
2-5 qualitative bands. Few explicitly allows them **not** to start at zero,
which is the same position Correll et al. reached empirically.

**There is no "above the fold" on a correct dashboard**, because it fits one
screen. If it does not: cut measures, reduce precision, switch to bullet
graphs and sparklines, or split into two. Not scroll.

## 9. Tables

A table is correct when the reader will **look up individual values**, needs
**precise values**, the data has **more than one unit of measure**, or both
summary and detail appear. A graph is correct when the message is in the
**shape**.

Note that Spence and Lewandowsky found pies and bars both **beat tables** for
proportional judgment. **A table is not a safe default.**

**Formatting:** tabular lining figures (`font-variant-numeric: tabular-nums
lining-nums`) so columns align; integers right-aligned; reals aligned on the
decimal; text left-aligned; **never centre anything**; consistent significant
figures within a column; units in the header, not per cell.

## 10. Interaction

Shneiderman's mantra: **"Overview first, zoom and filter, then
details-on-demand."** Seven tasks: overview, zoom, filter, details-on-demand,
**relate, history, extract**. **The last three are the ones everyone forgets**,
and missing history and extract is why analysts export to a spreadsheet.

Vega-Lite's decomposition is the right mental model in any library:
**selection → predicate → what the predicate parameterizes** (input data,
scale extents for pan and zoom, or conditional encoding for brushing).

**When interaction hurts:** when the default state does not carry the message;
when the affordance is undiscoverable; when a 40-series filter is the designer
declining to choose 5; when it is hover-only (unreachable by keyboard, touch
and screen reader).

**Test: state the insight in one sentence. If you can, ship a static annotated
chart.**

## 11. Accessibility

Lundgard and Satyanarayan, *IEEE TVCG* 2021. Four levels of description, from
2,147 sentences: **L1** encoded properties (9.1%), **L2** statistics and
relations (35.1%), **L3** perceptual and cognitive patterns (42.9%), **L4**
domain insight (12.9%).

Evaluated with **30 blind and 90 sighted readers**, 3,600 ranked descriptions.
Blind readers were paid **$50/hr**, which is itself a methods lesson.

**The groups differ significantly.** Blind readers rated **L3 most useful** and
**L4 much less useful** than sighted readers did.

**So write L2 and L3 alt text.** Describe the extrema, the correlation, the
trend, the pattern. Do not enumerate "a bar chart with a blue mark and an
x-axis from 2010 to 2024" (L1), and do not editorialize the cause (L4).

## 12. The finding that matters most for an AI that reads charts

Tonglet et al., arXiv:2502.20503. From the abstract:

> *"MLLM question-answering accuracy on misleading visualizations drops on
> average to the level of the random baseline."*

**Truncated and inverted axes fool models the way they fool people.** Of six
inference-time mitigations, two work: **give the model the underlying table**,
or **redraw the visualization**. Improvements up to **19.6 percentage points**.

**So if Chewbacca ever consumes a chart, pass the data, not the picture.**

### And how badly models currently generate charts

VisEval benchmark, three dimensions: validity, legality, readability.

| Model | Library | Invalid | **Illegal** | Pass | **Quality /5** |
|---|---|---|---|---|---|
| GPT-4 | Matplotlib | 3.3% | **21.4%** | 75.3% | **2.89** |
| GPT-4 | Seaborn | 25.4% | 15.9% | 58.7% | 2.31 |
| Gemini-Pro | Matplotlib | 14.4% | 34.1% | 51.6% | 2.06 |

**The best model scores 2.89 out of 5**, and the dominant failure is
**illegality at 21.4%: the chart renders but does not answer the question
asked.** That is the failure that passes a smoke test.

**Seaborn is much worse than Matplotlib for the same model** (invalid rate up
22 points), attributed to less Seaborn in pretraining. **Library choice is a
correctness variable.**

And independently confirming the stacking argument: **three-channel charts
score lower than the two-channel version of the same type.**

**Rule: a generated chart needs all three checks. Does it render, does it
answer the question asked, is it readable. The second fails silently.**

## The CALVI misleader checklist

From Ge, Cui and Kay, *CHI 2023*, 497 participants. Use as a review list:

cherry picking, concealed uncertainty, inappropriate aggregation,
inappropriate order, **inappropriate scale range**, inappropriate scale
functions, unconventional scale directions, misleading annotations, missing
data, **missing normalization**, overplotting.

Related taxonomies document **over 70 distinct misleader types** in real
charts.

## Gaps

Pandey et al. 2015 effect sizes **[UNVERIFIED]**, full text unreachable from
five sources. Crameri et al. 2020 abstract only. The Isenberg 2011 dual-axis
study cited only through Datawrapper. The 3D millimetre figures come through
Kosara's writeup, not the primary. Few's table criteria from secondary
summaries. Legend lookup timings **[UNVERIFIED]**. The "5 slices" pie rule is
convention; the 8-pixel gridline rule is measured.
