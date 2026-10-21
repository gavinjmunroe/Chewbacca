# Pinecone Migration Plan

**Owner:** Caleb Newton + Karthik
**Repo:** `amberintelligence/medha-id`
**Status:** Plan (no code in this PR). Author this doc, get sign-off, then file follow-up issues that execute each phase.
**Date:** 2026-05-28

---

## Decisions already confirmed

These are not up for debate in this doc. They are recorded so the rest of the plan reads against a fixed frame.

1. **Medha intelligence lives in Pinecone. Structured user info lives in GCP / Firestore.** Karthik's verbatim (2026-05-27): "For Medha I'd like user information in there. So if there's a reference in GCP to the instance in Pinecone that's chill. Yup exactly. Key value pairing type of thing."
2. **Each tenant gets one Pinecone namespace, keyed by Privy DID.** Already implemented: `namespaceFor(did)` in `src/knowledge/pinecone-client.js:61` returns `tenant-<lowercased-did-with-colons-as-hyphens>`.
3. **The link between GCP and Pinecone is `pineconeRefs/{did}`.** Already implemented in `src/db/tenant-pinecone-ref.js`. A row appears the first time a tenant ingests a vector. No PII, no secrets, just a pointer.
4. **Medha is the playground. Capabilities port to Togari once they're proven.** Implication for this plan: every new data path we touch should stay platform-neutral (no Medha-specific schema). Togari should be able to reuse `src/db/firestore.js`, `src/knowledge/pinecone-client.js`, and `src/db/tenant-pinecone-ref.js` without forks.

---

## Executive summary

The migration is partly in flight. Phase 1 (dual-write to legacy cNFT-namespaced and new DID-namespaced Pinecone) already shipped in `src/knowledge/dual-write.js`. Phases 2 and 3 (swap reads, drop legacy) remain, plus a small set of routes that still write to the legacy client only and need to move onto `dualUpsert` first.

GCP keeps the rows it already holds (user identity, secrets bag, OAuth state, contact mirror, agent_data and agent_log namespaces, BigQuery `medha_pdw` group/event ledger). None of those move. Pinecone gains: the vectors it already holds via the new DID client, plus any future semantic-recall use case. The split is durable; this doc is mostly about finishing what's in flight and writing down the contract so Togari and future tabs build against the same model.

---

## Audit: what's in GCP today

Walk of `src/db/`, `src/routes/`, and `src/pdw/`. Every persisted collection, with one-line "what it stores" and a classification.

### Firestore — `users` collection (and its sub-collections)

