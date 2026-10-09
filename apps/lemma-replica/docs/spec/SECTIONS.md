# Section specs

Mechanisms measured off the reference. Numbers here were read from its served
payload or its computed styles; anything not measured is marked as a choice so
nobody mistakes it for a finding.

**Copy and artwork are ours.** Match the mechanism, the geometry and the
timing. Write our own words, and do not vendor their assets or any
third-party company marks.

Shared tokens, already in `src/styles.css`: brand `#755CFE`, deep navy
`#322C8A`, page `#f2f2f2`, hairline `#d5d5d5`, label 8px mono uppercase in the
brand colour. **Every weight on the page is 400.** Hierarchy is size, colour
and opacity only.

---

## A. Logo wall, `src/sections/logo-wall.js`

A grid of cells, hairline separated. The section label does **not** sit above
the grid: it occupies a **cell in the middle of the grid**, with logo cells
around it. That inversion is the whole idea and it is what makes the block
read as one object.

- 5 columns at desktop, 1px gaps over a hairline background so the rules come
  from the gap rather than from a border per cell
- cells **populate and empty over time**. Measured as `lg-cell` with r² 0.23
  to 0.61 against scroll, which is too low for a tween: the cells are swapping
  content, not animating position
- swap one cell at a time on an interval, cross-fading content over ~300ms and
  holding for a few seconds. Interval is OUR choice; the swapping is theirs
- use our own placeholder marks, never real company logos

Verify: the label sits inside the grid, not above it. Cells change content
while the section is on screen and stop when it is not.

---

## B. Failure wall, `src/sections/failure-wall.js`

The section under a headline about unpredictable failures. It arrives in three
stages, and the first stage looks like a bug if you have not seen the sequence.

1. Solid brand-coloured bricks land in a masonry layout, offset row to row
2. Each brick becomes an **outlined chip** carrying a short monospace id
3. A minority of chips flip to a **failure state**: filled in a warm red, with
   a category label in small caps and a one-line quote

- 6 to 7 rows, bricks of varying width, rows offset so vertical seams never
  line up
- outlined state: 1px brand border, transparent fill, id in 8px mono at low
  opacity
- failure state: roughly 1 in 4
- stage transitions are `transform` and `opacity` only

Write our own failure categories and quotes. Theirs are their product copy.

Verify: all three stages are visible in sequence, and the solid stage is not
skipped.

---

## C. Counter, `src/sections/counter.js`

An odometer, recovered exactly from their bundle. The blur in a mid-count
frame is built in rather than a capture artifact.

- one reel per digit
- each reel is a column of **11 cells**, `(start + i) % 10`, so there is
  always a wrap cell to land on and never a gap
- the column translates by `-10em`
- window: `height: 1em`, `overflow: hidden`, `inline-block`,
  `align-baseline`
- **each reel gets its own duration, delay and SVG blur filter**, id'd per
  reel index. Six filters were observed across 83 captured states

Independent per-digit timing is what makes it read as a mechanical counter.
A single element counting up cannot produce it, and neither can one shared
blur.

Verify: digits settle at different moments, and each carries its own filter id.

---

## D. Testimonial carousel, `src/sections/testimonials.js`

- three cards visible, **constrained to the content column**, not full-bleed.
  The current build gets this wrong and it is the most visible error in the
  section
- edge cards partially faded, arrows at both sides
- a dot row beneath, one dot per item, the active one filled
- cards are hairline-bordered on the page background, avatar and handle in the
  header, body at 400 weight

Our own quotes and names. Never invent a real person's endorsement.

Verify: at 2560px wide the track stays inside the column.

---

## E. Chat notification mock, `src/sections/chat-mock.js`

A chat-client panel showing an automated alert and a short thread.

- their `slackTyping` keyframe runs `1.2s ease-in-out infinite`, so a typing
  indicator is part of it
- panel is hairline-bordered on the page background with a channel header
- messages: an app message with a bold first line and a short body, a human
  reply, an app reply carrying a small bulleted list and a button

Our own product copy, our own names, our own app identity.

Verify: the typing indicator loops at 1.2s and the panel is column-width.

---

## F. Integrations, `src/sections/integrations.js`

- a centred label, headline and one-line subhead
- a horizontal row of framework marks, faded at both ends so the row reads as
  continuing
- two numbered panels below, side by side: an env-file panel and a prompt
  panel, both monospace, the second with a copy affordance
- panels are hairline-bordered with a small monospace caption bar on top

Our own marks and our own copy.

Verify: the row fades at both edges, and the panels sit on one row at desktop.

---

## G. Trace waterfall, `src/sections/waterfall.js`

Read out of their chunk `8331`, which is the component actually named
`TraceShowcaseVisual`.

- a header row: a trace id in monospace, plus a duration and a span count
- an occurrences block listing findings, each expandable
- a **nested span tree**: rows indented by depth, each with an icon, a
  monospace name, a duration, and a horizontal bar positioned and sized by the
  span's offset and length within the trace
- span kinds seen in their demo data: an agent run, a text generation, a tool
  call, a retrieval, a vector search, a guardrail check
- bars are colour-coded by kind; error rows carry a marker and red text

Our own trace data. Invent a plausible run of our own.

Verify: bar offsets and widths are computed from the span times, not
hand-placed.
