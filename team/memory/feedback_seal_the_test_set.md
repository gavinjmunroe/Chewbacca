---
name: feedback-seal-the-test-set
description: Never evaluate on the queries you wrote while building the thing; the gap on this repo was 12 points, 80% versus 68%.
metadata:
  type: feedback
---

2026-09-22. Building the brain retriever, I wrote 25 benchmark queries and also
designed the retriever. Tuned on them it hit **80% recall@5**. A second process
then built 73 queries blind, having never seen the retriever or the first set.
Honest score: **68%**.

Worse, plain grep scored **28%** on my queries and **12%** on the blind ones.
More than half of grep's apparent competence was me unconsciously writing
questions in the corpus's own words.

**Why:** the same failure runs through the whole memory-systems field. Zep
self-reports 94.7% on LoCoMo and scores 75.1% third-party; one 100% claim used
top_k=50, which retrieves the entire conversation. A number produced by the
person who benefits from it is not a measurement.

**How to apply:** whenever building anything with a score, have a separate pass
build the eval set before tuning starts, freeze it, and run it once per change.
Report the sealed number, never the dev number. If only one set exists, say the
number is a dev number and treat it as an upper bound. The same applies to any
agent that self-reports precision: a pilot here self-graded 85% and a real
audit of 165 edges put defensible precision at 64%.

Related: a private note, a private note,
a private note, [[feedback_measure_exit_codes_directly]].
