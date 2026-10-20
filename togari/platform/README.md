# Togari Platform

**Togari Platform is the canonical GCP / data-warehouse / API-agent backend
for the Amber ecosystem.** It is the single source of truth for relationship
data, agentic tool surfaces (MCP + REST), and the connector ontology that
sits between Amber, amber-id, and every external system Amber reasons over.

> Togari Platform is the canonical platform.
> `togari-enterprise` is **not** a separate platform — enterprise-grade
> activation (SSO, isolated tenants, deeper audit, tighter rate-limits) is a
> **capability boundary** that sits *on top of* Togari Platform, not a fork
> of it. All deploys, schemas, and APIs flow through this repo.

This repository ships as the npm package `@togari/admin` and deploys to
Google Cloud Run as the `togari-admin` service.

---

## Where Togari Platform sits in the Billion Dollar Build

| Surface          | Role                                                       |
| ---------------- | ---------------------------------------------------------- |
| **Amber (B2C)**  | "Perplexity for People." User-facing product. Where the relationship intelligence lives for the end user. |
| **amber-id**     | The user's private passport. Identity, consent, and the wallet of which connectors are linked. Never embedded in B2C feature code. |
| **Togari Platform (this repo)** | The warehouse complement. Owns the BigQuery datasets (`togari_pdw`, `togari_data_lake`), the agentic tool surface (MCP + REST), connector resilience, and the audit trail. Amber reads/writes via this layer, never directly against vendor APIs. |
| **Perplexity Computer** | The operating engine that drives Amber and Togari workflows — research, reasoning, and agent execution. Not an optional integration; it is the runtime that Amber assumes. |

Enterprise activation (later): a capability gate over the same datasets and
tool surface — different IAM, different rate-limits, different audit
retention — same code path.

---

## Business doctrine (non-negotiable)

These are not nice-to-haves. They are how the product is shaped.

1. **Amber is Perplexity for People.** The B2C experience is research-grade
   reasoning over a user's own relationships and history. Every feature
   should be measured against that bar.
2. **Use the Perplexity API wherever it is useful.** For research,
   reasoning, and agent workflows, default to Perplexity unless there is a
   specific reason a different model is required (e.g. Anthropic for
   tool-use loops in this repo today). Do not invent a homegrown
   substitute.
3. **Perplexity Computer is the operating engine.** Agentic workflows for
   Amber and Togari run on Perplexity Computer. Treat it as the runtime —
   not as a vendor we might swap.
4. **amber-id stays private.** No B2C feature reaches into amber-id
   internals. Identity flows through documented contracts only.
5. **Togari Platform is the canonical backend.** New datasets, new
   connectors, new agent tools land here. There is no second backend.

---

## What ships in this repo

- **`src/server.ts`** — Cloud Run entrypoint. Hosts the MCP server, the
  REST API (`/api/v1/*`), Slack events, Smartlead webhooks, and the
  `/deals/write` admin endpoint.
- **`src/core/`** — Shared engine: Claude tool-use loop, intent router,
  prompts, models, and the canonical implementations of deal-ops,
  meeting-intel, email-ops, proposal-ops, calendar-ops.
- **`src/transports/mcp/`** — Model Context Protocol server exposing the
  core engine as MCP tools.
- **`src/transports/api/`** — REST transport for the same core engine.
- **`src/bigquery/`** — BigQuery client with parameterized-query
  enforcement and audit-log writes.
- **`src/pdw/`** — Personal Data Warehouse: schema and adapters
  (Gmail, Fireflies, Drive, Loom) for the `togari_pdw` dataset.
- **`src/agents/`** — Slack-sync and Smartlead-responder agents that drive
  the core engine.
- **`src/resilience/`** — Connector registry, circuit breakers, rate
  limiters per upstream.
- **`src/secrets/`** — 3-tier secret resolution (env → Secret Manager →
  static config) with a typed catalog.
- **`src/auth/`** — Auth0 / OAuth JWT verification for protected MCP
  routes.
- **`src/config/connectors.ts`** — The connector ontology. Adding a new
  external system starts here.
- **`sql/pdw_create_tables.sql`** — DDL for the `togari_pdw` dataset.

---

## GCP footprint (canonical project: `midyear-glazing-485303-u3`)

- **Cloud Run service**: `togari-admin` (this repo)
- **BigQuery datasets**:
  - `togari_pdw` — Personal Data Warehouse (persons, interactions,
    relationships, ingestion_runs)
  - `togari_data_lake` — operational tables (`togari_structured_deals`,
    audit log)
- **Secret Manager**: secrets resolved via `src/secrets/manager.ts` from
  the keys listed in `src/secrets/known-secrets.ts`
- **Pub/Sub**: `src/events/publisher.ts` (event bus seam)
- **Cloud Storage**: raw-content blobs referenced by
  `togari_pdw.interactions.raw_content_gcs_uri`

---

## Handoff

For the GCP / data-warehouse / API-agent backend handoff to Karthik —
including the deploy order, the env-var checklist, the IAM matrix, the
first smoke tests, and open decisions — see:

**[`docs/KARTHIK_GCP_HANDOFF.md`](docs/KARTHIK_GCP_HANDOFF.md)**

---

## Local development

```bash
npm install
npm run typecheck      # tsc --noEmit
npm test               # vitest run
npm run dev            # tsx watch src/server.ts (port 4000)
npm run build          # tsc + esbuild bundle for Cloud Run
```

The service expects `GCP_PROJECT_ID`, `GCP_CREDENTIALS_BASE64` (or
`GOOGLE_CREDENTIALS_BASE64`), and `ANTHROPIC_API_KEY` at minimum. The full
env-var checklist lives in the handoff doc.

---

## Conventions

- Project conventions and Claude Code instructions live in
  [`CLAUDE.md`](CLAUDE.md).
- Phase-1 refactor inventory and follow-ups: [`docs/phase1-inventory.md`](docs/phase1-inventory.md), [`docs/phase1-followups.md`](docs/phase1-followups.md).
- No secrets in this repo. Ever. Use Secret Manager.
