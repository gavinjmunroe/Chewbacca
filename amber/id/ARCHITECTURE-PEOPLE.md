# Amber — "Perplexity for People" architecture

> **Current source of truth for identity + people data:**
> [`docs/PERSON-CONTRACT.md`](docs/PERSON-CONTRACT.md) (frozen HTTP/schema for
> the Stanford sprint) and [`docs/IDENTITY-MODEL.md`](docs/IDENTITY-MODEL.md)
> (`amber_id` is the ownership root; DID / `person_id` are aliases).
>
> This file is the **April 2026** Privy → cNFT → Pinecone `cnft:<mint>` framing.
> **The `cnft:<mint>` namespace described below is retired.** Knowledge lives in
> `tenant-<privy_did>`; there is no `cnft:` read or write path in the codebase
> and no `cnft:` namespace in the index.
> It is historical context, not this week's implementation guide. Do not treat
> cNFT mint address or Privy DID as the OLTP primary key. Do not add new
> Pinecone namespaces. Bubblegum remains a nullable portable identity proof
> (`users.cnft_asset_id`); Postgres holds the dataset.

**Decided:** Friday, April 17, 2026 (Sagar + Perplexity Computer)

This document supersedes the Medha framing in `amber-agent/Perplexity/BILLION-DOLLAR-BUILD.md` for the identity + knowledge layers. The north star is **Amber as Perplexity for People**: every user owns a decentralized, cNFT-authenticated knowledge base of their contacts, conversations, and relationships, queryable through a people-centric Q&A interface.

---

## The three layers

```
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — IDENTITY (amber-id, this repo)                            │
│                                                                      │
│    Privy social login                                                │
│        ↓                                                             │
│    Embedded Solana wallet                                            │
│        ↓                                                             │
│    cNFT mint (Metaplex Bubblegum, compressed NFT on Solana mainnet)  │
│        ↓                                                             │
│    cNFT asset ID  →  becomes the auth key for Layer 2                │
│                                                                      │
│  Immutable data in the cNFT metadata:                                │
│    birthday · birth time · birth location ·                          │
│    alma mater · hometown · MBTI / enneagram / big-5                  │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 2 — PRIVATE, DECENTRALIZED KB (amber-id, this repo)           │
│                                                                      │
│    Pinecone index: amber-people                                      │
│    Namespace:      cnft:<mint_address>      ← one per user           │
│                                                                      │
│    Embeddings: OpenAI text-embedding-3-small (1536 dims)             │
│    Write path:  POST /knowledge/ingest  (authed: Privy JWT)          │
│    Query path:  POST /knowledge/query   (authed: Privy JWT)          │
│                                                                      │
│    Auth check on every request:                                      │
│      1. Verify Privy JWT                                             │
│      2. Resolve user → cNFT mint address                             │
│      3. Scope Pinecone ops to `cnft:<mint>` namespace                │
│      4. Audit log every read/write                                   │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 3 — ASK AMBER (amber-id, this repo)                           │
│                                                                      │
│    POST /ask                                                         │
│                                                                      │
│    Input:   { question: "Who should I reach out to about the         │
│               fundraise this week?" }                                │
│                                                                      │
│    Pipeline:                                                         │
│      1. Verify Privy JWT → resolve cNFT → unlock namespace           │
│      2. Embed question → Pinecone top-K (personal KB)                │
│      3. Extract candidate people IDs from matches                    │
│      4. Call togari-PeopleRank (/score) on candidates                │
│         → re-rank by readiness × compatibility × recency             │
│      5. Synthesize answer with Anthropic Claude:                     │
│         - people-centric phrasing ("Reach out to Dev first because") │
│         - inline citations to specific contact notes / past msgs     │
│      6. Return { answer, people: [...], citations: [...] }           │
└──────────────────────────────────────────────────────────────────────┘
```

## Cross-repo responsibilities

| Concern | Repo | Notes |
|---|---|---|
| User identity + cNFT | **amber-id** | Privy → Solana wallet → Bubblegum mint. Source of truth for "who is this user." |
| Per-user private KB | **amber-id** | Pinecone `amber-people` index, `cnft:<mint>` namespace. Private + permissioned. |
| People-centric Q&A | **amber-id** | `/ask` endpoint. Fuses personal KB + PeopleRank + LLM. |
| Shared "world" KB | **amber-agent** | GCP Vertex AI Vector Search (not Postgres). Public facts, 6-dimension health definitions, playbooks. |
| iMessage/SMS agent | **amber-agent** | Existing orchestrator (`Newton/agent/agent.js`). Calls amber-id `/ask` as one of its tools. |
| People scoring | **togari-peoplerank** | Existing MCP server; amber-id wraps it as an HTTP client. |
| Client surface | **amber-ios** | `AmberKit` gains `mintIdentity()` + `ask(_:)`. Persistent ask bar across tabs. |

