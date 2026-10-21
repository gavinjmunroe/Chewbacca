# CLAUDE.md — amber-id

> **⚠️ ARCHITECTURE MIGRATION IN PROGRESS — read `docs/AUDIT-legacy-removal.md` first.**
> The target architecture is **Cloud SQL (OLTP) + BigQuery (warehouse) ONLY**.
> **Privy, Firestore, Pinecone, and the cNFT/Solana stack are being REMOVED** and must
> NOT be used for anything new. Auth is JWT-based (`medha-jwt.js` / `amber-jwt.js`) with
> phone-OTP over Photon + Sign in with Apple/Google. Much of the description below (the
> "equation", Privy/Pinecone/Firestore references) is LEGACY and on the removal path —
> see the audit doc for what's active vs being torn out, and the ordered chunk plan.

Identity, knowledge, and intelligence layer for every Amber interface. amber-id
is the **only** service that talks to Privy, Pinecone, Solana, Firestore (for
the secrets bag), and PeopleRank. Every other service — amber-agent, iOS,
visionOS, web admin — goes through amber-id.

Read this file first, then `AGENTS.md`, then the relevant architecture doc
(`ARCHITECTURE.md`, `ARCHITECTURE-SIX-DIMENSIONS.md`, `ARCHITECTURE-PEOPLE.md`)
before making changes.

---

## The equation

`Amber ID = Blockchain Identity × Knowledge Base × PeopleRank × Secrets Bag`

- **Blockchain Identity** — Solana cNFTs for immutable profile facts (auth via Privy.io)
- **Knowledge Base** — Pinecone vectors, one namespace per DID
- **PeopleRank** — Togari relationship-intelligence adapter
- **Secrets Bag** — Firestore-backed, AES-256-GCM encrypted per-tenant key/value store

---

## Naming (brand vs deployments vs adapters)

- **Amber** is the only user-facing agent brand. The agent introduces
  itself as Amber, in iMessage, voice, vision, and web.
- **Amber-Dvlp** and **Amber-Prod** are deployment / Loop-channel labels
  used internally (which Loop sender, which Railway env). They are not
  agent names and must not surface to users.
- **Photon/Spectrum** — transport for iMessage / SMS. Inbound messages
  arrive at `/webhooks/photon/inbound`; outbound replies go via the Spectrum
  gRPC client. amber-id never sends; it only resolves identity so the
  transport layer can attribute each message correctly.
- **Togari / Tiwari** — intelligence layer. Togari = enrichment + people
  search adapter; Tiwari = dimension-aware ranking primitives consumed
  by amber-agent.
- **Retell** — voice adapter (telephony / voice agent).
- **Perplexity Computer** — the nervous system / orchestration substrate;
  not an agent brand the user ever sees.

---

## Hard rules

1. **No interface talks to Pinecone, Solana, Firestore, or PeopleRank directly.**
   They all go through amber-id REST endpoints.
2. **Every endpoint that touches a tenant must resolve by DID** (not phone, not
   sender_id — DIDs are the primary key). If you only have a phone, call
   `/tenants/resolve?phone=…` first.
3. **Secrets never leave Firestore unencrypted in a log line.** Read paths
   decrypt just before returning; write paths encrypt before storing.
4. **The master encryption key (`SECRETS_MASTER_KEY`) lives in env only.** It
   never enters a per-tenant code path or a request-scoped variable.
5. **Privy `setCustomMetadata` has ~10s eventual consistency** — never read
   back the same user immediately after writing. Tenant endpoints synthesize
   the response from the merged object instead of hitting Privy again.

---

## Repository layout

```
amber-id/
├── auth/          # Privy.io client + middleware
├── identity/      # Solana cNFT minting, privacy tiers
├── knowledge/     # Pinecone client, embedding, RAG queries
├── enrichment/    # PeopleRank (Togari) adapter
├── wiki/          # LLM-maintained knowledge articles (companies, concepts, decisions)
├── db/            # Drizzle ORM schema (Postgres — used for durable structured tables)
├── api/           # Fastify REST routes (tenants, secrets, ingest, knowledge)
├── src/           # Main server bootstrap + shared utilities
├── infra/         # Dockerfile, railway.toml, terraform
└── drizzle/       # Migration artifacts
```

