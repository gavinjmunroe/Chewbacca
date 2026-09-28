# The delta graph

Generated 2026-09-28 by `tools/deltagraph.py` from `docs/DELTAS.md`.

A table answers *what differs*. This answers *what closes the most*,
which is a multi-hop question and the only one worth asking before
picking up the next piece of work.

    delta nodes      88
    cause nodes      7
    CAUSED_BY edges  84
    unmodelled       4

## Causes by fan-out

Fix the top one first. Wave 1 is the evidence this is worth doing:
eight rows shared one cause, and a section-by-section reading would
have chased eight symptoms instead.

| cause | closes | wave | lives in |
|---|---|---|---|
| figure element counts differ | **25** | 3 | `src/app.js` |
| the metrics panel is thin (5 text leaves against 24 to 60) | **23** | 3 | `src/app.js` |
| lead paragraph rhythm is ad hoc | **13** | 2 | `src/styles.css` |
| sections below the demo are not built out | **11** | 4 | `index.html` |
| centred headings are full-width boxes on ours, shrink-to-fit on theirs | **8** | 2 | `src/styles.css` |

## Deliberate differences

Counted as deltas and not as work. Each closes rows that will
never reach zero, because ours is a decision rather than a gap.

| difference | rows | why |
|---|---|---|
| offscreen panels are display:none on ours, in the DOM on theirs | 4 | 2026-09-28, stage descendants 457 vs 451-511, painted 42 vs 531 |

## Unmodelled deltas

No cause claims these, or more than one does. Either way the
ontology is incomplete and that is a finding, not a rounding
error.

| section | axis | delta | claimed by |
|---|---|---|---|
| hero | heading lines | **+1** | none |
| notifications | heading lines | **+1** | none |
| fix where you work / mcp | heading lines | **+1** | none |
| ship with confidence | heading lines | **+1** | none |
