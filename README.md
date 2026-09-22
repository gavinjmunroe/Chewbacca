# brain-retrieval

Local retrieval over a markdown second brain. No vector database, no API keys,
nothing leaves the machine.

The question that started this: if LLMs operate in vectors, why is a second
brain plain markdown files searched with grep? The answer turned out to be
partly right and partly expensive, and every claim below is a measured number
rather than an opinion.

## The result

Measured on a **sealed 73-question test set** built by a separate process from
the one that tuned the retriever, over a real 476-file / 462k-word corpus.

| method | recall@5 | MRR |
| --- | --- | --- |
| grep, the original design | 12% | 0.079 |
| BM25 | 38% | 0.253 |
| dense vectors only | 55% | 0.405 |
| hybrid fusion, w=0.7 | 66% | 0.466 |
| **+ mean chunk aggregation** | **68%** | **0.486** |

Cost: $0, 7.4MB on disk, 85 seconds to index, ~175ms per query.

Two findings mattered more than the model choice:

**Aggregating chunk scores per file by mean rather than max was the single
biggest win**, worth more on the dev set than changing the embedding model.
A file whose every chunk is mildly relevant beats a file with one lucky chunk.

**Abstention works.** Top cosine below 0.55 means the answer is not in the
corpus. On the sealed set that correctly refused 8 of 8 questions whose answers
do not exist, while wrongly refusing 2 of 65 real ones.

## What was tested and rejected

**Pinecone and hosted vector databases.** The corpus is ~1,536 vectors. A
brute-force numpy dot product over them takes 0.027ms, and is exactly as
accurate because no approximation happens. ANN indexing does not begin to pay
until roughly 10^5 to 10^6 vectors.

**A typed relation ontology over the 1,549 `[[wikilinks]]`.** This was the
hypothesis the project was built to test, and it failed a clean control:
**randomly shuffled relation labels scored identically to hand-curated ones,
across three seeds.** Untyped was marginally ahead on MRR. See
[findings/RESULTS.md](findings/RESULTS.md).

**Personalized PageRank over the link graph.** It helps when anchors are bad
(+6 points on an untuned baseline) and contributes nothing once they are good.
Stacked on the tuned retriever it left recall@5 flat and dropped the
multi-file join metric from 17% to 6%.

**GraphRAG, LightRAG, PathRAG.** Two to three orders of magnitude
over-engineered at this scale, at $3 to $15 per reindex.

Markdown stays the source of truth. The index is derived, deletable, and
rebuildable from scratch in 85 seconds.

## Use

```
ollama pull nomic-embed-text
BRAIN_DIR=~/second-brain python3 src/brain.py index
BRAIN_DIR=~/second-brain python3 src/brain.py ask "what did my mentor say about loneliness"
BRAIN_DIR=~/second-brain python3 src/brain.py status
```

## Layout

```
src/brain.py          the working retriever. Every constant carries the measurement that set it.
bench/                the benchmark. queries.json is dev (25), queries_independent.json is the sealed test (73).
findings/RESULTS.md   every number, how it was produced, and what it rules out.
TODO.md               what to build next, ordered, with acceptance criteria.
RESEARCH.md           the open questions, with what is already known about each.
```

## Reproducing

```
python3 bench/index.py     # chunk + embed into bench/
python3 bench/eval.py      # dev set, 25 queries
python3 bench/tune.py      # sweeps fusion weight, aggregation, query prefix
python3 bench/final.py     # the sealed 73. Run this LAST and only once per change.
python3 bench/stack.py     # PPR over the wikilink graph, on top of the tuned retriever
```

The sealed set exists because tuning on it produced 80% where honest evaluation
produced 68%. Do not tune against `queries_independent.json`.

All glory to God! ✝️❤️
