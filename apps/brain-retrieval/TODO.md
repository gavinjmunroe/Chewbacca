# TODO

Ordered by (measured impact / effort). Every item has an acceptance criterion
that is a number or a demonstrated refusal, because this repo's parent kit has
three logged incidents of a thing being built, reported done, and never
actually running.

**The rule for every item here: tune on `bench/queries.json` (25 dev), report
on `bench/queries_independent.json` (73 sealed). Running the sealed set more
than once per change is how 68% becomes a fictional 80%.**

---

## P0, wiring. Done 2026-10-09 except the skill

`brain-recall.sh` calls `brain ask` on every prompt, `~/.local/bin/brain`
links to `src/brain.py`, and launchd keeps the index fresh. What is left is
item 1's skill file.

### 1. Ship `brain` as a skill, not an MCP server
The retriever works and nothing calls it. MCP tool schemas load into every
session whether used or not; a CLI behind a skill costs ~60 tokens standing.
- Write `skills/brain/SKILL.md`, name plus description only, body holds the CLI contract.
- Symlink `src/brain.py` to `~/.local/bin/brain`. Not a copy. A Sept 5 copy of
  `hud-listen` sat in `~/.local/bin` passing zero flags for two weeks.
- **Accept:** a session with no prior context answers "what did Joel George say
  about loneliness" by calling `brain ask` and citing the file. Prove it in a
  transcript, do not assert it.

### 2. Cut the always-on context using the retriever
~28k tokens load every session. Measured proposal is 6.6k, a 76% cut.
- Keep eager: the enforcement rules (writing, untrusted-content, do-it-yourself,
  git, security). A rule that fires only when retrieved fails silently the one
  time it mattered.
- Retrieve on demand: `core/{identity,now,people,voice}`, `memory/MEMORY.md`.
- SessionStart hook emits a ~900-token digest, not an `@import`, because an
  import is static text and cannot say `index=STALE(3)`.
- **Accept:** measured startup token count under 10k, and a held-out set of 20
  questions previously answered from eager context still answered correctly.

### 3. Incremental indexing. DONE 2026-10-09
`brain index` now re-embeds only changed files (4.7s for 20 changed, 175
removed) and launchd runs it every 10 minutes. Renames still re-embed, because
the path is part of the embedded text. The spec below is kept for history.

Full rebuild is 85s. A one-file change should be ~175ms. Design measured and
specced: hash with blake2b-128, prefilter on (mtime, bytes), rechunk and
re-embed only changed files, rematerialize `emb.npy` in ~20ms.
- mtime is a hint, never the authority. Git checkouts rewrite it without
  changing bytes.
- A new path whose sha matches a vanished path is a **rename**: update the path,
  re-embed nothing.
- **Accept:** `brain index --file X` completes under 300ms for a median file and
  `brain status` reports zero stale.

### 4. Query cache plus keep_alive. PARTLY DONE 2026-10-09
keep_alive is 2h, and a timed-out ask starts a detached warm-up instead of
aborting the load forever (findings/RESULTS.md). No query cache yet.

Query embedding is the only unreliable cost: warm p50 12ms, cold ~90ms,
model-not-resident 460ms. Cache query vectors keyed on the normalized string.
`keep_alive` is `2h` in `src/brain.py` since 2026-10-09.
- **Accept:** p90 end-to-end under 300ms across 50 real queries, and the 120ms
  timeout path demonstrably returns lexical results with `degraded=embed_timeout`
  in the header. Force it by stopping ollama mid-run.

---

## P1, worth doing, measurable

### 5. Beat 68%. Mostly done, and mostly negative.
Ablations ran. Full table in findings/RESULTS.md. Summary of what is now closed:
- **Context prefix: keep it.** Stripping `filepath | frontmatter description`
  costs 12 points. It was the most suspicious choice in the harness and it
  turned out load-bearing in the opposite direction.
- **Embedding model: do not bother.** mxbai-embed-large, embeddinggemma and
  all-minilm were all a wash or worse on recall@5. Bigger models move MRR and
  leave the top-5 set alone.
- **Chunk size: do not shrink.** 75 words looks like +20 on dev against the
  untuned baseline and loses 10 points on the sealed set against the tuned one.
  Small chunks and mean aggregation are substitutes. See the chunk-size trap.
- **Task prefixes: no.** +4 on the coarse baseline, negative once chunks shrink.

Still open and still worth trying:
- **A real cross-encoder rerank.** Only a BM25 reorder of vector top-20 was
  tested (+8 on the untuned baseline, 0 once tuned). No cross-encoder was run.
