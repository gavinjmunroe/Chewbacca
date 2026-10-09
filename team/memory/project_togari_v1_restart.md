---
name: project-togari-v1-restart
description: "Togari V1 restart (2026-07-13), conversational data platform for Sagar, schema wiped clean, Sagar-only scope"
metadata:
  node_type: memory
  type: project
  originSessionId: b8c2191a-852a-4e12-9347-7b620434adb2
---

On 2026-07-13 Caleb wiped `togari_data_lake` clean to rebuild Togari V1 from scratch (backup at `~/Downloads/togari_backup_20260713`, JSON authoritative + CSV + DDL; only `users` + `client_api_keys` preserved). Nothing else in GCP touched, Medha, `togari_sourcing_48north` (48North DealCloud mirror), healthcare, CMS all off limits.

**North star (Caleb's "biggest thing"):** Togari is NOT a fixed CRM. It is a conversational data platform, Sagar talks to it via MCP in Perplexity and creates any architecture he wants (entities, fields, pipelines, relationships) by talking. Build an entity-agnostic core (entity-type registry + typed fields persisted in BigQuery, no migrations), not hardcoded deal tables.

**V1 decisions (Sagar-only, make it perfect for him first):**

- "Client" = Meaning 2: a lead/company worked through the full pipeline; track every step. Deal-centric, flexible.
- Live sync of Sagar's Google, Slack, Fireflies: once a day + on command. Cloud-side (Togari on Railway holds keys and calls APIs; Perplexity just asks, NOT local Perplexity/Claude calling APIs).
- Any file Sagar drops attaches to a specific client AND lands in a searchable context store (ask across everything). Seamless is the bar.
- Rytual = Sagar's own GTM Clay workspace; wired both ways. His Clay key set as Railway `CLAY_API_KEY` (togari-platform service).
- Perplexity is the only surface for V1; Claude Code is dev-only.
- Order of generalization (Karthik's call): perfect for Sagar → then all BMA members (per-user connectors) → then other orgs. See [[project_togari_honest_state_2026_05_30]] and [[project_togari_aij_decisions]].

**Phases built 2026-07-16 (all committed + pushed to main, Railway auto-deploy):**

- Phase 1: store wiped clean; legacy deal tools gated off behind TOGARI_LEGACY_TOOLS_ENABLED=true (default off) so Sagar sees only the clean V1 surface.
- Phase 2: togari_ingest_file ingests ANY file (PDF/image read natively by Claude document/image blocks; csv/xlsx/json via existing parsers) → searchable context + extracted tasks. Semantic/vector search deferred (recency+keyword works at scale).
- Phase 3 (talk-to-shape): schema registry + tools accept 'client' AND any new record type Sagar names; entity params are free strings normalized via normalizeEntity(). No migration to add a field/record type.
- Phase 5 (Clay both ways): inbound action=client on POST /clay/v1/sync maps any Clay row → V1 client; outbound togari_clay_push_clients pushes clients back to a Clay webhook. Reused the pre-existing Clay connector + outbound client.
- Also fixed live-test bugs: togari_ask now reads attached context (was matching whole question as one LIKE); task_update no longer false-negatives (existence SELECT vs unreliable numDmlAffectedRows).
- V1 tool surface lives in src/mcp/tools/v1.ts + src/v1/service.ts; migration 0032 = clients/client_tasks/client_context. Backup of pre-wipe data at ~/Downloads/togari_backup_20260713.
