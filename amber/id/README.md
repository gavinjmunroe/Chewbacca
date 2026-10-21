# amber-id

**The bio/personhood data layer for Amber Agent, Togari agents, and the next generation of composable user agents.** Per-tenant identity, profile, preferences, relationships, credentials, and memory bindings — served over scoped APIs so any authorized agent can ground its behavior in _who the user actually is_.

---

## What This Is

amber-id is the canonical **bio data layer** for the Amber ecosystem. It owns the answer to "who is this user?" — the immutable facts, the evolving preferences, the relationship graph, the credentials, and the persona bindings that every agent needs in order to act on the user's behalf.

Other repos in the ecosystem are _clients_ of amber-id:

- **Amber Agent** — the conversational/runtime layer (iMessage, voice, iOS, visionOS). Reads bio context to ground responses; never stores identity itself.
- **Togari agents/tools** — the action/data/tool layer (MCP-style tooling for people, calendar, enrichment, outreach). Receives scoped bio context per call; never holds long-term identity state.
- **Future composable agents** — Shortcuts-style and Agent Store agents that inherit authorized user bio context at invocation time, the same way an iOS Shortcut inherits user permissions.

If a surface needs to know something about the user — a birthday, a personality profile, a Google token, a preferred name, a relationship to another contact — it asks amber-id. amber-id is the only writer to Privy, Firestore secrets, Solana cNFT mints, and per-tenant Pinecone namespaces.

---

## Why a dedicated bio layer

The shape of "AI agents on personal devices" is converging on a model where **many small agents share one user**. Apple's Shortcuts-style direction (see Parker Ortolani's "Apple Agents + Shortcuts + Agent Store" framing) makes the pattern concrete: a user has dozens of agents, each scoped to a task, each needing to act _as that user_ without re-collecting identity.

This only works if there is **one source of truth for the bio**. Every agent — Amber Agent, Togari, a future Shortcuts agent, a third-party Agent Store entry — should authenticate the user once and pull the bio context it is authorized to see. amber-id is that source of truth.

```
                ┌─────────────────────────────────────────────┐
                │              amber-id                       │
                │     (bio / personhood / identity SoT)       │
                │                                             │
                │   immutable facts · preferences ·           │
                │   relationships · credentials · persona     │
                │   bindings · memory namespaces · audit      │
                └──────────────────────┬──────────────────────┘
                                       │   scoped, per-agent
                                       │   bio context (JWT +
                                       │   agent identity +
                                       │   permission scope)
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        ▼                              ▼                              ▼
 ┌──────────────┐             ┌──────────────┐              ┌──────────────────┐
 │ Amber Agent  │             │   Togari     │              │ Future composable│
 │              │             │   agents     │              │ agents (Shortcuts│
 │ conversation │             │              │              │ / Agent Store)   │
 │ + runtime    │             │ MCP tools    │              │                  │
 │ across iOS,  │             │ for people,  │              │ inherit user bio │
 │ voice,       │             │ data, action │              │ context per      │
 │ visionOS     │             │              │              │ invocation       │
 └──────────────┘             └──────────────┘              └──────────────────┘
```

---

## Responsibilities

amber-id owns the following, end-to-end:

| Concern                       | What lives here                                                                                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identity**                  | Privy DID as primary key; Solana cNFT mint as portable, user-owned anchor.                                                                                                                                                         |
| **Bio profile**               | Immutable onboarding facts (birthday, birth time, birth location, alma mater, hometown) + mutable profile fields (display name, current city, avatar, pronouns).                                                                   |
| **Preferences**               | Personality profiles (MBTI, Enneagram, Big 5), tone, communication style, schedule-affinity, cultural/dietary/accessibility preferences.                                                                                           |
| **Relationships**             | Contact graph + relationship strength + per-contact notes; the user-owned social fabric a downstream agent reads from.                                                                                                             |
| **Permissions**               | Privacy tier (`local_only` / `selective_cloud` / `full_social`), per-agent permission scope, calendar grants, dimension-scoped sharing.                                                                                            |
| **Credentials / secrets**     | AES-256-GCM secrets bag per tenant, keyed by DID. All per-user API keys (Composio, Todoist, GitHub PAT, Google OAuth, Clay, ElevenLabs, Exa, Crust, Perplexity, LinkedIn, …) are stored here and never duplicated to client repos. |
| **Memory / persona bindings** | Pinecone namespace per user (`tenant-<privy_did>`); agents bind their persona to a namespace and read/write through scoped endpoints. The retired `cnft:<mint>` namespace no longer exists.                                                                                             |
| **Per-agent scoped access**   | Every API call is authenticated as `(user, agent, scope)`. An agent can only see fields its scope authorizes — Togari does not see Amber Agent's conversation memory unless explicitly granted, and vice versa.                    |