- **Query expansion / agentic retry.** The measured grep number is single-shot.
  Nobody tested letting the retriever reformulate after a miss, which is the
  mechanism Anthropic's agentic-search argument actually rests on.
- **Accept:** any change must beat 68% on the sealed set, not on dev. Four
  variants tied at 80% on dev and spread across 10 points on the sealed set.

### 6. Fix the 16 broken wikilinks and the contradiction regex
`bench/graph0.py` found 1,495 resolved links and 16 broken. Separately its
CONTRADICTS count of 0 is a **bug in the matcher, not a property of the
corpus**: the regex is same-line, and `> [!contradiction]` callouts span lines.
16 callouts exist, 7 have a link in the block.
- **Accept:** broken count is 0, and the callout matcher reports 7.

### 7. Build the eval set from the corrections that already exist
The parent kit has a backlog item reading "Close the learning loop. The score
has never moved." Every `feedback_*.md` file is a logged failure with a known
correct behavior and a date. That is a labeled dataset sitting unused.
- Turn each into one case: the query the agent would face, the expected behavior.
- Score **index-hit separately from answer correctness**. Conflating them is the
  most common error in this literature.
- **Accept:** a score that moves when the retriever changes.

### 8. Duplicate detection at write time, lexical only
291 memory files and growing, nothing merges. Jaccard over H1 plus first 200
chars against every existing memory file; refuse at >= 0.55.
- **Lexical, not embedding.** An ollama call inside a PreToolUse hook fails open
  on timeout, and a gate that fails open is exactly the shape of the guard that
  shipped 12 bad outputs.
- **Accept:** the hook refuses a deliberately duplicated file, exits 2, and a
  sibling benign write exits 0. Both in CI.

---

## P2, specced but unproven, do not start without re-reading the evidence

### 9. Staleness surfacing
Per-relation decay (status 7d, roles 45d, enrollment 120d, beliefs 365d,
evidence never). Surfaces at most 3 per session, **as questions, never as
facts**, snoozed 14 days whether answered or not. Never auto-deletes.
Motivated by `core/now.md` going 36 days stale and asserting things that had
stopped being true.

### 10. Frequency promotion
When k>=3 notes cluster on one lesson, collapse to one rule with the originals
as evidence. Trigger on a shared edge target, widened by cosine >= 0.82, never
similarity alone. Nightly scan writes a proposal; a human applies it.
Nothing mainstream does frequency-threshold promotion, so this is genuinely
novel and correspondingly likely to be wrong.

### 11. Atomic rename
`brain-rename <old> <new> --dry-run`. Filename, frontmatter, index line, and
every backlink change together or the tree rolls back to the pre-run sha.
Index lines must **lead with the new name and keep the old one** so both resolve.

---

## Do not build

- **A typed relation ontology.** Falsified. Shuffled labels tied hand-curated
  ones across three seeds. Cost would have been ~$10 and a week.
- **Bare 1-hop graph expansion.** Null by construction at boost 0, and drops
  recall to 48% then 12% as the boost grows. Independently reproduces
  HippoRAG's Table 5 ablation.
- **PPR on top of tuned retrieval.** Flat recall, join metric 17% to 6%.
- **GraphRAG / LightRAG / PathRAG.** $3-15 per reindex at a scale where they
  lost to TF-IDF in published benchmarks.
- **Pinecone or any hosted vector DB.** 1,536 vectors. Brute force is 0.027ms.
- **sqlite-vec.** Pulling the BLOBs out of SQLite costs 6.1ms, which is 220x the
  entire dot product. Revisit at 500k vectors.
- **float16 vectors.** Halves the file, multiplies search cost by 130, because
  there is no f16 BLAS path on this machine.
- **Blocking a `[[link]]` to a file that does not exist.** An unwritten target
  is a to-do and is correct. This would fire on the most common good action.
- **"Number with no source" checks.** Most numbers in `core/` are his own.
  Sounds strongest, would be the loudest false positive.

---

## Found 2026-10-09

### Hub files win unrelated queries
Live sealed recall@5 is 50.8% on 701 files, against 68% on 476 in September.
Most misses lose to two long folders under `domains/`,
long files that rank top 3 for questions they do not answer.
- Try on dev only: chunk-count normalisation under mean aggregation, a per-folder
  cap in the top 5, and a BM25 length penalty.
- **Accept:** beats 50.8% on the sealed set, run once.
