# Legacy Removal Audit & Plan — Privy / Firestore / Pinecone → Cloud SQL + BigQuery

> **Status: IN PROGRESS.** This document is the durable reference for migrating medha-id off
> Privy, Firestore, and Pinecone. Future instances: read this before touching identity, auth,
> secrets, knowledge/RAG, or the background jobs. Update the checkboxes as chunks land.

## Target architecture (non-negotiable)

- **Cloud SQL (Postgres)** = live/dynamic OLTP data (users, tenants, contacts, secrets, per-feature tables, sessions).
- **BigQuery** = the deeper data warehouse Cloud SQL feeds (knowledge vectors via `VECTOR_SEARCH`, analytics, `medha_pdw`).
- **REMOVE ENTIRELY: Privy, Firestore, Pinecone** (and the cNFT/Solana stack, which exists only to namespace Pinecone).
- Embeddings stay on **Perplexity** (`pplx-embed-v1-4b`, **2560-dim**; note `.env.example` incorrectly says 3416).

## Current state (as of audit)

All three services are still **actively and deeply woven** into the live surface (all 58 `registerX`
routes in `src/index.js` + 6 started jobs). Recent Cloud SQL feature work (wall, circles, connections,
OTP login) is clean; the *rest of the platform* still runs on the legacy stack.

### Privy — nearly vestigial for auth, still the identity store
- Auth is **already covered without Privy** by HS256 JWTs: `amber-jwt.js` (`signSessionToken`) and `medha-jwt.js` (`signMedhaSession`). Live OTP logins (`/v1/auth/otp/verify`, `/v1/otp/verify`, dashboard `/v1/auth/verify`) mint these.
- Privy survives as: (1) `requireAuth` **branch 3** fallback for legacy iOS Privy tokens (`src/lib/privy.js:444`); (2) legacy routes `/auth/verify`, `/auth/onboard`, `/v1/auth/me` (`src/routes/auth.js`); (3) **tenant-owner identity store** — `customMetadata` + `TenantIndex` (3-min refresh) powering `/tenants/resolve` (amber-agent inbound hot path), `tenants.js`, `numbers.js`, `internal.js`, `tenant-email-resolver.js`, and the `resolvePrincipal` phone→DID lookups in events/personal-life/pipelines/content-seeds/partnerships/reminders.
- Jobs hardcode `MEDHA_TENANT_DID = "did:privy:cmobxrpvr…"` as default scope (cosmetic string; repoint to a Cloud SQL tenant id).
- NOTE: ~40 files match a broad `privy` grep but only import `requireAuth`/`normalizePhone` (util) — not SDK consumers. `getUserByPrivyDid` is a **Firestore** fn, not Privy.

### Firestore — the deep one (primary OLTP store for most DID-keyed data)
- Core: `src/db/firestore.js` (`users`, `agent_data/{did}/{table}/{row}`, `agent_log`), `src/db/secrets.js` (v1 bag `secrets/{did}`), `src/secrets-v2/store.js` (`tenant_secrets_v2`/`tenant_deks`/`tenant_secret_audit`), `src/db/user-store.js` (profile/onboarding/personality/permissions/audit).
- Consumers: identity/profile (auth, onboarding, profile, bio, privacy, internal, identity-summary, chat, me-people-rank); generic memory store `agent_data`/`agent_log` (~20 routes + all 5 jobs); **secrets v1 (all OAuth tokens)** + v2; per-feature stores (reminders, push-tokens, slack-links, pending-oauth, partnerships, personal-life, pipelines, content-seeds, `lib/otp-store.js`, people-rank-feedback); OAuth analytics subcollections; `db/tenant-pinecone-ref.js`.
- Already migrated OFF Firestore (do not touch): `events/events.js` → BigQuery; contact **write/list/rank/page** → Postgres (`db/client.js`); `conversation-store.js` → Postgres.

### Pinecone — all knowledge/RAG vectors
- Modules: `src/knowledge/pinecone-client.js` (`tenant-<did>` namespace — **the only read/write path**). `src/lib/pinecone.js` (legacy `cnft:<mint>`) and `src/knowledge/dual-write.js` are **deleted**; their data was migrated into the DID namespaces and the `cnft:` namespaces removed from the index.
- Active reads/writes: ingest, ingest-imessage, knowledge, admin-knowledge, ask→peoplerank, me-people-enrich, forget-and-snapshot, all 5 jobs, and the `knowledge/*-index.js` modules (contacts/events/personal-life/author-voice/content-seed/partnerships/pipelines/relationship-snapshot/people-rank/contact-edges).
- Replacement: **BigQuery vector table + `VECTOR_SEARCH`**, keyed `(did, id)`, `embedding ARRAY<FLOAT64>[2560]` + metadata (kind, source, health_dimension, visibility, trust, text, created_at, person). Migrate from the `tenant-<did>` namespace (now authoritative; the `cnft:*` namespaces are gone).

