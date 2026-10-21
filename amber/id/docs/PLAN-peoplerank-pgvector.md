# PLAN — PeopleRank fast retrieval via pgvector (medha-id)

> ⚠️ **INTERIM / STOPOVER DECISION — REVISIT BEFORE TREATING AS FINAL.**
> This is a good-enough approach to make the current solution faster now. It is
> NOT the final, researched answer. Before committing to it as the permanent
> retrieval architecture, do a deeper, scholarly pass: compare pgvector HNSW vs
> alternatives (dedicated vector DBs, hybrid lexical+vector, learned sparse
> retrieval, graph-aware ranking), embedding-model choices and dimensionality,
> and whether the ranker should own a stateful index instead. Karthik asked to
> flag this explicitly and go deeper later — do not let this doc silently become
> the permanent design.

Status: interim proposal for review. No code until approved.

## 1. The problem, precisely

Today every ranking is a **cold, full-network re-rank**. In `chat.js`, the
`network_query` / `both` path calls `preparePeopleRankInput`, which:

1. Loads **all** of the owner's contacts from Postgres (967 for the first tenant),
2. Batch-loads every contact's resolved facts,
3. Maps the entire set to `ContactIn` and ships **all of it** over HTTP to the
   external `togari-search` service (`enrichment/togari-search-rank.js`),
4. which ranks all 967 from scratch and, with Stage-3 answer synthesis on, takes
   ~6s before useful output (~1.3s with `answer=false`).

There is no persistent index. Nothing is precomputed. The 7s cutoff I added is a
guard rail on this, not a fix.

## 2. Target architecture

Precompute an embedding per contact **once** (on write), store it in a pgvector
index on Cloud SQL, and at query time do an indexed similarity search to pull the
top-K relevant people. The ranker then sees a small, already-relevant set instead
of the whole address book.

```
write path:   contact / fact / note changes ──► (re)embed contact ──► store vector
query path:   query text ──► embed ──► pgvector top-K (owner-scoped) ──► rank only K
```

Retrieval becomes an indexed ANN lookup (single-digit ms) instead of a full scan
plus a cold external re-rank. The external ranker still does the smart scoring and
answer, but over ~40 candidates, not 967, so its cost collapses too.

## 3. Schema and migration

pgvector's HNSW/IVF indexes cap indexed columns at **2000 dimensions**, and our
vectors are **2560**. So we use `halfvec` (16-bit, pgvector ≥ 0.7.0), which
supports up to 4000 dims with HNSW and is a natural fit since the source vectors
are already int8-quantized (minimal precision loss).

```sql
CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector >= 0.7.0 required

CREATE TABLE contact_embedding (
  owner_id     BIGINT      NOT NULL,
  contact_id   BIGINT      NOT NULL,
  embedding    halfvec(2560) NOT NULL,
  content_hash TEXT        NOT NULL,     -- sha256 of the embedded text; skip re-embed if unchanged
  model        TEXT        NOT NULL,     -- 'pplx-embed-v1-4b' for future re-embeds
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, contact_id)
);

-- Owner-scoped ANN. Cosine matches the Perplexity vectors' normalized space.
CREATE INDEX contact_embedding_hnsw
  ON contact_embedding
  USING hnsw (embedding halfvec_cosine_ops);
```

Notes:
- A separate table (not a column on `contacts`) keeps the ranking concern out of
  the OLTP hot path and lets us drop/rebuild the index without touching contacts.
- `content_hash` makes re-embedding idempotent: if the composed text hasn't
  changed, we skip the Perplexity call entirely.
- Confirm Cloud SQL's pgvector version supports `halfvec` before we commit; if it
  is pinned below 0.7.0, the fallback is dimensionality reduction to ≤2000, which
  I'd rather avoid.

## 4. What we embed (per contact)

One composed document per contact, so a single vector captures who they are:

```
{full_name}
{title} at {company} · {city}
Notes: {contact notes joined}
Facts: {resolved contact_facts joined, newest first, capped ~40}
```

Compose deterministically, hash it, embed only if the hash changed. This is the
"relational mapping" part: a person's vector is the sum of everything you've said
about them, so "who's good at resolving conflicts" lands near contacts whose facts
mention mediating, calm, level-headed, etc. — even without that exact word.