## amber-id → Pinecone namespace scheme

- **Index:** `amber-people` (1536-dim, cosine)
- **Namespace per user:** `cnft:<base58_mint_address>`
- **Metadata fields on every vector:**
  - `user_cnft` — cNFT mint address (redundant w/ namespace, but lets us cross-check)
  - `source` — `contact | conversation | note | social | manual`
  - `person_id` — stable ID of the person this vector is *about* (not the owner)
  - `person_name` — denormalized for citations
  - `kind` — `profile | message | observation | meeting | signal`
  - `created_at` — ISO-8601 (the real-world time this thing happened)
  - `ingested_at` — ISO-8601 (when it hit Pinecone)
  - `health_dimension` — one of the 6 dims when applicable
  - `visibility` — `private | shared_with_contact | public` (for future privacy tiers)
- **Top-K default:** 24 (rerank down to 8 for LLM synthesis)

## Auth flow — detail

```
iOS ─── Privy login ───► Privy returns JWT + Solana wallet address
 │
 ├─ POST /identity/mint       (JWT)
 │    → amber-id verifies JWT
 │    → amber-id calls Bubblegum mintV1 with user's wallet as owner
 │    → amber-id stores mint_address on users.cnft_mint
 │    → returns { cnft_mint, asset_id, tx_signature }
 │
 ├─ POST /knowledge/ingest    (JWT)  { items: [...] }
 │    → amber-id verifies JWT → looks up users.cnft_mint
 │    → embeds items → Pinecone upsert to namespace cnft:<mint>
 │
 └─ POST /ask                 (JWT)  { question }
      → amber-id verifies JWT → looks up users.cnft_mint
      → runs pipeline above
      → returns { answer, people, citations }
```

## Data we hold vs. don't

| Where | What lives there |
|---|---|
| **Solana mainnet (cNFT metadata)** | Immutable onboarding facts. Public by design (on-chain). |
| **amber-id Postgres** | `users` (Privy ID ↔ cNFT mint), audit log, rate-limit state. No personal KB content. |
| **Pinecone (`cnft:<mint>` ns)** | All private knowledge vectors + metadata. Owned logically by the user; deletable via `/knowledge/forget`. |
| **amber-agent GCP Vector Search** | Shared world knowledge (playbooks, dimension definitions). Never user-specific. |
| **iOS device** | UI state + Privy JWT. No secrets, no KB cache beyond last answer. |

## What this repo will add

- `src/lib/solana.js` — Bubblegum client, cNFT mint helper.
- `src/lib/pinecone.js` — Pinecone client with namespace enforcement.
- `src/lib/embeddings.js` — OpenAI embedding wrapper with batching.
- `src/lib/peoplerank.js` — HTTP client for `togari-peoplerank`.
- `src/lib/ask.js` — synthesis pipeline (Anthropic Claude).
- `src/routes/identity.js` — `POST /identity/mint`, `GET /identity/:cnft/verify`.
- `src/routes/knowledge.js` — `POST /knowledge/ingest`, `POST /knowledge/query`, `POST /knowledge/forget`.
- `src/routes/ask.js` — `POST /ask`.
- Schema addition: `users.cnft_mint`, `users.cnft_asset_id`, `users.cnft_minted_at`.

All existing routes (`auth`, `profile`, `onboarding`, `privacy`, `tenants`, `numbers`, `data`) are preserved.

## Env vars added

```
# Solana
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_PAYER_SECRET_KEY=...      # base58; pays rent for cNFT mints
AMBER_MERKLE_TREE=...            # pre-created Bubblegum tree, owned by payer
AMBER_COLLECTION_MINT=...        # optional: collection NFT for grouping

# Pinecone
PINECONE_API_KEY=...
PINECONE_INDEX=amber-people
PINECONE_ENVIRONMENT=us-east-1-aws

# OpenAI (embeddings)
OPENAI_API_KEY=...
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# Anthropic (synthesis)
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-5-20251022

# PeopleRank (upstream)
PEOPLERANK_BASE_URL=https://togari-amber-production.up.railway.app
PEOPLERANK_API_KEY=...
```

## Non-goals (explicit)

- **No PostgreSQL-backed user KB.** Pinecone is the only store for private knowledge content. PG only holds the Privy↔cNFT mapping and audit.
- **No shared wiki in amber-id.** World knowledge lives in amber-agent + GCP.
- **No Medha clinical flows in this layer.** If/when we build Medha, it consumes `/ask` like any other client.
