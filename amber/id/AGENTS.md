# AGENTS.md — amber-id

## Project

amber-id is the identity + knowledge + secrets service. It is the **only**
writer to:

- The Privy user metadata (via REST, with eventual-consistency safeguards)
- Firestore collections (`tenants`, `tenant_secrets`, `calendar_grants`, …)
- Solana (cNFT minting for immutable profile facts)
- PeopleRank (Togari) enrichment cache

Every other Amber surface — amber-agent, iOS, visionOS, web — is a client.
If you find yourself adding a direct Privy call from another repo, that's
a bug; fix it by extending an amber-id endpoint instead.

**Knowledge graph.** amber-id **used to** own the Pinecone `amber-people`
index directly through `src/knowledge/pinecone-client.js`. Per
MIGRATION_PLAN.md Phase 2, the KG now lives in
`amber-sandbox/domains/knowledge-graph/` and amber-id talks to it over
HTTP through `src/knowledge/kg-client.js` (HMAC-signed, service-role
secret). Every ingest, query, forget, snapshot, and clear goes through
that client — no direct Pinecone SDK call remains in this repo.

---

## Current scope

### In scope

- Tenant records with DID as primary key, owning: phone, name, agent/owner
  name, Loop sender UUID, context-repo slug, onboarding profile
- AES-256-GCM secrets bag per tenant, keyed by DID (all per-user API keys
  live here — Composio, Todoist, GitHub PAT, Google OAuth, Clay,
  ElevenLabs, Exa, Crust, Perplexity, LinkedIn, …)
- Ingest/query endpoints that fan out to the sandbox knowledge-graph service
- PeopleRank adapter (enrich contact → rank → tag with dimension)
- Calendar-grants store (peer freebusy access, dimension-scoped, expiring)
- Wiki of org-level knowledge (companies, concepts, decisions) — separate
  from per-tenant context repos

### Out of scope

- Conversational logic (lives in amber-agent)
- Transport (Photon/Spectrum) — amber-agent owns all sends
- UI (admin dashboards belong in a separate repo)
- Raw source storage — that belongs in per-tenant context repos (GitHub)

---

## Stack (authoritative)

- Node.js 22+, Fastify, ESM
- Drizzle ORM over Postgres for structured tables (tenants, grants, cache)
- Firestore Admin SDK for secrets + high-write-rate tenant docs
- Sandbox knowledge-graph service (over HTTP) for vector recall; no direct Pinecone SDK dep
- `@privy-io/server-auth` for auth + user metadata
- `@solana/web3.js` + Metaplex for cNFT issuance
- Hosted on Railway alongside amber-agent

---

## Code hygiene (enforced)

Same limits as amber-agent:

- **File max: 800 lines**
- **Function max: 100 lines**
- **Nesting depth: max 3**
- **Parameters: max 4** (use options object beyond that)
- **Tests: up to 1,000 lines**
- Drizzle migrations and Fastify schema objects are exempt from the line limit.

---

## Correctness rules

1. **DID is the primary key everywhere.** Phone + sender_id are resolution
   aliases, not storage keys.
2. **Never call `privyClient.setCustomMetadata` and then read back in the
   same handler.** Merge the object in memory and return that; Privy is
   eventually consistent at ~10 seconds.
3. **Encrypt secrets before writing to Firestore, decrypt only at the
   response boundary.** Never log plaintext.
4. **Knowledge-graph writes must include `healthDimension` metadata.**
   The sandbox KG service rejects items without a dimension — the
   dimension is what drives per-page compilation in the context wiki.
   Writers may opt out with `{ requireDimension: false }` when a kind
   predates the dimension contract (contacts, events, pipelines).
5. **Every DELETE endpoint that removes a tenant must:**
   - Delete the Privy user (`DELETE /api/v1/users/:did`)
   - Delete the Firestore tenant doc + secrets bag
   - Call `kg-client.forget(privyDid, { all: true })` to wipe the
     tenant's KG namespace via the sandbox service
   - Archive the context repo (don't delete — repos hold audit value)
6. **Never import `@pinecone-database/pinecone` directly.** Every KG
   operation goes through `src/knowledge/kg-client.js`. The Pinecone SDK
   dep was removed on 2026-08-31; re-adding it is a bug.

---

## Engineering guidance

- Prefer structured endpoints over generic CRUD — `/tenants/seed` is
  clearer than `/tenants POST` with a flag.
- Keep Firestore writes idempotent. Use `merge: true` by default.
- When encrypting, rotate master key by re-encrypting on read + write
  rather than a big-bang migration.
- All timestamps are UTC ISO-8601 strings in transport; Firestore stores
  them as native Timestamp objects.
- Rate-limit egress to PeopleRank and OpenAI-embedding endpoints per DID
  (10 rpm is usually enough for check-in traffic).

---

## Release readiness

Before pushing to `main`:

1. `node --check` passes on every changed `.js` file
2. Drizzle migrations generated and committed (`pnpm drizzle-kit generate`)
3. No raw secrets in the diff
4. `ARCHITECTURE.md` updated if any endpoint contract changed
5. amber-agent still builds and its health check still 200s after the
   amber-id deploy (they're cocoupled; don't break the contract silently)

---

## Read `ARCHITECTURE.md` next.