## Bugs surfaced by the audit (load-bearing)
1. **Contacts split-brain (correctness):** `upsertContact`/`listContacts` write/read **Postgres**, but `findContactByName/Phone/Handle`, `findContactByEmailAcrossTenants`, `updateContactContext`, `updateContactRelationship`, `deleteAllContacts` still read the **Firestore** `contacts` subcollection that is no longer written → likely stale/null for agent contact lookup + reminder handle resolution. **Fix before Firestore teardown.**
2. `db/firestore.js#upsertUser` writes the **unprefixed** `"users"` collection while readers use `collectionName("users")` — mismatched on prefixed deployments.
3. `.env.example` embedding dims say `3416`; real index (`amber-people`) + code default is `2560`.

## Infrastructure / surrounding
- **Deps to remove:** `@privy-io/server-auth`, `@google-cloud/firestore`, `@pinecone-database/pinecone`; with cNFT teardown: `@metaplex-foundation/*`, `@solana/web3.js`, `bs58`; verify `drizzle-orm` (schema in `db/schema.js`).
- **Keep:** `@google-cloud/bigquery`, `@google-cloud/cloud-sql-connector`, `pg`, `postgres`, `@google-cloud/pubsub` (BigQuery DLQ), `spectrum-ts` (Photon), `@modelcontextprotocol/sdk`, `@google-cloud/secret-manager` (verify consumer).
- **Env remove:** `PRIVY_*`, `GCP_PROJECT_ID` (Firestore) + `FIRESTORE_COLLECTION_PREFIX`, all `PINECONE_*`, `SOLANA_*`/`AMBER_MERKLE_TREE`/`AMBER_COLLECTION_MINT`.
- **Env keep:** `AMBER_SQL_*`, `DATABASE_URL`, `MEDHA_JWT_SECRET`, `AMBER_JWT_SECRET`, `PERPLEXITY_*`, `GOOGLE_APPLICATION_CREDENTIALS_JSON` (BigQuery uses same creds), secrets KEK (repoint at Cloud SQL).
- **Cloud SQL flavors present:** `db/client.js` (porsager `postgres`, `DATABASE_URL`), `db/sql.js` (`pg` + connector, `AMBER_SQL_*`), `db/store.js`. **BigQuery:** `pdw/bq-client.js` (+ `bq-dlq.js`, Pub/Sub DLQ).
- **Jobs** (repoint to Cloud SQL + BigQuery): memory-consolidator, relationship-snapshot, contact-edges, people-rank, drift-detector (Firestore `agent_data`/`agent_log` + legacy Pinecone); reminder-worker (Firestore only).

## Removal plan (ordered, each a shippable chunk)

