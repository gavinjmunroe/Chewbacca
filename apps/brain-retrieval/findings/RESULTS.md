# RESULTS

Every number produced in this investigation, with the command that produced it.
Measured 2026-09-22 on a MacBook Pro, corpus `~/second-brain`.

## Corpus

```
personal brain (core domains memory projects systems wiki raw log)
  476 files, 461,844 words, ~614,253 tokens
  chunked at 300 words with 60 overlap -> 2,398 chunks
  embeddings: nomic-embed-text, 768d, float32 -> 7.4MB
  indexing: 85.2s
links: 1,511 found, 1,495 resolved, 16 broken
memory/: 291 files, 289 with a description, 288 with an index pointer, 1 orphan
  MEMORY.md 134 pointers (loads every session)
  ARCHIVE.md 157 pointers (does not load)
```

## Dev set, 25 queries (`bench/queries.json`)

Written by the same process that built the retriever. Biased. Used only for tuning.

```
method    recall@5     MRR
grep           28%   0.159
bm25           52%   0.324
vector         60%   0.430
hybrid         56%   0.460
```

## Sealed test set, 73 queries (`bench/queries_independent.json`)

Built blind, seed 42, `random.sample` over 466 files, by a process that never
saw the retriever or the dev queries. 47 single-hop, 18 multi-hop, 8 traps
whose answers are not in the corpus. Seven questions were rewritten after a
leakage check flagged >0.75 token overlap with their gold file.

```
                              r@5     MRR
grep                          12%   0.079
bm25                          38%   0.253
dense only                    55%   0.405
  + fusion w=0.7              66%   0.466
  + mean-agg  (TUNED)         68%   0.486

single-hop  n=47   68%   MRR 0.527
multi-hop   n=18   67%   MRR 0.379
```

grep fell from 28% to 12% once the questions were not written by the same
process as the retriever. That collapse is the central result.

## Abstention

```
mean top cosine, traps (n=8)  0.493
mean top cosine, real (n=65)  0.617
separation                    +0.125
at threshold 0.55: 8/8 traps correctly abstained, 2/65 real wrongly abstained
```

## Tuning sweep, dev only (`bench/tune.py`)

Chunk-to-file aggregation was the largest single lever found, larger than the
embedding model.

```
agg      qprefix         w    r@5     MRR
max      (none)        0.7    64%   0.566
mean     (none)        0.5    80%   0.725
mean     (none)        0.7    80%   0.744   <- selected
mean     search_query: 0.7    80%   0.723
sum2     (none)        1.0    36%   0.236
logsum   (none)        0.7    20%   0.098
```

`search_query:` prefixing, which nomic-embed-text was trained with, made no
difference on the query side. The document side was never tested.

## Graph experiments

### PPR on the untuned baseline (`bench/graphrank.py`, dev n=25)

```
                                    r@5     MRR   all@5  join@5
vector (baseline)                   60%   0.430    48%     18%
1-hop expansion, boost 0.25         48%   0.421    28%      0%
1-hop expansion, boost 1.00         12%   0.129     0%      0%
PPR directed, alpha 0.7             64%   0.501    56%     36%
PPR directed, typed, seed_k 20      64%   0.534    56%     36%
```

`all@5` means every gold file in the top 5. It is the only metric that can see
a join, because recall@5 scores a hit when one of two gold files is found.

### The shuffled-label control, the decisive result

Same 55 edges, same topology, labels the only variable.

```
                                   r@5     MRR   all@5  join@5
graph0 + pilot, labels erased      64%   0.498    56%     36%
graph0 + pilot, labels used        64%   0.496    56%     36%
graph0 + pilot, labels SHUFFLED    64%   0.497  56/52/56  36/27/36   (3 seeds)
```

Untyped is marginally ahead on MRR. Randomly shuffled labels score the same as
hand-curated ones. A pruning-only control (downweight UNTYPED and MENTIONS,
ignore every other semantic) captures the entire apparent typed gain, so what
little exists comes from suppressing noisy edges, not from meaning.

n=7 on the pilot slice, 15 gold pairs overall. The direction is consistent
across every cut; the magnitude is not significant on its own.

### PPR stacked on the tuned retriever (`bench/stack.py`, sealed n=65)

```
  beta    r@5     MRR   all@5   join@5
  0.00    68%   0.486     54%      17%   <- no graph
  0.05    69%   0.486     51%       6%
  0.10    68%   0.502     49%       6%
  0.20    68%   0.510     51%      11%
  0.40    66%   0.503     49%      11%
```

The graph's contribution disappears once anchors are good, and it damages the
join metric. The earlier +6 point PPR gain was compensating for bad retrieval.

### Why the graph could not help

Oracle test: hand the graph one correct gold file and ask for its partner.
8/13 recovered on wikilinks, 5/5 on the pilot graph. All 15 gold pairs are
connected within 4 hops, 11 within 2. But of the 8 queries both vector and
hybrid missed, 7 had no gold file in vector top-10. The graph can do the join.
It never gets a correct seed to start from, and once it does, plain retrieval
has already found the answer.

## Extraction precision

Pilot, 12 files, self-reported: 85%, 55 edges.

Independent audit, 25 files (seed 8168), 165 edges:

```
verbatim quote verification   164/165 = 99.4%
  (the one failure was a single-word paraphrase, invisible without the check)

STRONG     105   64.0%   the quote states the relation outright
INFERRED    44   26.8%   the quote supports but does not state it
WEAK        15    9.1%   a stretch
```