amber-id is **not** a runtime: it does not generate replies, send messages, or call tools. Conversational logic lives in amber-agent; tool execution lives in Togari and downstream MCP servers; transport (Photon/Spectrum / iMessage) is owned by amber-agent.

---

## Architecture

```
╔══════════════════════════════════════════════════════════════════════════╗
║                        AMBER COMPOSABLE-AGENT STACK                      ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  amber-id  —  bio / personhood / identity source of truth                ║
║  ┌──────────────────────────────────────────────────────────────────┐    ║
║  │  Privy auth · Solana cNFT · Postgres (tenants) · Firestore       │    ║
║  │  (secrets) · Pinecone (per-user namespace) · audit log           │    ║
║  │                                                                  │    ║
║  │  Exposes scoped APIs:                                            │    ║
║  │    /v1/me                       — own profile + personalities   │    ║
║  │    /v1/me/contacts              — relationship graph             │    ║
║  │    /v1/privacy/tier|permissions — privacy & per-agent scope      │    ║
║  │    /v1/secrets/:did             — encrypted credential bag       │    ║
║  │    /knowledge/{ingest,query}    — per-user vector memory         │    ║
║  │    /ask                         — bio-grounded people Q&A        │    ║
║  │    /internal/users/:id/context  — bio profile contract for       │    ║
║  │                                   trusted agents (api-key auth)  │    ║
║  └────────────────────────┬─────────────────────────────────────────┘    ║
║                           │                                              ║
║          ┌────────────────┼─────────────────────┐                        ║
║          ▼                ▼                     ▼                        ║
║   ┌─────────────┐   ┌──────────────┐    ┌────────────────────┐           ║
║   │ Amber Agent │   │ Togari       │    │ Future composable  │           ║
║   │             │   │ agents/tools │    │ agents (Shortcuts, │           ║
║   │ runtime &   │   │              │    │ Agent Store, 3rd-  │           ║
║   │ conversa-   │   │ MCP layer    │    │ party)             │           ║
║   │ tion across │   │ for people / │    │                    │           ║
║   │ surfaces    │   │ data / tool  │    │ inherit authorized │           ║
║   │             │   │ operations   │    │ user bio context   │           ║
║   └─────────────┘   └──────────────┘    └────────────────────┘           ║
║                                                                          ║
║  Each consumer authenticates the user once (Privy JWT), then asks        ║
║  amber-id for the slice of bio it is authorized to see. amber-id         ║
║  enforces scope; consumers never hold bio state of their own.            ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

### Layer roles, plainly

- **amber-id** — bio/personhood/identity source of truth. Owns Privy, Solana cNFT, Postgres, Firestore secrets, Pinecone namespaces. The only writer to those systems.
- **amber-agent** — conversational/runtime layer. Authenticates the user via amber-id, pulls the bio profile + relevant memory, generates replies, owns transport (Photon/Spectrum / iMessage). Holds no persistent identity state.
- **Togari agents/tools** — action/data/tool layer (MCP-style). Receives a scoped bio context per call: just enough about the user to perform the requested action (e.g., "enrich this contact for `<user>`"). Holds no long-term identity state.
- **Future Agent Store / Shortcuts-style agents** — composable agents that inherit user bio context the way an iOS Shortcut inherits user permissions. Each agent declares the bio scope it needs; amber-id grants or denies based on the user's per-agent permissions.

---

## The bio profile contract

For trusted internal callers (amber-agent, Togari, future first-party agents), amber-id exposes a single endpoint that returns a normalized **bio profile**, the slice of identity the caller is authorized to see, in a stable shape.

> **Status: shipped (slice 1).** `GET /internal/bio/profile` is live in [`src/routes/bio.js`](src/routes/bio.js) with a hardcoded agent registry in [`src/lib/agents.js`](src/lib/agents.js) (`medha`, `togari`, `internal-cron`). Per-call audit goes to Firestore collection `bio_profile_access_log`. Slice 2 promotes the registry to a Firestore `agents` collection and adds a user-facing grant UI; until then, registering a new agent means a code change. The legacy `/internal/users/:userId/context` route is unchanged and deprecated.

```http
GET /internal/bio/profile
Authorization: ApiKey <internal>
X-Agent-Id: <agent_did_or_slug>
X-User-Did: <privy_did>
```

Planned response shape:

```jsonc
{
  "user": {
    "did": "did:privy:...",
    "cnft_mint": "<base58>",
    "display_name": "...",
    "pronouns": "...",
    "current_city": "...",
  },
  "immutable": {
    "birthday": "YYYY-MM-DD",
    "birth_time": "HH:MM",
    "birth_location": "...",
    "alma_mater": "...",
    "hometown": "...",
  },
  "personality": [
    { "framework": "mbti", "value": "..." },
    { "framework": "enneagram", "value": "..." },
    { "framework": "big5", "value": { "...": 0 } },
  ],
  "preferences": {
    "tone": "...",
    "schedule_affinity": "...",
    "communication_style": "...",
  },
  "relationships": {
    "summary": "top-N salient contacts for this agent's scope",
    "namespace": "tenant-<privy_did>",
  },
  "permissions": {
    "privacy_tier": "selective_cloud",
    "agent_scope": ["profile.read", "relationships.read", "memory.query"],
  },
  "memory": {
    "pinecone_namespace": "tenant-<privy_did>",
    "writable": true,
  },
}
```

Scope rules:

1. The **agent identity** on the request determines which fields are returned. An agent only sees fields covered by `permissions.agent_scope`.
2. Secrets are **never** returned in the bio profile envelope. Credentials are fetched separately via `/v1/secrets/:did/:key`, also scoped per agent.
3. Every read is **audit-logged** with `(user_did, agent_id, fields, timestamp)`.

This is what makes "many agents, one user" safe: the user grants Togari a different scope than Amber Agent, and a future Shortcuts-style agent gets only what its manifest declares.

---

## Repo structure

```
amber-id/
├── README.md                    — this file
├── ARCHITECTURE.md              — detailed data flow
├── ARCHITECTURE-PEOPLE.md       — Perplexity-for-people layering
├── ARCHITECTURE-SIX-DIMENSIONS.md
├── AGENTS.md                    — agent-facing repo conventions
├── CLAUDE.md                    — Claude Code orientation
│
├── src/
│   ├── index.js                 — Fastify entry point
│   ├── routes/
│   │   ├── auth.js              — /v1/auth/*
│   │   ├── profile.js           — /v1/me, /v1/me/contacts, /v1/profile/:userId
│   │   ├── onboarding.js        — /v1/onboarding/*
│   │   ├── privacy.js           — /v1/privacy/* (tier, permissions, audit)
│   │   ├── secrets.js           — /v1/secrets/:did/* (encrypted bag)
│   │   ├── tenants.js           — tenant CRUD
│   │   ├── numbers.js           — phone-number resolution
│   │   ├── identity.js          — cNFT mint / verify
│   │   ├── knowledge.js         — /knowledge/{ingest,query,forget,stats}
│   │   ├── admin-knowledge.js   — admin-scoped knowledge ops
│   │   ├── ingest.js            — bulk ingest pipeline
│   │   ├── ask.js               — /ask (bio-grounded people Q&A)
│   │   ├── data.js              — /v1/data/:table/* (admin)
│   │   ├── internal.js          — /internal/* (api-key auth, agent-facing)
│   │   └── public.js            — public health/meta
│   ├── lib/                     — privy, solana, pinecone, embeddings,
│   │                              peoplerank, secrets-crypto, audit,
│   │                              dimensions, ask, group-chat-governor
│   ├── db/                      — Drizzle schema + Postgres client
│   └── util/
│
├── drizzle/                     — generated migrations
├── infra/                       — Docker, Railway, Terraform
├── wiki/                        — org-level knowledge (companies, decisions)
└── config/
```

---

## Key dependencies

| Dependency                                               | Purpose                             |
| -------------------------------------------------------- | ----------------------------------- |
| `@privy-io/server-auth`                                  | User auth + DID + JWT verification  |
| `@solana/web3.js` + `@metaplex-foundation/mpl-bubblegum` | cNFT identity anchor                |
| `@google-cloud/firestore`                                | Tenant docs + encrypted secrets bag |
| `@pinecone-database/pinecone`                            | Per-user vector memory namespace    |
| `drizzle-orm` + `postgres`                               | Tenants / users / audit / cache     |
| `fastify` + `@fastify/rate-limit`                        | HTTP server                         |
| `bs58`                                                   | Solana key encoding                 |

---

## Environment variables

```env
# Privy
PRIVY_APP_ID=
PRIVY_APP_SECRET=

# Solana (cNFT identity)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_PAYER_SECRET_KEY=
AMBER_MERKLE_TREE=
AMBER_COLLECTION_MINT=

# Pinecone (per-user memory namespace)
PINECONE_API_KEY=
PINECONE_INDEX=amber-people
PINECONE_ENVIRONMENT=us-east-1-aws

# Embeddings
OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# Synthesis (for /ask)
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-5-20251022

# Postgres (tenants, audit)
DATABASE_URL=postgres://...

# Firestore (secrets, high-write tenant docs) — via Application Default Credentials
GOOGLE_APPLICATION_CREDENTIALS=

# Togari PeopleRank (upstream enrichment)
PEOPLERANK_BASE_URL=https://togari-amber-production.up.railway.app
PEOPLERANK_API_KEY=

# Server
PORT=8080
NODE_ENV=development
```

---

## How agents connect

Every consumer follows the same pattern: authenticate the user once, then ask amber-id for the slice of bio it needs.

```ts
// Amber Agent (conversation runtime) — pulls full bio for grounded reply
const profile = await amberId.bio.getProfile({ userJwt });
const memory = await amberId.knowledge.query({
  userJwt,
  q: "what do I know about Dev?",
});
const reply = await llm.respond({ profile, memory, message });
```

```ts
// Togari (MCP tool layer) — gets scoped slice for one action
const ctx = await amberId.bio.getProfile({
  userJwt,
  agentId: "togari",
  scope: ["relationships.read"],
});
const enriched = await togari.peopleRank.enrich({ ctx, contactId });
```

```ts
// Future Shortcuts / Agent Store agent — declares scope in its manifest
// User grants once; amber-id enforces per-call.
const ctx = await amberId.bio.getProfile({
  userJwt,
  agentId: "shortcut.morning-brief",
  scope: ["profile.read", "preferences.read"],
});
```

The consumer never talks to Privy, Solana, Pinecone, or PeopleRank directly. It talks to amber-id, which routes to the right substrate, enforces scope, and writes the audit entry.

---

## Roadmap

- **Bio profile envelope.** Stabilize the `/internal/bio/profile` response shape across `profile`, `personality`, `preferences`, `relationships`, `permissions`, `memory`. Add agent-scoped field filtering.
- **Per-agent permission model.** Move from a single user-level privacy tier to per-agent scopes (`profile.read`, `relationships.read`, `memory.query`, `memory.write`, `secrets.read:<key>`), with a user-facing grant UI in Amber Agent.
- **Agent registry.** First-class records for the agents that consume amber-id (Amber Agent, Togari, internal Shortcuts), so every audit log row carries a real `agent_id`.
- **Composable-agent SDK.** Thin client (`@amber/id-client`) that any future agent — Shortcuts, Agent Store, third-party — can drop in to authenticate the user and request a scoped bio context.
- **Memory binding APIs.** Let an agent bind its persona to a sub-namespace under `tenant-<privy_did>` so each agent's writes are isolated, while reads can span sub-namespaces with permission.

---

## Non-goals

- **No conversational logic.** Replies, tool selection, and turn-taking live in amber-agent and Togari, not here.
- **No transport.** amber-id never sends a message. Photon/Spectrum / iMessage are owned by amber-agent.
- **No raw source storage.** Per-tenant context repos (GitHub) hold raw documents; amber-id holds the embeddings and metadata.
- **No duplicate identity stores.** If another repo is calling Privy or Pinecone directly, that's a bug — fix it by extending an amber-id endpoint.

---

## Dedup v2 module (`/dedup`)

Self-contained contact dedup + Clay-callable matcher, ported from the now-decommissioned `togari-bma-dvlp` repo. Lives entirely under `dedup/` so it's easy to grok and easy to remove if it ever needs to spin out.

**What it does:** every Medha user gets a per-DID contacts pool in BigQuery (`togari_dnc.contacts`). The matcher answers "is this person already in my contacts" in <1s per Clay row via a priority chain (email → LinkedIn slug → phone E.164 → full name). A heuristic + Claude Haiku classifier rejects organizations and bots. Apple CardDAV provides bidirectional iCloud sync. The primary product use case is mass-outreach dedup: a BMA team member in Clay marks "skip — already known" on every row that matches.

**Surface:**

| Endpoint                                                                | Auth                 | Purpose                                                     |
| ----------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------- |
| `POST /api/v1/people/match`                                             | `Bearer tgi_live_*`  | Clay-callable matcher                                       |
| `POST /api/v1/people`                                                   | `Bearer tgi_live_*`  | Create contact (runs realness classifier)                   |
| `PATCH /api/v1/people/:contact_id`                                      | `Bearer tgi_live_*`  | Non-destructive update                                      |
| `POST /api/v1/people/:contact_id/push-to-apple`                         | `Bearer tgi_live_*`  | Write back to iCloud Contacts                               |
| `POST /api/v1/keys` · `GET /api/v1/keys` · `DELETE /api/v1/keys/:keyId` | Privy JWT            | Issue / list / revoke `tgi_live_*` keys (dashboard surface) |
| `POST /api/v1/magic-link/issue` · `GET /api/v1/magic-link/exchange`     | service key / token  | Issue + consume the Slack/iMessage onboarding link          |
| `GET /api/v1/health`                                                    | none                 | BQ + Anthropic + env health check                           |
| `POST /slack/togari`                                                    | Slack signing secret | `/togari connect` slash command                             |

**Layout:**

```
dedup/
├── api/             # Fastify route groups (people, api-keys, apple, magic-link, slack, health)
├── auth/            # Bearer key issuance + middleware + Privy bridge + Apple credentials
├── dedup/           # Matcher (single-record BQ lookup) + realness classifier
├── integrations/    # CardDAV client + vCard parser + Slack bot HMAC verifier
├── workers/         # Apple sync poller
├── types/           # Shared contracts (UnifiedContact, MatchRequest, ...)
├── lib/             # Env validation, Privy info doc
├── scripts/         # smoke.ts, claim-contacts.ts (admin tools)
└── sql/migrations/  # 004 (dedup columns), 005 (owner_did + view), 006 (rename)
```

**Tenancy:** every row in `contacts` / `social_connections` / `api_keys` is keyed by `owner_did` (Auth0 sub was renamed in migration 006). Every BQ query in the matcher filters by `owner_did = @owner_did`. No cross-tenant fallback. The 2,135 legacy rows are tagged `owner_did='env-default'` and can be reassigned to a real DID via `npm run dedup:claim-contacts -- <did>`.

**Required env (only for dedup; rest of amber-id is unaffected):**

- `GCP_CREDENTIALS_BASE64` OR `GOOGLE_APPLICATION_CREDENTIALS` OR `GOOGLE_APPLICATION_CREDENTIALS_JSON`
- `ANTHROPIC_API_KEY` (Claude Haiku for realness escalation)
- `MAGIC_LINK_INTERNAL_SECRET` (HMAC for magic-link tokens)

If any required dedup var is missing, `validateEnv()` logs a fatal-style warning and the dedup route groups silently skip mounting — the rest of amber-id keeps running. Confirm with `curl https://medha-id-production.up.railway.app/api/v1/health` (200 with `bigquery.ok: true` means it's live).

**Smoke test after every deploy:** `npm run dedup:smoke -- https://medha-id-production.up.railway.app tgi_live_<key>`.
