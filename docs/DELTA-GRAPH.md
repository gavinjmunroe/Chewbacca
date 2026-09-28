# The delta graph

Generated 2026-09-28 by `tools/deltagraph.py` from `docs/DELTAS.md`.

A table answers *what differs*. This answers *what closes the most*,
which is a multi-hop question and the only one worth asking before
picking up the next piece of work.

    delta nodes      85
    cause nodes      6
    CAUSED_BY edges  85
    unmodelled       0

## Causes by fan-out

Fix the top one first. Wave 1 is the evidence this is worth doing:
eight rows shared one cause, and a section-by-section reading would
have chased eight symptoms instead.

| cause | closes | wave | lives in |
|---|---|---|---|
| figure element counts differ | **33** | 3 | `src/app.js` |
| the metrics panel is thin (5 text leaves against 24 to 60) | **24** | 3 | `src/app.js` |
| lead paragraph rhythm is ad hoc | **11** | 2 | `src/styles.css` |
| sections below the demo are not built out | **9** | 4 | `index.html` |
| centred headings are full-width boxes on ours, shrink-to-fit on theirs | **8** | 2 | `src/styles.css` |