Defensible precision is 64%, not 85%. At 64%, a 2-hop walk is ~41% correct.

Collapse relations are **CAUSED (37) and CONSTRAINS (28), 39% of all edges**,
not the ABOUT (7) / MENTIONS (1) fallback the ontology guarded against.

By relation, worst first: CHOSE 75% not-STRONG, ABOUT 71%, VIOLATED_BY 45%,
EVIDENCE_FOR 44%, DECIDED_AGAINST 42%. SUPERSEDES and SAID_BY were 0%
not-STRONG, because the corpus states them lexically.

15-20% of edges have a second defensible type, putting an inter-annotator
ceiling near 80-85%.

Cost to type all 1,091 untyped links across 318 notes: ~$10 on Opus 5, ~$4 on
Sonnet 5, ~$2 on Haiku 4.5, plus $0.49 for a second-pass grader. 13 minutes at
10-way concurrency.

## Entity resolution was never run, and it matters

The pilot emitted 55 edges from 12 files. Endpoint analysis:

```
file -> file        15
file -> free text   40
distinct entity nodes      37
  shared by 2+ files        2   (one is "Caleb Newton", which bridges nothing)
  dead ends                35
```

Every extraction invented its own string, so no two notes ever landed on the
same entity. Stage 8 of the standard pipeline, fusion, was skipped. The correct
reading of the typed-edge failure is therefore "typed edges **without entity
resolution** do not help." Running fusion first is the cheapest way to reopen
the question.

## Known bugs in this repo's own measurements

- `bench/graph0.py` reports 0 CONTRADICTS. That is a matcher bug: the regex is
  same-line and `> [!contradiction]` callouts span lines. 16 callouts exist,
  7 have a link in the block.
- The first indexing run crashed at chunk ~1300 with HTTP 500. Cause: one chunk
  of 240,877 characters containing a single 234,068-character token, a base64
  blob in a club-application file. Fixed by `MAXTOK`/`MAXCHARS` in `src/brain.py`.
- BM25 in `bench/` is a naive Python loop over all chunks per term. Correct but
  slow. `src/brain.py` uses SQLite FTS5 instead.

## Machine measurements

```
nomic-embed-text warm, in-process (n=30)   p50 12.4ms   p90 19.0ms
same, cold CLI process                     50-358ms, median ~90ms under load
same, model not resident                   460ms
numpy E @ q, 2398x768 float32              0.027ms
same in float16                            3.6ms  (130x worse, no BLAS path)
reading 2398 vectors out of SQLite BLOBs   6.1ms
np.load of the 7.4MB npy                   1.5ms
python3.14 start + import numpy            74-78ms
FTS5 bm25 top-40 over 2398 rows            0.16-2.6ms
walk + stat 466 md in the 6 indexed dirs   4.2ms
grep -ril fallback over the 6 dirs         70-80ms
full DB build, 2398 chunks + FTS + blobs   310ms, 13.2MB
```

Load average was 9-23 throughout, so the ollama figures are pessimistic.

## Ablations, and the chunk-size trap

Run on the dev set against the **untuned** 300w/max-agg baseline (60%).

| variant | recall@5 | delta | MRR | index_s | MB |
| --- | --- | --- | --- | --- | --- |
| nomic-embed-text 300w, prefix on | 60% | base | 0.430 | 81 | 7.4 |
| mxbai-embed-large (1024d) | 60% | +0 | 0.484 | 162 | 9.9 |
| embeddinggemma (768d) | 60% | +0 | 0.503 | 83 | 7.4 |
| all-minilm (384d) | 56% | -4 | 0.328 | 20 | 3.7 |
| 600 target words | 60% | +0 | 0.434 | 72 | 6.5 |
| 150 target words | 76% | +16 | 0.511 | 87 | 10.9 |
| 75 target words | 80% | +20 | 0.566 | 125 | 19.2 |
| 300w, overlap 240 (count control) | 64% | +4 | 0.451 | 112 | 9.0 |
| **no filepath/description prefix** | **48%** | **-12** | 0.388 | 72 | 7.4 |
| task prefixes (search_query/document) | 64% | +4 | 0.526 | 80 | 7.4 |
| vec top-20 reranked by RRF | 68% | +8 | 0.535 | 81 | 7.4 |
| 75w + task prefixes + RRF | 76% | +16 | 0.592 | 130 | 19.2 |

**Every embedding model swap was a wash on recall.** mxbai costs 2x index time
and 33% more disk for 0 points. MRR moves, the top-5 set does not.

**The prefix is load-bearing in the opposite direction from the hypothesis.**
Stripping `filepath | frontmatter description` before embedding costs 12
points. The queries it carries are the ones where the filename is the answer.
Keep it.

### The chunk-size trap, measured on the sealed set

The +20 from 75-word chunks was measured against the untuned max-agg baseline.
Re-run against the tuned config it reverses:

```
                        dev          SEALED (n=65)
300w mean (shipped)     80%          68%
75w  mean               80%          58%
75w  max                80%          65%
75w  top3               80%          63%
```

Small chunks and mean aggregation are **substitutes, not complements**. Both
fix the same failure, a file with one lucky chunk outranking a file that is
broadly relevant. Applying both costs 2.6x the disk (19.2MB vs 7.4MB) and 1.5x
the index time to lose 10 points on held-out data.

Dev could not see this: all four variants tie at 80% there. Only the sealed set
separated them. `bench/final75.py` reproduces it.