- [x] **Chunk 0 — Delete dead modules** (task #19). DONE. Deleted `knowledge/file-content-index.js`, `knowledge/visual-content-index.js` (+test), `scripts/pinecone-backfill.js`; stripped Pinecone comments in `me-people-rank.js`.
- [x] **Chunk 1 — Fix contacts split-brain** (task #20). DONE. Firestore contact resolvers repointed to Postgres; `metadata.relationship` re-surfaced in rowToContact.
- [x] **Chunk 1.5 — Unify Postgres** (task #23). DONE. Two Postgres DBs discovered; killed the dead Railway DB (`DATABASE_URL`/`db/client.js`/`amber_v1_schema.sql`), everything now on Cloud SQL `amber` (`db/sql.js`). Removed `postgres` (porsager) dep.
- [x] **Chunk 2 — Privy → Cloud SQL identity** (task #21). DONE (2a+2b). Added `users.privy_did` / `loop_sender_id` / `tenant_metadata`; backfilled 9 tenants from Privy; `TenantIndex` now Cloud-SQL-backed; `/tenants/resolve` off Privy. `resolveAmberIdByPrivyDid` bridge lets DID-keyed callers resolve `amber_id`.
- [ ] **Chunk 3 — Drop Privy auth** (task #13). Remove `requireAuth` branch 3 + retire `auth.js` legacy routes. **GATED on iOS shipping JWT-only (auth track: Phase B Apple/Google → Phase C iOS onboarding).** Also still-on-Privy: `getUserByDid`/`setUserMetadata`, `listAllUsers`, `/v1/tenants/by-email`.
- **Chunk 4 — Firestore → Cloud SQL**, split into:
  - [x] **4a — profile/identity** (task #24). DONE. `user-store.js` profile/onboarding/personality/permissions/audit → amber tables; added `users.profile_extra jsonb`; `getOrCreateUser` now get-only; privacy-tier read repointed to amber. `getUserByPrivyDid`/`upsertUser` (legacy cNFT/agent-data doc) still Firestore.
  - [ ] **4c — secrets** (task #25). v1 bag (`db/secrets.js`) + v2 DEK (`secrets-v2/store.js`) → Cloud SQL. Data migration: copy ciphertext/wrapped-DEKs WITHOUT decrypting; keep AES-GCM + KEK in env. Split 4c-i (v1) / 4c-ii (v2). ~20 v1 consumers (OAuth callbacks/scrapers/connections).
  - [ ] **4d — per-feature stores** (task #26). reminders, push-tokens, slack-links, pending-oauth, partnerships, personal-life, pipelines, content-seeds, `lib/otp-store.js` → Cloud SQL.
  - [ ] **4b — agent_data/agent_log** (task #27). Generic memory store (`firestore.js`) → new Cloud SQL tables; ~20 routes + 5 jobs. Biggest/most cross-cutting — do last. Fix `upsertUser` prefix bug when retiring the Firestore user doc.
- [ ] **Chunk 5 — Pinecone → BigQuery vectors** (task #17). `VECTOR_SEARCH` adapter; migrate the `tenant-<did>` namespace; validate recall before cutover. **Simplified:** the dual-client split is gone, so there is one namespace to migrate instead of two.
- [~] **Chunk 6 — Retire cNFT/Solana** (task #22). **Namespace/permission role removed** (Pinecone Phase 2 + 3 landed): no `cnft:` namespace, no `cnft_required` gate, cNFT is identity-only. Remaining: delete the Solana/Bubblegum mint path itself (`src/routes/identity.js`), which is still live and out of scope here.

**Progress: 0, 1, 1.5, 2, 4a shipped; Pinecone Phase 2 + 3 landed (single DID-keyed client). Next: 4c → 4d → 4b, then Chunk 3 (after iOS auth), then 5 → 6.
Migration-heavy (data export/import): 4c, 5. Pure deletion: 6. Dependency: Chunk 3 waits for iOS auth (Phase B/C).**

## Net-new features (built directly on the target stack, not part of the removal)

- **Amber Q&A — Phase 1** (`db/migrations/20260727_add_question_threads.sql`). Added Cloud SQL (amber DB)
  tables `questions`, `question_threads`, `thread_messages`, `answers` — owner-scoped by `users.amber_id`,
  with `network` answers reusing the wall_posts visibility model and surfacing in the connections feed. No
  Firestore / Pinecone / Privy. Store `db/questions-store.js`, routes `routes/questions.js`. Phase 1 is data
  + endpoints only; the Amber LLM reply and push notifications are later phases.
  - **Collision fix** (`db/migrations/20260727_fix_questions_collision.sql`). The Phase 1 `CREATE TABLE IF
    NOT EXISTS questions` silently no-op'd against a pre-existing legacy iMessage "daily questions" table
    (`questions` id/body/category/active/sort_order + sibling `question_deliveries`), so our columns/FKs were
    wrong and all Q&A writes failed. **Decision: the daily-question feature was stripped entirely.** The fix
    migration drops the legacy `questions`/`question_deliveries` tables (guarded on the legacy `questions.body`
    column so re-runs are safe) and rebuilds the Phase 1 schema. Code removed: daily-question store fns in
    `db/store.js` (`getQuestionBySortOrder`/`closeAwaitingDeliveries`/`createDelivery`/`getAwaitingDelivery`/
    `createFollowupDelivery`/`appendDeliveryAnswer`; `getActiveUsers` kept — generic) and the daily-question
    capture branch + `chooseFollowup` helper in `routes/photon-webhook.js`; `POST /internal/daily-question/send`
    now returns 410 `daily_questions_disabled`. **Photon/iMessage transport preserved** — the inbound webhook
    (`/webhooks/photon/inbound`), Spectrum outbound client, tenant/identity resolution, and all general agent
    message handling are untouched.
