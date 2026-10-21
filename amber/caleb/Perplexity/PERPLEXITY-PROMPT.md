# Perplexity Computer: Amber Codebase Prompt

Paste the section below directly into Perplexity Computer to orient it on the full codebase.

---

## Prompt

You are working on the **Amber** AI health network — a set of three live production services and an iOS app built by Caleb Newton and Sagar Tiwari.

### The Services

**amber-agent** (`amber-organization/amber-agent` on GitHub)
This is the primary backend monorepo. It runs on Railway at `amber-caleb-production.up.railway.app`.
- Entry point: `Newton/agent/agent.js` (1,728-line Node.js orchestrator)
- Core services in `Newton/agent/lib/`: ai.js, router.js, prompts.js, sessions.js, groups.js, health.js, contacts.js, context.js, search.js, memory.js, safety.js, permissions.js, transport.js, supabase.js, tools/
- Web dashboard: `Newton/agent/dashboard/` — Next.js 16 app with 10 pages (Home, Chat, Health, Calendar, Tasks, Email, People, Projects, Feed, Context). Deployed to Vercel.
- Stack: Node.js 20 ESM, Anthropic Claude Sonnet (owner), Groq llama-3.3-70b (contacts, free tier), Perplexity Search + Agent APIs, Supabase for state
- The agent listens on iMessage and SMS via Loop Message SDK and Twilio. It tracks 6 health dimensions per contact (Spiritual/Emotional/Physical/Intellectual/Social/Financial), runs AI search via Perplexity, manages tools via Composio (Gmail, Calendar, GitHub, Todoist, LinkedIn, Vercel), and never reveals it's an AI.
- Deployment: `railway.toml` → `cd Newton/agent && npm install` / `node Newton/agent/agent.js`

**amber-id** (`amber-organization/amber-id` on GitHub)
Identity, knowledge, and intelligence foundation. Runs on Railway at `amber-id-production.up.railway.app`.
- Stack: Node.js, Fastify, PostgreSQL (Drizzle ORM, Railway service `amber-id-db`), Privy.io, Solana web3.js + @metaplex-foundation/mpl-bubblegum, Pinecone, OpenAI text-embedding-3-small
- Three layers: (1) Privy auth → Solana cNFT minting with immutable user profile, (2) Pinecone knowledge base from amber-knowledge-base markdown wiki, (3) togari-PeopleRank API for contact enrichment
- Key routes: `/auth/verify`, `/auth/me`, `/identity/mint`, `/knowledge/query`, `/knowledge/ingest`, `/profile`, `/onboarding/start`, `/health`
- All Amber interfaces authenticate through amber-id first

**amber-ios** (`amber-organization/amber-ios-dev` on GitHub)
Pure SwiftUI client. App Store (main branch) + TestFlight (dev branch).
- Zero API keys in Swift. Zero direct DB access. Pure client.
- Three backend calls: amber-id (auth + profile + knowledge), amber-agent (AI chat + health), togari-PeopleRank (contact enrichment)
- Screens: Contacts, Network Visualization, Profile, Amber AI Chat, Health Dimensions, Onboarding, Privacy Tiers
- Branching: feature branches → dev (TestFlight CI) → main (App Store CI, requires Sagar approval)
- Sibling repos: amber-ipados, amber-macos, amber-visionOS (all SwiftUI, same health platform)

### The Monorepo Structure (amber-agent)

```
amber-agent/
├── Newton/                    Development staging — all microservices start here
│   ├── agent/                 Core iMessage agent + Medha AI service stubs
│   │   ├── agent.js           Orchestrator
│   │   ├── lib/               20 modular services
│   │   ├── dashboard/         Next.js 16 web UI
│   │   ├── intake-screening/  Medha: patient intake (stub, ready to build)
│   │   ├── customer-service/  Medha: support agent (stub)
│   │   ├── prior-auth/        Medha: insurance pre-auth (stub)
│   │   ├── ad-creative/       Medha: AI ad generation (stub)
│   │   ├── provider-matching/ Medha: match patients to providers (stub)
│   │   └── ventures/          Sub-projects (financial, physical, social, emotional)
│   ├── infrastructure/        Partner adapters (OpenLoop, Truepill, EHR, billing, compliance)
│   ├── platform/              Next.js apps (landing, intake, provider, dashboard, admin)
│   └── docs/                  Business docs, research
├── Tiwari/                    Production — services graduate here after security review
├── Perplexity/                This directory — coding agent CLI + build docs
├── skills/                    Claude Code skill definitions
├── railway.toml               Railway deploy config (points to Newton/agent)
└── package.json               Monorepo manifest (install:agent, install:identity scripts)
```

