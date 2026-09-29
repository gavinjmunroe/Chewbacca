# Resume here

Written 2026-09-28 so a cold session can pick this up without re-deriving
anything. Read this, then `PLAN.md`, then start Wave 1.

## What this is

A 1:1 replica of uselemma.ai, built as a learning exercise and a trust gate.
Private repo, deliberately. The product on the page is fictional and called
Sift; none of the reference's brand, copy, customers, marks or font files are
in this repo and none ever go in.

## The state, measured not remembered

    axes matching       117 of 205     57%
    instrument check    clean, exit 0
    page height         ours 16970     theirs 17852
    sections            11 / 11, all paired
    console errors      0
    copy check          clean, 213 of their strings checked
    brand check         0 hits for their name in rendered text

Regenerate before trusting any of it:

    python3 tools/measure2.py https://www.uselemma.ai/ REF
    python3 tools/measure2.py http://localhost:8731/index.html OURS
    python3 tools/gendeltas.py
    python3 tools/check_measure.py      # MUST exit 0 before reading a score
    python3 tools/deltagraph.py         # ranks the causes by fan-out

A measure2 run reloads before each section on both pages, so the pair takes
about eight minutes. That cost buys the class of bug where the walk destroys
what it is about to read.

## Start here, in order

1. `PLAN.md`. Eight waves. Each has ENTRY, WORK, LOOP, EXIT and a STOP block.
   Wave 1 is open.
2. `docs/SECTIONS.md`. Every section on both pages, the pairing, and the
   feature-section template recovered from their DOM.
3. `docs/DELTAS.md`. One row per section per axis with both numbers.

## Where the waves are

    Wave 1  structure        CLOSED, docs/waves/W1-structure.md
    Wave 2  design system    CLOSED, docs/waves/W2-design-system.md
    Wave 3  pinned panels    OPEN, and much smaller than the plan says

Wave 3 shrank once it was measured. The plan called the panels the largest
item on the page from "their sticky panel holds 504 descendants, ours 32 to
169", which compared their whole container against our individual panels.
Measured the same way on both, our stage holds 457 descendants against their
451 to 511 and our text-leaf counts beat theirs. The density is there.

What is actually left, by fan-out:

    figure element counts differ      25   the hero plates, not the panels
    the metrics panel is thin         23   STALE: that panel went 5 -> 30
                                           leaves, the cause was written
                                           from the old numbers and needs
                                           re-modelling before it is worked
    lead paragraph rhythm             13   Wave 2 leftover
    sections below the demo           11   Wave 4
    centred headings shrink-to-fit     8   Wave 2 leftover, mostly copy length

Nothing is blocked on Caleb. The Wave 3 STOP question about what the panels
argue was answered by building: fictional product, invented data, no
third-party marks.

## The gate

`~/.claude/hooks/plan-guard.sh` reads the PLAN-GATES block at the top of
PLAN.md, finds the first wave whose required artifacts do not exist, and
refuses any write outside that wave's allowed paths. It is not advisory: it
exits 2 and the write does not happen.

Right now Wave 1 is active, so `src/app.js`, `src/sections/`, `index.html`
and `src/styles.css` are writable and `src/geometry.js` and `src/scroll.js`
are not. Wave 2 opens when `docs/waves/W1-structure.md` exists.

Do not route around it. If a wave's scope is genuinely wrong, edit the gate
block and say why in the commit.

## How to measure anything here

    scratchpad/measure2.py <url> <TAG>    per-section geometry, both pages
    scratchpad/gendeltas.py              regenerates DELTAS.md
    scratchpad/palette.py                distinct values per repeated set
    scratchpad/chunks.py + shootchunks   90 matched chunk pairs
    ux-engine/bin/ux-compare             offline side-by-side from a manifest
    ux-engine/bin/ux-rate                scroll rate per element, no sampling

`measure2.py` places the viewport AT each section before reading it. Do not
go back to a single global pass: both pages animate on scroll and a single
pass reads whatever state the walk left them in.

`ux-gap` compares inventories, not geometry. It reported 27 gaps on a page
where every brick sat half its width off-position. Never steer by it alone.

## Things that will bite you

They are all in PLAN.md under "The traps that already bit". The three that
cost the most:

- The pixels outrank the DOM. Three probes were wrong in one morning.
- When two things measure identical and render differently, ask WHERE the
  value is applied. Group opacity destroys what per-element opacity keeps.
- Uniform and random are both guesses. Ten of their twelve repeated sets are
  uniform and two are four-value palettes. Go and read which.

## Repos and their state

    lemma-replica          main, pushed, clean
    Chewbacca              main, pushed. clone-site skill, plan-guard,
                           prayer-remind all landed
    second-brain           memory/ updated and pushed

## What the instrument will do to you

Ten measurement bugs on 2026-09-28, every one found because a number moved
while the page had not, and two of them introduced by fixing the previous one.
`tools/check_measure.py` exists because of that and it refused two bad scores
in one afternoon. Run it before reading any number.

The ones that cost most:

    innerText returns '' for an element mid-entrance; textContent swallows
      inline <script> and drops the space a <br> renders as. Neither works
      as a heading label. tools/measure2.py clones, strips, and collapses.

    the delta pairing was hardcoded indices and went stale the moment the
      section set changed. It is explicit overrides now, and the copy check
      refuses a rebuild that reintroduces one of their sentences to make
      text pairing convenient again.

    sections must be measured CENTRED. Inside a pinned scene a panel only
      reaches full opacity when its text block is centred, so sampling
      anywhere else catches a crossfade mid-flight and reads as missing
      content.

    two causes claiming one delta sends it to `unmodelled` by design, so a
      rule that looks correct can report zero rows. Check the counts.

## Deliberate differences, not work

`docs/DELTA-GRAPH.md` lists these outside the ranking, because a delta like
this ranks as work forever if nothing says otherwise.

    offscreen panels are display:none on ours and in the DOM on theirs.
    Their container paints ~460 descendants in every feature block; ours
    paints 42. Our stage total matches theirs. Keeping the decision: a panel
    at opacity 0 still paints its children's stacking context and still traps
    pointer events.
