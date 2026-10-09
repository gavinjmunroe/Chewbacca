---
name: project_clay_togari_bidirectional
description: "Clay ↔ Togari bidirectional integration build, scope, DNC design, Rytual open question, outbound Clay key"
metadata:
  node_type: memory
  type: project
  originSessionId: 4172a18a-e3b9-4915-b6d2-dc4f48081501
---

Building the FULL bidirectional Clay ↔ Togari integration in togari-platform (repo amber-organization/togari-platform, prod service togari-platform / togari-bma-prod.up.railway.app). Caleb chose the full mega build, not just Phase 1.

**Current state (inbound, live):** Clay pushes enriched rows in via `POST /webhooks/clay/companies` + `/contacts` (Bearer `CLAY_INGEST_API_KEY`, tag-routed to `togari_data_lake`, idempotent SHA-256 row_id, BigQuery insert). Source: `src/routes/ingest/clay-passthrough.ts`, mounted in `src/server.ts` at `/webhooks/clay`. A second HMAC route `/api/ingest/clay` exists but `CLAY_WEBHOOK_SECRET` is unset in prod.

**Phase 1 flagship:** one Clay HTTP call post-enrichment → `POST /webhooks/clay/lead` fans out in parallel to (1) DNC check [NEW], (2) Add to GCP/BigQuery [EXISTS], (3) Rytual audience sync [NEW]. Recommendation: a DNC hit BLOCKS the Rytual sync (don't distribute a suppressed lead).

**Karthik's decisions (2026-07-01):**

- DNC storage = BigQuery for now; Postgres considered for faster point lookups since the list is small, Caleb + Maggie to decide. Claude's recommendation: Postgres (or cached set) for the real-time gate since BigQuery point lookups are slow/costly; BigQuery stays for large-enterprise scale.
- Multiple DNC lists = separate tables each with a unique ID: BMA, Rytual, Amber (eventually).
- Outbound Clay key = use Caleb's key for now, stored as `CLAY_API_KEY` in Railway on togari-platform (NOT in git). Shared BMA general key TBD with Maggie.

**Rytual audience target = RESOLVED (Karthik, 7/1):** it's a BigQuery table, not an external Rytual API. Same pattern as the DNC lists, separate tables with unique IDs, one set per brand (BMA, Rytual, Amber eventually). So "sync to Rytual audience" = insert into the Rytual-branded audience table in BigQuery. This UNBLOCKS the flagship: all 3 fan-out branches (DNC screen, GCP insert, Rytual audience) are BigQuery ops. Residual detail: exact per-brand table names/IDs (Caleb can define via a routing map like TAG_ROUTING).

Docs: `docs/CLAY_INTEGRATION_BRIEF.md` (1-pager) + `docs/CLAY_INTEGRATION_ROADMAP.md` (full menu) in the repo, copies in ~/Downloads. Related: [[project_togari_strategy]], a private note.