| Path                               | What it stores                                                                                                                                                    | Classification                   | Why                                                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users/{did}`                      | Canonical user doc: `id`, `privyUserId`, `privacyTier`, cNFT fields (`cnftMint`, `cnftAssetId`, `cnftTxSignature`, `cnftMerkleTree`, `cnftMintedAt`), timestamps. | STAYS IN GCP                     | Primary key lookup by DID. Read on every authed request. No semantic shape.                                                                                          |
| `users/{did}/profile/main`         | Display name, phone, contextRepo, onboardingProfile, agent name.                                                                                                  | STAYS IN GCP                     | Structured KV. Read on every transport identity resolution.                                                                                                          |
| `users/{did}/onboarding/progress`  | `currentStep`, `stepsCompleted` map.                                                                                                                              | STAYS IN GCP                     | Stepper state. KV by definition.                                                                                                                                     |
| `users/{did}/personality/{type}`   | Per-type personality profile records.                                                                                                                             | STAYS IN GCP                     | Typed structured record. Could be dual-written later if we want "find users with similar personalities" search; not needed today.                                    |
| `users/{did}/permissions/{field}`  | Field-level sync flag (`syncEnabled` per field type).                                                                                                             | STAYS IN GCP                     | Authorization data. Must be exact-match and synchronous. Never semantic.                                                                                             |
| `users/{did}/audit/{autoId}`       | Permission change audit log entries.                                                                                                                              | STAYS IN GCP                     | Append-only ledger. Time-ordered, not semantic.                                                                                                                      |
| `users/{did}/contacts/{contactId}` | Per-tenant address book (Apple Contacts, LinkedIn, etc.). Includes `phoneNumbersNormalized` for by-phone lookups.                                                 | DUAL-WRITE (already implemented) | Firestore is source of truth for the row; Pinecone gets the embedded text via `src/knowledge/contacts-index.js` for "who in my contacts works on X" semantic search. |

### Firestore — other top-level collections

| Path                         | What it stores                                                                                                                              | Classification | Why                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------- |
| `tenants/{loopSenderId}`     | Tenant resolution by Loop sender id (transport mapping).                                                                                    | STAYS IN GCP   | Phone-to-DID and sender-to-DID lookup. Hot path on every inbound webhook.                                   |
| `secrets/{did}`              | AES-256-GCM encrypted per-tenant secrets bag (OAuth tokens, LinkedIn cookies, OAuth client_id/secret per platform).                         | STAYS IN GCP   | Encrypted at rest, key-name-addressable, never logged. Cannot live in a vector store.                       |
| `pineconeRefs/{did}`         | The KV pointer table from DID to Pinecone namespace + index + dimension + ingest stats.                                                     | STAYS IN GCP   | This IS the join key Karthik specified. Without it, Pinecone is dark on what tenant a namespace belongs to. |
| `pending_oauth/{stateToken}` | Transient OAuth state (DID, platform, return_to). TTL-purged after 10 minutes.                                                              | STAYS IN GCP   | Lookup by random state token. TTL-shaped. Nothing semantic.                                                 |
| `slack_links/{team:user}`    | Slack `(team_id, user_id)` to `person_id` + `phone_e164` binding. Set after the user replies with their phone or after auto-bind via email. | STAYS IN GCP   | Identity binding. Hot path on every Slack inbound. KV lookup.                                               |

### Firestore — `agent_data` (generic per-tenant jsonb-style store)

`agent_data/{did}/{table}/{rowKey}` is a Firestore-backed equivalent of a JSONB column scoped per tenant. Tables observed in code:

| Table                                                           | Producer                                            | What's in it                                                                                                            | Classification                                                                                                                                                 |
| --------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `imessage_interactions`                                         | `src/routes/ingest-imessage.js`                     | One row per iMessage / SMS interaction; dedupe_key as row id. Holds direction, role, text, sent_at, channel, dimension. | DUAL-WRITE (already implemented via legacy ingest path; needs migration to `dualUpsert` so DID-namespace gets the vector too).                                 |
| `brand_decisions`                                               | `src/db/personal-life.js`                           | Long-lived branding calls ("rytual newsletter = the rave").                                                             | DUAL-WRITE (already wired via `src/knowledge/personal-life-index.js`).                                                                                         |
| `teammate_pursuits`                                             | `src/db/personal-life.js`                           | What Shirley / Alinna / Emily are working on personally.                                                                | DUAL-WRITE (already wired).                                                                                                                                    |
| `journal_entries`                                               | `src/db/personal-life.js`                           | Freeform yapping about creative conversations.                                                                          | DUAL-WRITE (already wired).                                                                                                                                    |
| `pipeline_investors`                                            | `src/db/pipelines.js`                               | Investor pipeline rows (stage, contact, notes).                                                                         | DUAL-WRITE (already wired via `src/knowledge/pipelines-index.js`).                                                                                             |
| `pipeline_events`                                               | `src/db/pipelines.js`                               | Rytual 3-events framework rows (vipassana, everything-night, lightning-in-a-bottle).                                    | DUAL-WRITE (already wired).                                                                                                                                    |
| `pipeline_relationships`                                        | `src/db/pipelines.js`                               | Multi-thread relationship pipeline rows.                                                                                | DUAL-WRITE (already wired).                                                                                                                                    |
| `contacts`, `conversations`, `health_profiles`, etc. (open set) | `src/routes/data.js` (generic CRUD for amber-agent) | Whatever amber-agent decides to store. The CRUD route is schema-less by design.                                         | DEPENDS on the caller. The agent is responsible for calling `dualUpsert` when the row has semantic value. The generic CRUD route does not embed automatically. |

### Firestore — `agent_log` (append-only logs)

`agent_log/{did}/{table}` is append-only. One known caller today: any log row written via `agentLogInsert` in `src/db/firestore.js`. Today this is mostly used by `src/routes/data.js` for caller-defined log tables.

| Path                | Classification | Why                                                                                                                                                                         |
| ------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_log/{did}/*` | STAYS IN GCP   | Time-ordered ledger. Queried by date range, not by meaning. If a specific log table grows into a semantic-search use case later, treat it as DUAL-WRITE (its own decision). |