## 5. Backfill

One-off admin job to embed all existing contacts:
- Pull contacts + facts per owner, compose text, `embedMany` in batches of 96
  (the lib's `MAX_BATCH`), upsert into `contact_embedding`.
- 967 contacts ≈ 11 batches ≈ a handful of seconds of Perplexity calls per tenant.
- Idempotent and resumable via `content_hash`.
- Guard behind an admin route or a one-shot script, not a request path.

## 6. Query-time retrieval + integration

New `retrieveTopK(ownerId, queryText, k = 40)` in a store module:
```sql
SELECT contact_id
FROM contact_embedding
WHERE owner_id = $1
ORDER BY embedding <=> $2::halfvec   -- cosine distance, HNSW-accelerated
LIMIT $3;
```
In `chat.js`, before calling the ranker: embed the query, get the top-K ids,
load only those contacts + facts, and pass that reduced set to
`preparePeopleRankInput` / `streamRank`. Everything downstream is unchanged; the
ranker just receives fewer, better contacts.

Fail-open: if retrieval errors or returns nothing (e.g. a brand-new owner with no
embeddings yet), fall back to the current full-set path so we never regress.

## 7. Informed voice replies (the correction I owe)

Separate from search. A voice journal note ("Eli is moving") should NOT run the
network search, but the reply should still know who Eli is. So in the voice path:
after capture resolves the mentioned people to contact ids, do a **direct** fact
lookup by id (already indexed by PK, single-digit ms) and feed a short context
block into the reply prompt. No embeddings, no ranker, just "here's what you know
about Eli, Josh, Spencer." Fast and informed.

## 8. Index maintenance (keeping it fresh)

Re-embed a contact when its inputs change:
- On fact/note write for a contact, and on contact profile edits, enqueue a
  re-embed (compose text, compare hash, embed if changed, upsert).
- Do it fire-and-forget off the write path so it never adds latency to the user's
  action. A missed update just means the vector is briefly stale, self-heals on
  the next write or a nightly sweep.
- Optional nightly reconcile job to catch anything dropped.

## 9. Quick win, shippable independently

Set `answer=false` on the ranker call for contexts that only need the ranked
people (not a synthesized paragraph): ~1.3s vs ~6s. Independent of the index.

## 10. Rollout and safety

- Feature flag (e.g. `PEOPLERANK_VECTOR_PREFILTER=1`) so we can enable per env and
  instantly fall back to the full-set path.
- Fail-open everywhere: any embed/retrieval error → current behavior.
- Keep the 7s cutoff purely as a last-resort safety net; with the index it should
  effectively never fire.

## 11. Expected latency

- Retrieval (pgvector HNSW, owner-scoped, 1k vectors): ~1–5ms.
- Query embed (Perplexity, one string): ~150–400ms.
- Ranker over ~40 contacts with `answer=false`: sub-second; with answer: ~2–3s.
- Net: people-search goes from ~6s cold to well under 1s for the ranked list,
  with the answer streaming after if requested.

## 12. Open questions to confirm before building

1. Cloud SQL pgvector version — does it support `halfvec` (≥ 0.7.0)? Decides
   whether we use halfvec(2560) or reduce dimensions.
2. Perplexity embedding cost/rate at your contact volume for backfill + ongoing
   re-embeds — acceptable, or do we cache more aggressively?
3. Top-K value (start at 40) and whether to also keep a small always-include set
   (favorites / most-recent) so a thin query never misses an obvious person.
4. Exact column names in `contacts` / `contact_facts` / `contact_notes` to wire
   the composer (confirm at implementation against `db/store.js`).

## 13. Task breakdown (once approved)

1. Migration: extension + `contact_embedding` + HNSW index (confirm halfvec).
2. Composer + hashing util (compose text, sha256, skip-if-unchanged).
3. Backfill admin script (batched embedMany, resumable).
4. `retrieveTopK` store fn + query-embed helper.
5. Wire top-K pre-filter into the `chat.js` ranker path behind the flag.
6. Direct-fact context for voice replies.
7. Write-path re-embed hooks (facts/notes/profile) + nightly reconcile.
8. `answer=false` quick win.
9. Verification: latency benchmark before/after, fail-open tests, flag off/on.
