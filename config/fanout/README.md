# fanout

The JevBacca kill test (Master Context section 33), run on one person's texts
before any company's. The plan behind it is `research/jevbacca/BRAIN-PLAN.md` in
the gavin-context brain.

Every message is checked against the 25 predicates in `predicates/` by three
architectures:

| Arm | What reads each message                                                            |
| --- | ---------------------------------------------------------------------------------- |
| A   | Claude, against all 25 predicates                                                  |
| B   | Regex rules pick candidate predicates; Claude reads only those                     |
| C   | Jev answers all 25 in one call; sure answers count, the unsure band goes to Claude |

`fanout score` compares them against your hand labels on recall, precision, review
burden (findings you would have to read), Claude dollars, Jev tokens and wall
time. It then applies the kill rule: **if C does not beat B on recall at the same
review burden, Jev is not the unlock for this data.** Jev has no public price, so
the report gives the per-million-token price at which C would match B's findings
per dollar, rather than a guessed price.

## Running it

```
fanout sample            # 300 messages from the last 30 days of people.db
fanout label             # hand labels, resumable, about 20 seconds a message
fanout run A; fanout run B; fanout run C
fanout score             # table, verdict, per-predicate tp/fp/fn
fanout scan --days 1     # what the gate would write today. Writes nothing.
```

Data lives in `~/.chewbacca/fanout` (mode 600), never in git. `report.txt` holds
counts only and is safe to copy into the brain.

## A predicate

One JSON file each: `question` (what Jev and Claude are asked, as a full
sentence, because Jev reads the instruction and not the key), `rules` (arm B's
regexes), `action` (what the gate would write), the cost of a false positive
and a false negative, and two thresholds. `accept` and `review` are guessed
(0.8 and 0.35) and have never been measured. Refit them from labels before
trusting arm C.

## What the fictional fixture showed, 2026-09-23

30 made-up messages in `tests/fixtures/fanout/`, hand-labelled, Sonnet as the
Claude arm. This checks that the pipeline works. It is not the kill test,
because the messages were written to match the predicates.

The kill rule fired on the fixture. The per-arm figures are kept privately,
because arm C's are Jev performance results, which TypeSafe's terms do not
allow publishing. Re-measure with `fanout score` on your own labels.

Built with Chewbacca
