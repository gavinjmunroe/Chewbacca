# Pinecone backfill scripts (Tab 21)

Re-embed legacy Firestore rows into each tenant's Pinecone namespace so data
created before the indexing pipelines existed becomes semantically searchable
via `/knowledge/query`.

## What gets backfilled

| Script                      | Firestore source                                                  | Indexing path                           |
| --------------------------- | ----------------------------------------------------------------- | --------------------------------------- |
| `backfill-personal-life.js` | `brand_decisions`, `teammate_pursuits`, `journal_entries`         | `indexPersonalLifeRow`                  |
| `backfill-contacts.js`      | `users/{did}/contacts`                                            | `indexContact`                          |
| `backfill-pipelines.js`     | `pipeline_investors`, `pipeline_events`, `pipeline_relationships` | `indexPipelineObject`                   |
| `backfill-partnerships.js`  | `partnerships`                                                    | `indexPartnership`                      |
| `backfill-content-seeds.js` | `content_seeds`                                                   | direct `embed` + `upsert` (Tab 17 TODO) |
| `backfill-all.js`           | runs all of the above sequentially                                | all                                     |

Tenants are enumerated via `listRefs()` (the `pineconeRefs` collection), the
same source the rest of the Pinecone layer uses. Each script iterates every
ref, so one run covers the whole fleet.

## Run

```bash
# Dry run first: counts what would be indexed, embeds nothing, writes nothing.
node scripts/backfill-all.js --dry-run

# Real backfill (idempotent, safe to re-run).
node scripts/backfill-all.js

# Or run a single collection.
node scripts/backfill-personal-life.js --dry-run
```

## Required env

- `PINECONE_API_KEY`
- `PERPLEXITY_API_KEY` (the embedder is Perplexity `pplx-embed-v1-4b`, 2560-dim)
- `GCP_PROJECT_ID` + Google credentials for Firestore
  (`GOOGLE_APPLICATION_CREDENTIALS_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`)

If Pinecone or the embedder is unavailable, each row degrades gracefully
(counted as `failed`, never crashes the run) because the underlying
`src/knowledge/*` index functions never throw.

## Idempotency

Every vector uses a deterministic id (`"<kind>:<sourceId>"`), the same id the
live index modules write. Re-running overwrites in place, so there are never
duplicates. There is no separate skip pass; a re-run simply re-embeds and
overwrites.

## Tests

```bash
node --test scripts/lib/backfill-runner.test.js
```

Unit tests cover batching, dry-run, concurrency bounds, error tallying, and the
totals merge with an injected fake `indexOne` (no network, no credentials).
