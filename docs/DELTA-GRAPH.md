# The delta graph

Generated 2026-09-28 by `tools/deltagraph.py` from `docs/DELTAS.md`.

A table answers *what differs*. This answers *what closes the most*,
which is a multi-hop question and the only one worth asking before
picking up the next piece of work.

    delta nodes      95
    cause nodes      6
    CAUSED_BY edges  83
    unmodelled       12

## Causes by fan-out

Fix the top one first. Wave 1 is the evidence this is worth doing:
eight rows shared one cause, and a section-by-section reading would
have chased eight symptoms instead.

| cause | closes | wave | lives in |
|---|---|---|---|
| panels carry a fraction of their content | **28** | 3 | `src/app.js` |
| lead paragraph rhythm is ad hoc | **17** | 2 | `src/styles.css` |
| figure element counts differ | **16** | 3 | `src/app.js` |
| sections below the demo are not built out | **8** | 4 | `index.html` |
| centred headings are full-width boxes on ours, shrink-to-fit on theirs | **8** | 2 | `src/styles.css` |
| feature blocks not on their 1040/384+544/64 template | **6** | 2 | `src/styles.css` |

## Unmodelled deltas

No cause claims these, or more than one does. Either way the
ontology is incomplete and that is a finding, not a rounding
error.

| section | axis | delta | claimed by |
|---|---|---|---|
| notifications | heading align | **differs** | none |
| notifications | heading lines | **-1** | none |
| fix where you work / mcp | heading align | **differs** | none |
| read the spans / ship with confidence | heading align | **differs** | none |
| fits into your stack | heading size | **-18** | none |
| fits into your stack | heading leading | **-15.2** | none |
| fits into your stack | heading align | **differs** | none |
| trust | heading align | **differs** | none |
| trust | heading lines | **+2** | none |
| friday briefing | heading leading | **-1.8** | none |
| friday briefing | heading align | **differs** | none |
| friday briefing | heading lines | **-1** | none |