### BigQuery — `medha_pdw` dataset

Lifted from medha-imessage's group-memory cold path. Owned by `src/pdw/bq-client.js` and `src/events/events.js`.

| Table                                             | What it stores                                                                                | Classification | Why                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------- |
| `medha_pdw.groups`                                | Durable group container per iMessage chatGuid.                                                | STAYS IN BQ    | OLAP shape. Joined to events and messages on chatGuid.  |
| `medha_pdw.events`                                | Event rows (trip, rave, wedding, retreat, etc.) with organizer + participants by `person_id`. | STAYS IN BQ    | Structured event ledger. Joined to messages and groups. |
| `medha_pdw.event_messages` (and other PDW tables) | Append-only message rows associated with events.                                              | STAYS IN BQ    | High-volume append-only log; OLAP queries hit it.       |

**Note on BQ vs Pinecone for events**: the BQ row is the structured ledger (who organized what, who's in it, when, where). If the agent later needs semantic recall over event descriptions ("which retreats had a meditation component?"), embed the description and write it to Pinecone alongside the BQ row. Today only the structured row is written.

### Pinecone — current state

**One client.** `src/knowledge/pinecone-client.js`. Namespace `tenant-<privy_did>`.
2560-dim (Perplexity `pplx-embed-v1-4b`). It is the only read and write path.

The legacy cNFT-keyed client (`src/lib/pinecone.js`, namespace `cnft:<mintAddress>`,
1536-dim OpenAI) and the dual-write bridge (`src/knowledge/dual-write.js`) are
**deleted**. The live `cnft:` namespaces were migrated into their DID namespaces
and removed from the index, so there is nothing for a `cnft:` reader to find.

The cNFT mint is still minted and still stored on the user record as a portable
identity proof. It is no longer a namespace key or a permission key, and no
route returns a 412 `cnft_required` for knowledge access.

---

## The KV pairing model

GCP-to-Pinecone and back, in code.

### Forward: DID to namespace

Already implemented at `src/knowledge/pinecone-client.js:61`.

```js
import { namespaceFor } from "../knowledge/pinecone-client.js";

// "did:privy:abc123" -> "tenant-did-privy-abc123"
// Lowercased; ":" -> "-"; PINECONE_NAMESPACE_PREFIX applied.
const ns = namespaceFor(privyDid);
```

### Reverse: namespace to DID

Pinecone metadata stores `did` on every vector (`src/knowledge/pinecone-client.js:121`). Use it directly on any query result. No reverse lookup table needed.

```js
const matches = await pinecone.query(privyDid, vector, { topK: 10 });
// each match.metadata.did === privyDid by construction
```

### Pointer: DID to ref row

Already implemented at `src/db/tenant-pinecone-ref.js`. Idempotent — `ensureRef(did)` is safe to call on every ingest.

```js
import { ensureRef, getRef, recordIngest } from "../db/tenant-pinecone-ref.js";

await ensureRef(did); // first-write idempotent create
const ref = await getRef(did); // { namespace, indexName, dimension, vectorCount, lastIngestAt }
await recordIngest(did, { addedCount: 12 }); // updates vectorCount + lastIngestAt
```

The `pineconeRefs/{did}` row is the single source of truth for "where does this tenant's vector data live." When we eventually need a backfill or namespace migration, this table is what we iterate.

### Cross-walk for a new feature

When you build a new capability that needs both shapes:

1. Identity in: caller hands you a Privy JWT. `request.privyUser.userId` is the DID.
2. Structured fields you want fast: write to Firestore under `users/{did}/...` or `agent_data/{did}/<table>/{rowKey}`.
3. Anything you want to semantically search later: embed it and call `dualUpsert({ cnftMint, privyDid, items, log })`. `cnftMint` comes from `getUserByPrivyDid(did).cnftMint`. This is the bridge until Phase 3.
4. The `pineconeRefs/{did}` row materializes on first write. Don't manually create it.

---

## Migration phases

### Phase 1: dual-write (COMPLETE)

Implemented in `src/knowledge/dual-write.js`. Routes that already call `dualUpsert`:

- `src/routes/knowledge.js` (`/knowledge/ingest`)

Routes that still write only to the legacy client and need to move onto `dualUpsert`:

- `src/routes/ingest.js` (`/ingest/:pipe` — agent, health, checkin, relationship)
- `src/routes/ingest-imessage.js` (`/ingest/imessage`)

**Action**: file two issues, one per route file, to swap the direct `pinecone.upsert` call for `dualUpsert`. Each is a 5-line change. Both routes already resolve the DID and cnftMint, so the substitution is mechanical. Pass `request.log` so dual-write failures surface in production logs.

### Phase 2: swap reads to the DID namespace

Today reads still go through the legacy client. The semantic search routes (`/knowledge/query`, `/knowledge/query-as`, `/knowledge/imessage/search`) and the contact-search use case (Tab 9 in the tomorrow dispatch) all expect reads from the DID namespace eventually.

**Action plan**:

1. **Backfill the DID namespace from the legacy namespace** for every existing tenant. Walk `users/*`, resolve `cnftMint`, fetch all vectors from the legacy namespace (Pinecone supports `fetch` by id range or paginate via metadata), re-upsert into the DID namespace with `dualUpsert`. Re-embedding is not strictly required, but the dimension changed (1536 to 2560), so re-embedding is mandatory unless we keep both indexes in parallel forever. Re-embed via the Perplexity embedder used by the new client. Cost: bounded by number of existing vectors per tenant; budget pass.
2. **Bake-in window**: leave dual-write on for one week after the backfill completes. During this window, both namespaces receive the same writes, so we can compare read results from each on a small probe.
3. **Swap reads**: update `src/lib/pinecone.js` consumers in `src/routes/knowledge.js`, `src/routes/ingest-imessage.js` (the search variant), and any `query-as` callers to import from `src/knowledge/pinecone-client.js` instead. The two clients have parallel `query` / `forget` / `stats` signatures, so the swap is import-level.
4. **Flip the failure semantics** in `dualUpsert`: the DID write becomes authoritative, the legacy write becomes best-effort. Same kill switch (`PINECONE_DUAL_WRITE_DISABLED`) still works in reverse.

### Phase 3: drop the legacy client

After Phase 2 has run cleanly for one to two weeks:

1. Remove `dualUpsert`'s legacy branch; rename to `tenantUpsert` or fold into `pinecone-client.js`.
2. Delete `src/lib/pinecone.js` and its consumers.
3. Delete the legacy index (`amber-people`) from Pinecone admin.
4. Drop the `cnftMint` field from the dual-write call sites; resolution by DID only.

**Action**: file one umbrella issue with these four checkboxes. Do not start until Phase 2 has been stable in production for at least one week.

---

## What does NOT move

Restating, because the contract matters:

- **Tenant identity (`users/{did}` + its sub-collections except `contacts`)** stays Firestore-only.
- **Secrets bag (`secrets/{did}`)** stays Firestore-only. Vectors and secrets do not mix.
- **OAuth state (`pending_oauth/*`)** stays Firestore-only. TTL-based, transient.
- **Slack identity link (`slack_links/*`)** stays Firestore-only. Identity, not memory.
- **`pineconeRefs/{did}`** stays Firestore-only. It IS the join key; moving it to Pinecone would be circular.
- **`agent_log/*`** stays Firestore-only by default. Promote individual log tables to dual-write only if they grow into a semantic-search use case.
- **BigQuery `medha_pdw` (groups, events, event_messages)** stays in BQ. OLAP shape. If event descriptions need semantic recall, dual-write those specific text fields to Pinecone; do not move the OLAP rows.

---

## Risks

1. **Consistency between Firestore and Pinecone.** Dual-write is best-effort on the new side today. A Pinecone outage during ingest means the Firestore row exists without a matching vector. Mitigation already in place: `scripts/pinecone-backfill.js` (referenced in `src/knowledge/contacts-index.js:19` and `src/knowledge/pipelines-index.js:16`). Verify the script exists and runs cleanly; if not, file an issue to write it before Phase 2 begins.
2. **Cost of re-embedding all existing data.** Phase 2's backfill needs to re-embed every existing legacy vector against the Perplexity 2560-dim embedder. Estimate volume per tenant from the legacy index stats, multiply by per-token embedding cost, and budget. If the number is large, do the backfill in slices and rate-limit.
3. **Dimension mismatch silently rejected.** `src/knowledge/pinecone-client.js:104-117` throws `invalid_dimension` on mismatched vector length. Good. But the legacy index produces 1536-dim vectors and the new one expects 2560 — make sure no code path accidentally feeds the legacy vector into the new client during Phase 2.
4. **Bidirectional dependency on `cnftMint`.** Several routes resolve `cnftMint` before any write so `dualUpsert` can address the legacy namespace. After Phase 3 those lookups become dead weight. Audit and remove during Phase 3, but not before — they're load-bearing during Phase 1 and Phase 2.
5. **No backwards-compat path for users without a cNFT.** `src/routes/knowledge.js` requires a minted cNFT (HTTP 412 `cnft_required` if missing). After Phase 3 the cNFT gate can be relaxed — DID is sufficient. Confirm with Caleb whether cNFT minting stays a precondition for knowledge access or whether DID-only is fine post-migration.

---

## For Caleb + Karthik to decide

Open questions surfaced by the audit. Each blocks zero work today, but the answer shapes Phase 2 and 3.

1. **Re-embedding vs keeping both dimensions in parallel.** Re-embed every legacy vector with the new 2560-dim embedder (one-time cost, single index post-migration) OR keep both Pinecone indexes alive indefinitely with two clients (no re-embed cost, permanent dual maintenance). Recommendation: re-embed. Anything else compounds.
2. **cNFT gate post-migration.** Today knowledge access requires `cnftMint`. After Phase 3, should it still? cNFT is the immutable identity claim; DID is the authentication primary key. Two separate concerns. Probably keep cNFT mint as a prerequisite for high-trust writes (immutable profile facts) and drop it for read paths. Worth a 10-minute Caleb + Karthik chat.
3. **Backfill script ownership.** `scripts/pinecone-backfill.js` is referenced in comments but I have not verified it exists in this branch. If it does not, who writes it: Caleb (knows the data shape) or a future tab? File an issue either way.
4. **Togari adoption timeline.** This plan keeps everything platform-neutral so Togari can pick up `pinecone-client.js`, `tenant-pinecone-ref.js`, and `firestore.js` as-is. When does Togari actually adopt these? Decision drives whether we need a shared npm package vs a copy-paste port.
5. **Event description embedding for BigQuery rows.** Today only the structured event row exists in `medha_pdw.events`. If the agent needs "find me retreats with a meditation component" semantic recall, we have to embed event descriptions to Pinecone alongside the BQ write. Yes/no/later?

---

## Acceptance criteria

This document is complete when:

- [x] Audit table covers every Firestore collection in `src/db/` and every BQ table in `src/pdw/`.
- [x] Each row is classified (STAYS IN GCP / DUAL-WRITE / STAYS IN BQ) with a one-line why.
- [x] The KV-pairing model is documented with a code stub callers can copy.
- [x] Phase 1 / Phase 2 / Phase 3 are written down with concrete next actions.
- [x] Risks and open decisions are surfaced.
- [ ] PR is approved by Caleb. (You.)
- [ ] PR is approved by Karthik.
- [ ] Follow-up issues are filed: (a) move `src/routes/ingest.js` onto `dualUpsert`, (b) move `src/routes/ingest-imessage.js` onto `dualUpsert`, (c) verify or write `scripts/pinecone-backfill.js`, (d) re-embed backfill, (e) Phase 2 read swap, (f) Phase 3 cleanup.

When all boxes are checked, the plan is the contract. Future tabs build against it.
