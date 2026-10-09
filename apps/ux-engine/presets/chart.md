# Chart

Compiled from research/09 (Cleveland & McGill, Heer & Bostock, Correll, Skau &
Kosara, Ajani), research/07 (alt text).

## Pick the mark by channel rank, not by gallery

Best to worst for a quantity: **position on a common scale, position on an
unaligned scale, length, angle, area, colour luminance, colour saturation.**

**Put the number you most need read accurately on the highest-ranked channel
available.** That is the whole selection procedure.

| Question | Mark |
|---|---|
| How big is each? | horizontal bar, **sorted by value** |
| How does it change? | line |
| Many series over time | **small multiples, shared scales** |
| Two variables related | scatterplot |
| Share of a total | 100% stacked bar, or a pie under 5 slices |
| Distance from target | **diverging bar from zero**, or a bullet graph |
| Where, as a rate | choropleth. **Rank 7. Only when geography is the question** |
| Where, as counts | proportional symbol map. **Never choropleth raw counts** |
| Exact value needed | a table |

## Three things everyone repeats that are wrong

**Only three of Cleveland & McGill's ten tasks were ever tested.** Position,
length and angle were run; area, volume, curvature and shading were placed by
prior theory.

**Angle is the worst cue in a pie chart, not the operative one.** A donut,
which has no centre angle at all, measured **at least as accurate as a pie**
(1.000 vs 1.032 log error). Arc length does the work. The standard anti-pie
argument names the wrong mechanism.

**Decluttering does not improve what people remember.** Against cluttered
charts: **no significant difference, p = 0.81.** Adding a headline stating the
pattern plus one highlighted subset moved recall strongly, **p < 0.001.**
Decluttering buys higher *professionalism* ratings and nothing else.

## So annotate

**A headline that states the conclusion, one highlighted subset, one sentence
of context.** That is the measured intervention.

**Label the series at the end of the line, in the series colour, and delete the
legend.** A legend forces a mark-to-key-to-mark round trip per series, and
direct labelling is also the strongest colourblind accommodation because it
removes the colour-matching step rather than mitigating it.

## The y-axis is a claim

**Truncation inflates perceived severity**, F(2,76) = 89, p < 0.0001, **in line
charts too**, which kills "bars start at zero, lines need not."

**Broken axes and gradient fills do not fix it.** Neither does forcing people
to read the numbers. Signalling the truncation does not de-bias the reader.

So the range is a claim about what magnitude matters. **Make it deliberately
and be able to defend it.** "I started at zero" is not a defence and neither is
a broken-axis glyph.

## Colour

**Design to 6 categories. Hard stop at 8**, and the count must include text,
gridline and background colours.

**Red-vs-green as the only distinction fails for one in twenty male readers.**
Deuteranomaly alone is ~5% of men. Vary **lightness**, not just hue: get it
right in greyscale and it works for every deficiency at once.

Sequential data gets viridis or a ColorBrewer sequential scheme.
**Rainbow creates false edges where the data is flat.**

## Numbers that are measured

**Gridline alpha 0.2.** Charts under **40px tall** produce significantly more
error (p < 0.001), and accuracy plateaus around **80px**. **Separate gridlines
by at least 8 pixels.**

## Accessibility

**Write Level 2 and Level 3 alt text**: the extrema, the correlation, the trend,
the pattern. Not "a bar chart with a blue mark and an x-axis from 2010 to 2024"
(L1), and not the geopolitical cause (L4). Blind readers rated L3 most useful
and L4 much less useful than sighted readers did.

**Ship a real data table as a fallback.** It also serves the reader who just
wants the numbers.

## If a model will read this chart

**Pass the data, not the picture.** MLLM accuracy on misleading visualizations
**drops to the random baseline**, and of six mitigations the two that work are
giving the model the underlying table or redrawing the chart, worth up to
**19.6 percentage points**.

## The failure mode

**A chart that renders and does not answer the question asked.** In the VisEval
benchmark that is the dominant failure at **21.4%** for GPT-4, and it passes
every smoke test because the image looks fine.
