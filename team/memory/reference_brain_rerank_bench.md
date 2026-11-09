---
name: reference_brain_rerank_bench
description: brain-rerank (explicit command) and how to reproduce its sealed 72.3% recall@5; the frozen index lives at ~/.cache/chewbacca/brain-bench/idx-2026-10-10
metadata:
  type: reference
---

`brain-rerank ask "<question>"` is `brain ask` with haiku reordering stage one's top 30 (apps/brain-retrieval/src/brain_rerank.py, landed 31010a03 on 2026-10-10). It's explicit only, never the per-prompt hook: p50 was 37s through `claude -p`.

Sealed result (bench/frozen/rerank_A.json, n=65 independent queries): recall@5 55.4% to 72.3%, MRR 0.357 to 0.652. The sealed command runs once per frozen file by design.

To reproduce without a model call: `BRAIN_INDEX=~/.cache/chewbacca/brain-bench/idx-2026-10-10 python3 apps/brain-retrieval/bench/rerank.py replay bench/frozen/rerank_A.json`. It re-scores from the ranking cache (~/.cache/chewbacca/brain-rerank, keyed by prompt hash) and reports cache misses; any miss means the index, gold set or rerank.py changed and it says it isn't a reproduction. On 10/10 it gave 72.3% / 0.652 with 0 misses on current main.

The frozen index was first built in a session scratchpad (8c108252), which gets wiped; the copy under ~/.cache is the one to use. Related: [[project_brain_recall_abort_loop]], [[project_mog_plan]].
