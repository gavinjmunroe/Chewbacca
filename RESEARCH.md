# RESEARCH

Open questions, and what is already known about each so the next person does
not re-run work that has been done. Eleven research agents produced this;
where a claim could not be verified at source it is marked UNVERIFIED.

---

## Q1. Is 68% recall@5 good, and what is the ceiling?

Unknown, and this is the most important open question, because without a
ceiling nobody knows whether the remaining 32% is worth chasing.

Known:
- Honest third-party LoCoMo retrieval runs at roughly 60.3% Recall@10 raw and
  88.9% with hybrid plus reranking. Our 68% at k=5 on a harder query set is
  plausibly mid-pack.
- Vendor numbers are not comparable. Self-reported LongMemEval has Mem0 at
  94.4% and Zep at 71.2%; an independent GPT-4o run put Mem0 at 49.0% and Zep
  at 63.8%. One 100% LoCoMo claim used top_k=50, which retrieves the whole
  conversation.
- Our own dev-to-test gap was 12 points (80% to 68%).

To do: establish a human ceiling. Have a person answer the 73 sealed questions
using only the corpus and measure how often they find the gold file. If humans
hit 75%, the gold labels are the limit, not the retriever.

---

## Q2. Why did relation types contribute nothing?

The shuffled-label control is the strongest evidence in the repo and it is also
the least explained. Three hypotheses, untested:

1. **Sparsity.** The graph is 0.6 edges per chunk against GraphRAG's 2.4 per
   node. There may be too few edges for labels to matter regardless of quality.
2. **Extraction quality.** Human-audited precision was 64% STRONG, 27%
   INFERRED, 9% WEAK, not the 85% self-reported. At 64%, a 2-hop walk is
   ~41% correct. Labels may be too noisy to carry signal.
3. **Entity resolution was skipped.** The pilot produced 37 entity nodes of
   which only 2 were shared by more than one file, because every extraction
   invented its own free-text string. Stage 8 of the standard pipeline
   (fusion) was never run, and the graph-engineering literature calls skipping
   it the single largest cause of useless graphs.

Hypothesis 3 is the one that would change the verdict. A fusion pass that
canonicalizes entity strings before measuring is the cheapest test, and until
someone runs it the "typed edges do not help" finding is really "typed edges
without entity resolution do not help."

---

## Q3. What is the real query mix?

The whole architecture depends on how often real questions need two files
joined, and nobody has measured it. The sealed set was 47 single-hop, 18
multi-hop, 8 trap, but those proportions were chosen by an agent, not observed.

To do: log 100 actual questions asked in real sessions. If fewer than 30% need
two files that do not already link, the graph has no customer at all. Note the
suggestive result already in hand: on the sealed set multi-hop scored 67% and
single-hop 68%, so multi-hop is not currently the weak spot.

---

## Q4. Does long context beat retrieval here?

The corpus is ~614k tokens and frontier windows are 1M, so "load everything" is
physically possible. The evidence says it does not work and is expensive.

- Lost-in-the-middle, U-shaped accuracy by position (Liu et al. 2023, TACL 2024).
- RULER (Hsieh et al. 2024): effective context is far shorter than advertised
  across all 17 models tested.
- NoLiMa (Modarressi et al., ICML 2025): 11 of 13 long-context models fall below
  50% of their short-context baseline at 32k once a latent hop is required.
  GPT-4o 99.3 to 69.7.
- Cost at Opus rates: roughly $3.14 cold per query, $0.31 on a cache read. The
  5-minute cache TTL means most sessions pay the write.

Open: nobody ran the actual experiment on this corpus. Stuff all 614k tokens in
and score the same 73 questions. It is one expensive run and it settles the
question permanently.

---

## Q5. What closes the learning loop?

The parent kit's backlog item "Close the learning loop. The score has never
moved" is unresolved. What the literature says works, in cost order:

1. **Retrieval-hit logging.** Log which file was retrieved and which was opened.
   Files unopened for 60 days are dead weight; opened-but-wrong means a bad
   description. Free.
2. **User correction as label.** ReasoningBank (arXiv 2509.25140, 2025) distills
   from self-judged successes and failures: +8.3% absolute WebArena, +4.6%
   SWE-Bench-Verified. Failures carry more signal than successes.
3. **Frozen regression set with counterfactual ablation.** Replay past failures
   with memory on and off. The only design that shows a memory *helped*.
4. **A/B on task success**, as ACE (arXiv 2510.04618, 2025) and AWM
   (arXiv 2409.07429, 2024) report.

Score four dimensions separately, never one number: recall, freshness,
contradiction handling, and whether retracted facts are actually gone.

---

## Q6. Forgetting, which nothing here does

The store only grows: 291 memory files in about two months, nothing merged,
decayed, or deleted.

- Mem0 (arXiv 2504.19413, 2025) runs an explicit write-time ADD / UPDATE /
  DELETE / NOOP classifier. +26% relative over OpenAI Memory on LoCoMo.
- ForgetEval (arXiv 2606.15903, 2026), 1,385 cases: deterministic string-match
  deletion scored 5% on identifier obfuscation and 0% cross-lingual; an LLM at
  ingest hit 100% canonicalization but 0% intent-aware deletion; an LLM hook at
  **mutation time** got 78-85% intent-aware and 91.7-93.2% overall.
- SAGE (arXiv 2605.30711, 2026) gates writes with a von Mises-Fisher novelty
  estimator: 16-18% of write-time LLM calls skipped, 3.4x lower add cost.
- Generative Agents (Park et al., UIST 2023): recency x importance x relevance,
  exponential decay 0.995/hr since last retrieval. Nothing deleted, things sink.

