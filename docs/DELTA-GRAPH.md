# The delta graph

Generated 2026-09-28 by `tools/deltagraph.py` from `docs/DELTAS.md`.

A table answers *what differs*. This answers *what closes the most*,
which is a multi-hop question and the only one worth asking before
picking up the next piece of work.

    delta nodes      96
    cause nodes      6
    CAUSED_BY edges  89
    unmodelled       7

## Causes by fan-out

Fix the top one first. Wave 1 is the evidence this is worth doing:
eight rows shared one cause, and a section-by-section reading would
have chased eight symptoms instead.

| cause | closes | wave | lives in |
|---|---|---|---|
| panels carry a fraction of their content | **35** | 3 | `src/app.js` |
| figure element counts differ | **22** | 3 | `src/app.js` |
| lead paragraph rhythm is ad hoc | **15** | 2 | `src/styles.css` |
| sections below the demo are not built out | **9** | 4 | `index.html` |
| centred headings are full-width boxes on ours, shrink-to-fit on theirs | **8** | 2 | `src/styles.css` |

## Unmodelled deltas

No cause claims these, or more than one does. Either way the
ontology is incomplete and that is a finding, not a rounding
error.

| section | axis | delta | claimed by |
|---|---|---|---|
| hero | heading size | **differs** | none |
| hero | heading leading | **differs** | none |
| hero | heading tracking | **differs** | none |
| hero | heading weight | **differs** | none |
| hero | heading align | **differs** | none |
| hero | heading lines | **differs** | none |
| the friday briefing on ai agent ob | heading leading | **-1.8** | none |
