# amber-core

The Amber platform foundation — memory engine, people graph, REST API, and background worker. All Amber personal agents are powered by this layer.

**Railway project**: https://railway.com/project/86f528df-931a-40e9-9bf4-c5a65b17a516

---

## Architecture

```
amber-core/
  apps/
    api/       — REST API (Express + Postgres + pgvector) → Railway
    worker/    — Background jobs (drift detection, reminders) → Railway
  packages/
    shared-types/    — TypeScript domain types (Person, Memory, ActionItem...)
    memory-engine/   — Ingestion + extraction via Claude
    people-graph/    — Hybrid search: semantic + structured + trust ranking
    storage/         — GCP Cloud Storage adapter (photos, transcripts, exports)
    prompts/         — Shared prompt templates
```

---

## Live Services

| Service | URL | Description |
|---|---|---|
| `amber-core-api` | https://amber-core-api-production.up.railway.app | REST API — people, memories, action items, approvals |
| `amber-core-worker` | internal only | Background jobs — drift detection, proactive suggestions |

---

## API

Base URL: `https://amber-core-api-production.up.railway.app`

Auth: `Authorization: Bearer <AMBER_API_KEY>`

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/people` | List all people |
| `GET` | `/api/people/search?q=` | Hybrid semantic + structured search |
| `POST` | `/api/people` | Create a person |
| `POST` | `/api/memories` | Ingest a memory |
| `GET` | `/api/memories` | List memories |
| `GET` | `/api/action-items` | Open action items |
| `GET` | `/api/approvals` | Pending approvals |
| `PATCH` | `/api/approvals/:id` | Approve or reject |

---

## Storage

- **Database**: Postgres with `pgvector` extension (add via Railway dashboard)
- **File storage**: GCP Cloud Storage (photos, transcripts, Loom, Fireflies, exports)

### GCP Setup

1. Create a GCP project and Cloud Storage bucket (e.g. `amber-assets`)
2. Create a service account with `Storage Object Admin` role
3. Download the JSON key
4. Set `GCP_SERVICE_ACCOUNT_JSON` env var in Railway

---

## Deploy

This is a pnpm Turborepo monorepo. Both services deploy from this single repo using a `SERVICE` env var to select which app to start.

### Railway Setup

```bash
railway login
railway init --name "amber-core"

# API service
railway add --service amber-core-api
railway variables set SERVICE=api ANTHROPIC_API_KEY=... AMBER_API_KEY=... --service amber-core-api
railway domain --service amber-core-api

# Worker service
railway add --service amber-core-worker
railway variables set SERVICE=worker ANTHROPIC_API_KEY=... AMBER_API_URL=https://amber-core-api-production.up.railway.app --service amber-core-worker

# Deploy both
railway up --service amber-core-api --detach
railway up --service amber-core-worker --detach
```

### Database Schema

After provisioning Postgres on Railway:

```bash
psql $DATABASE_URL < apps/api/src/db/schema.sql
```

---

## Development

```bash
pnpm install
pnpm dev        # starts all services in watch mode
pnpm build      # builds all packages
pnpm type-check # TypeScript check
```

---

## Messaging

All Amber agents use [Loop Message](https://loopmessage.com) for iMessage delivery.

- **API**: `POST https://a.loopmessage.com/api/v1/message/send/`
- **Auth**: `Authorization: <LOOP_API_KEY>` (no Bearer prefix)
- **Body**: `{ contact, text, sender }` where `sender` = sender UUID from dashboard
- **Incoming**: webhook `POST /webhook` — payload: `{ event, contact, text, message_id }`
