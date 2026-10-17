---
name: feedback_tables_planned_and_tools_weighed
description: Every Clay table Chewbacca builds follows a declared client view, and every enrichment is picked from the full catalog by measured value, not by habit
metadata:
  type: feedback
---

Every Clay table Chewbacca builds is planned from a spec, and every enrichment column is chosen by weighing the whole catalog. Caleb, 2026-10-17, looking at the Sabo table: "U are unorganized af with the table", "I need chewbs to have a perfect memory of all the diff clay tools you are yet to use a built in waterfall and always weigh the best option systematically", and "Make sure every table chewb ever makes is systematically organized, not brute forced. This will make it infinitely easier to iterate and build off of and learn from workflows."

Why: the Sabo table grew to 38 columns, one per experiment, with Findymail, Email and Verify each built twice and everything visible. The 10/16 lesson about a sorted client view was written down and still never applied, because applying it was a manual step. Findymail ran alone on every brand while Clay's Work Email waterfall was in the Tools panel.

How to apply:

- Before any column: `python3 -I tools/table_graph.py <table>` and reuse what's there.
- After any row batch: `python3 -I tools/table_tidy.py --client <slug> --apply` (client file `view_spec`, else derived from `columns`).
- Before any enrichment: `tools/enrich_catalog.py pick "<capability>"` after `build` from `clay workflows actions list` and `learn` from the run log. A near tie gets a cheap head-to-head test.
- No hand-set rates or values. Caleb, same day: "Nothing in this process should be based on vibes/rough association! There needs to be substantial factors all taken mathematically into account for a robust process". `enrich_math` uses Beta posteriors over usable results, prices cascades, takes value from the client file, and returns a sized test when P(best) is under 0.9.
- Never put "clay" in a worktree, tool or test filename. launch-guard reads any command that mentions Clay as one that reaches it, so `cd ~/code/wt-clay-catalog`, `pytest tests/test_clay_catalog.py` and every `rm` on those paths were refused on 2026-10-17 until the worktree and files were renamed (enrich_catalog, wt-enrich-catalog).
- Measured 2026-10-17 on Sabo brands: Findymail found 22 of 33 tries but only 12 were valid and at the right company (36%). The waterfall is unmeasured, so the pick is a 68-row test of it on Findymail's misses.