---

## Six-dimension ontology (shared with amber-agent)

Every ingested item is tagged with one of the six health dimensions. This
ontology is **load-bearing** across all Amber services:

- **Masculine** (structural / outward): `financial`, `intellectual`, `social`
- **Feminine** (vital / inward): `spiritual`, `emotional`, `physical`

See `ARCHITECTURE-SIX-DIMENSIONS.md` for the full spec. Do not add new values
without updating every downstream consumer (amber-agent tools, calendar
provisioner, context wikis, PeopleRank tags).

---

## Required reading order

1. `CLAUDE.md` (this file)
2. `AGENTS.md`
3. `ARCHITECTURE.md`
4. `ARCHITECTURE-SIX-DIMENSIONS.md` — when touching ingest / dimensions
5. `ARCHITECTURE-PEOPLE.md` — when touching PeopleRank or relationships
6. The relevant route file before modifying API behavior

---

## Key API surfaces

**Tenants (DID is primary key) — TENANT OWNER identity only**:
- `GET  /tenants/resolve?sender_id=<uuid>` → tenant owner by Loop sender
- `GET  /tenants/resolve?phone=<e164>` → tenant owner by phone (the
  account holder's phone, NOT an inbound message sender's phone)
- `GET  /tenants/:did` → single tenant
- `GET  /tenants/list?active=true` → all active tenants
- `POST /tenants/upsert` → create/update tenant (name, phone, contextRepo, …)
- `POST /tenants/seed` → create tenant + provision Pinecone namespace
- `PATCH /tenants/:did/metadata` → merge `onboardingProfile`, `contextRepo`, etc.

> Tenant responses carry `kind: "tenant_owner"`. `displayName` / `ownerName` /
> `agentName` describe the **account owner**, never a contact. For inbound
> iMessage / SMS sender identity, use the contact route below.

**Contacts (per-tenant address book — used to identify inbound senders)**:
- `GET  /v1/me/contacts` (Privy auth) → caller's contacts
- `POST /v1/me/contacts` (Privy auth) → upsert from iOS Apple Contacts.
  `name` is required; `firstName` / `lastName` are optional, captured so
  transports (iMessage, voice) can address the contact by first name.
- `GET  /internal/users/:did/contacts` (service key) → full list for a tenant
- `GET  /internal/users/:did/contacts/by-phone?phone=<e164>` (service key)
  → resolves an inbound phone to that tenant's contact. A 404 means
  **unknown sender** — callers MUST NOT substitute the tenant owner's
  identity (this is the path that prevented "Maggie answered as Sagar").

**Secrets (AES-256-GCM, keyed by DID)**:
- `GET  /v1/secrets/:did` → full decrypted bag
- `GET  /v1/secrets/:did/keys` → just the key names
- `GET  /v1/secrets/:did/:key` → single value
- `PUT  /v1/secrets/:did/:key` → set one
- `DELETE /v1/secrets/:did/:key` → unset one
- `PUT  /v1/secrets/:did` → bulk replace

**Ingest (writes to Pinecone)**:
- `POST /ingest/:pipe` (pipe ∈ {agent, health, checkin, relationship})
  with header `x-amber-phone` and body `{ items: [{ text, healthDimension, … }] }`

**Knowledge (reads from Pinecone)**:
- `POST /knowledge/query-as` → `{ target_did, text, topK }` → matches

---

## Deployment

- Railway project `amber` (`758c0c59-8ac7-4cbd-9b29-f67075de8e72`)
- Production env `cb5c9100-076e-4879-a160-368fd7862417`
- Service `amber-id` (`d26ac4a6-7bf6-4fea-9c15-66dde26791d1`)
- Health: `https://amber-id-production.up.railway.app/health`
- Push with git identity `caleb@amber.so` / `Caleb Newton` and the
  `api_credentials=["github"]` preset.

---

## Read `AGENTS.md` next.