### The Newton → Tiwari Pipeline

Services develop in `Newton/`. When a service passes security review and full test coverage, it gets promoted to `Tiwari/` — that's what actually deploys to Railway. The current live deployment (`Newton/agent/agent.js`) runs from Newton because it's the active development version.

### Railway Services (Blue Modern Advisory workspace)

| Service | URL | Notes |
|---------|-----|-------|
| amber-agent | amber-caleb-production.up.railway.app | Live, node Newton/agent/agent.js |
| amber-id | amber-id-production.up.railway.app | Live, Fastify on port 8080 |
| amber-id-db | internal | Railway PostgreSQL for amber-id |

### Key Environment Variables

**amber-agent needs:**
- `ANTHROPIC_API_KEY` — Claude Sonnet (owner model)
- `GROQ_API_KEY` — llama-3.3-70b (contacts, free)
- `PERPLEXITY_API_KEY` — Search + Agent APIs
- `LOOP_AUTH_TOKEN` + `LOOP_TEAM_ID` — iMessage via Loop Message
- `TWILIO_*` — SMS fallback
- `SUPABASE_URL` + `SUPABASE_KEY` — primary data store
- `COMPOSIO_API_KEY` — Gmail, Calendar, GitHub, Todoist, LinkedIn tools

**amber-id needs:**
- `PRIVY_APP_ID` + `PRIVY_APP_SECRET` — auth
- `SOLANA_RPC_URL` + `SOLANA_PRIVATE_KEY` + `MERKLE_TREE_ADDRESS` — cNFTs
- `PINECONE_API_KEY` + `PINECONE_INDEX` — knowledge base
- `OPENAI_API_KEY` — embeddings
- `DATABASE_URL` — postgres://...@postgres.railway.internal:5432/railway (amber-id-db)
- `PEOPLERANK_API_KEY` + `PEOPLERANK_API_URL` — togari-PeopleRank consumer

### What's Live vs. What Needs to Be Built

**Live and working:**
- amber-agent iMessage orchestrator + health dimension inference
- amber-id auth, identity, Pinecone KB
- amber-ios App Store + TestFlight pipeline
- togari-PeopleRank API (external service)

**Stubs ready to build out (Newton/agent/):**
- `intake-screening/` — wire amber-agent iMessage to a medical intake questionnaire flow
- `prior-auth/` — payer API integration for insurance pre-authorization
- `provider-matching/` — wrap togari-PeopleRank results for clinical provider selection
- `customer-service/` — dedicated 24/7 support agent context

**Platform shell ready (Newton/platform/):**
- `landing/` — patient-facing landing + Stripe checkout
- `intake/` — patient intake web flow
- `provider/` — provider portal
- `admin/` — ops dashboard

**Infrastructure adapters needed (Newton/infrastructure/):**
- `telehealth/` — OpenLoop Health / SteadyMD provider API
- `pharmacy/` — Truepill fulfillment + compounding pharmacy
- `billing/` — Candid Health insurance billing + RCM
- `ehr/` — EHR/charting integration
- `compliance/` — HIPAA, DEA, state licensing monitoring

### Conventions

- amber-agent: Node.js ESM (`"type": "module"` in package.json). All imports use `.js` extensions.
- amber-agent lib files export named functions. agent.js imports and orchestrates.
- amber-id: CommonJS (Node.js). Fastify server. Drizzle for DB.
- amber-ios: SwiftUI MVVM. View → ViewModel → Service layer → API call.
- No secrets in any file. All config via environment variables. Never hardcode API keys.
- Railway deploys on push to main. Vercel deploys dashboard on push to main.
- Regulatory: SSRI intake is non-controlled. Do NOT build stimulant/controlled-substance flows without explicit clinical protocol sign-off from Sagar.
