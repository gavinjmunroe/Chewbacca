---
name: medha-id-storage
description: "amber-id is Cloud SQL Postgres ONLY as of 2026-09-01. Karthik ripped out Firestore, Pinecone and Privy; pgvector replaced the vector store. The hybrid rule is retired."
metadata:
  node_type: memory
  type: reference
  originSessionId: 1a499739-b315-4591-98f9-06a8e52ff881
  modified: 2026-09-03T00:00:00.000Z
---

**Verified 2026-09-03 against `amber-id` main (live, `/status` healthy).** The
July "hybrid Cloud SQL + Firestore" note below is retired.

Karthik's 2026-09-01 commit *"Rip out Pinecone, Firestore and Privy. Cloud SQL
is the only store"* deleted 16,044 lines across 157 files. No import, env var or
dependency for any of the three survives in `src/` or `scripts/`.

- **One store: GCP Cloud SQL Postgres**, reached with
  `@google-cloud/cloud-sql-connector` in `src/db/sql.js` via
  `AMBER_SQL_CONNECTION_NAME`.
- **Vectors are in Postgres now.** `observations.embedding` is
  `halfvec(1536)` with an HNSW cosine index; `retrieval.js` does hybrid
  semantic + lexical search blended by `scoring_params.semantic_alpha`. That
  replaced the external knowledge-graph HTTP service that had replaced Pinecone.
- **Auth is OTP against the Cloud SQL `otp_codes` table.** Privy was already
  nearly dead. The Solana cNFT surface went with it.
- **The schema is 71 tables**, in one dated migration series `20260828_001`
  through `20260901_028`.
- BigQuery survives in exactly two places, both sidecars, not the store:
  `src/pdw/bq-client.js` (Caleb's fire-and-forget `medha_pdw` analytics dataset,
  GCP project `midyear-glazing-485303-u3`) and `src/embeddings/embeddings.js`.
- **Compute is still Railway** (`railway.toml`, NIXPACKS). Only the data is on
  GCP. Do not describe amber-id as "running on GCP".

**How to apply:** all persistence in amber-id is one Postgres database. Add a
dated file to `db/migrations/`. Do not reach for Firestore, Pinecone or Privy;
they are gone, and code referencing them is stale.

Related: [[project_amber_circles_architecture]], [[project_medha_tenancy_architecture]],
a private note, [[project_amber_vision]]