The consistent finding: **the forgetting decision belongs at write time.** A
store with no write gate has nowhere to put it.

---

## Q7. Consolidation, and the gap nobody fills

Systems that synthesize higher-level rules from repeated low-level observations:
AWM (2024, +24.6% Mind2Web), ReasoningBank (2025), ACE (2025, +10.6% agents),
A-MEM (NeurIPS 2025, link evolution rather than abstraction, up to 6x ROUGE-L
on multi-hop), Memp (ACL Findings 2026, explicit deprecation of stale procedures).

ACE names the two failure modes to design against: **brevity bias**
(summarizing away the domain detail) and **context collapse** (rewriting erodes
specifics over time). Atomic append-only files avoid collapse and leave you
with no curator, which is exactly the current state.

**Nothing mainstream promotes on a frequency threshold.** "This was corrected
three times, write a rule" is an unfilled gap. AWM comes closest by inducing
from repeated traces. This is where a small custom mechanic could beat anything
off the shelf, and correspondingly where there is no prior art to lean on.

---

## Q8. Will anyone maintain typed links? Prior art says no.

Obsidian community download counts, read 2026-09-22:

| plugin | downloads | last release |
| --- | --- | --- |
| Dataview (untyped metadata, queried) | 5,009,198 | ~1 year ago |
| Breadcrumbs (hierarchy only) | 350,272 | 9 days ago |
| Juggl (typed-edge graph) | 136,886 | 3 years ago |
| Graph Link Types | 13,315 | 4 months ago |

Typed-edge tooling is 0.27% of the untyped-metadata tool. The Obsidian feature
request for link types (opened Jul 2020) is nine pages long and still
unimplemented after six years. The one survivor, Breadcrumbs v4, is alive
because it **stopped asking humans to type anything** and infers edges from
folders, tags and existing links.

Tana and Anytype reviewers report the same pattern: users build an elaborate
schema and abandon it within a week. Those are review blogs, not retention
data. UNVERIFIED.

What could not be found, despite looking: a single first-person retrospective
from anyone who typed their links for months and sustained it. That absence is
itself the finding.

Design constraint this implies: never ask a human to type a relation, and ship
at most five relation types, each tied to a query someone actually runs.

---

## Q9. The Anthropic counterargument

Claude Code used RAG with a local vector DB early and removed it. Boris Cherny,
quoted secondhand and UNVERIFIED at source: agentic search "generally works
better. It is also simpler and doesn't have the same issues around security,
privacy, staleness, and reliability."

This repo's result does not contradict that so much as scope it. Agentic grep
over a **codebase** wins because identifiers are exact and the agent can
iterate. Grep over **personal prose** scored 12%, because the words in the
question are not the words in the file. Worth keeping the distinction sharp,
and worth re-testing: nobody here measured *agentic* grep, where a model
reformulates its query after a miss. Our 12% is single-shot grep. That is a
real gap in the comparison and it favors grep more than measured.

---

## Q10. The ontology, if Q2 ever reopens it

A full spec exists and was never built: 12 entity types, ~25 relations with
domain and range, bi-temporal edges following Zep/Graphiti (valid_at /
invalid_at for world time, created_at / expired_at for system time, supersede
rather than delete), plus two fields Graphiti does not ship, `epistemic_status`
(fact / intent / inferred / unverified / disputed / stale) and
`last_confirmed_at`.

Two invariants worth keeping even without a graph:
1. **Intent never self-promotes to fact.** Promotion requires evidence with
   provenance in {observed, tool_output, document}, or the user speaking in
   past tense.
2. **Staleness demotes, never invalidates.** A stale fact is surfaced as a
   question, never asserted.

Relations the pilot found were **missing** from that ontology, each with a real
example in the corpus: HAS_PROPERTY / LOCATED_AT (the largest gap by volume),
MEASURED_AT, LACKS, UNDERMINES, OBSOLETED_BY, RISK_TO, AUTHORIZED_BY,
UNVERIFIED_BY, SAME_AS / GENERALIZES, RENAMED_TO.

The relations that collapse and absorb everything are **CAUSED and CONSTRAINS**
at 39% of all extracted edges, not the ABOUT/MENTIONS fallback the ontology was
designed to guard against. 15-20% of edges have a second defensible type, which
puts an inter-annotator ceiling around 80-85%.

---

## Sources

Retrieval and graph: GraphRAG (arXiv 2404.16130, 2024), LightRAG (2410.05779),
HippoRAG (2405.14831) and HippoRAG 2 (2502.14802), PathRAG (2502.14902),
RAPTOR (2401.18059), GraphRAG-Bench (2506.02404), RAG vs GraphRAG (2502.11371),
BM25 Wins at Scale (2607.26497), Samsung AI Warsaw (2603.29875), KG quality
(2603.14828).

Memory: Mem0 (2504.19413), Zep/Graphiti (2501.13956), A-MEM (2502.12110),
Titans (2501.00663), ForgetEval (2606.15903), SAGE (2605.30711), ACE
(2510.04618), AWM (2409.07429), ReasoningBank (Google, 2025), Generative Agents
(UIST 2023).

Long context: Liu et al. (TACL 2024), RULER (Hsieh et al. 2024), NoLiMa
(ICML 2025).

Benchmarks: LoCoMo, LongMemEval (ICLR 2025), BEAM (2026), MemBench (2025),
MemoryAgentBench (2025). MemBench's capacity axis and MemoryAgentBench's
selective-forgetting axis are the two a grow-only store fails.

Theory: reason maintenance (Doyle 1979), AGM belief revision (Alchourron,
Gardenfors, Makinson 1985), Southeast University graduate KG course (Prof. Peng
Wang), progressive disclosure (2607.17598).
