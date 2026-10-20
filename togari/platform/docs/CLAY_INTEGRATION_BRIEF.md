# Clay ↔ Togari — 1-Page Brief

**From:** Caleb → **Review:** Karthik · **Ask:** answers to Q1–Q4 so I can start Phase 1 · Full detail: `CLAY_INTEGRATION_ROADMAP.md`

### Today (live in prod)

Clay pushes enriched rows into Togari — inbound only, no outbound. `POST /webhooks/clay/companies` + `/contacts`, constant-time Bearer auth, per-IP rate limited, tag-routed to `togari_data_lake`, streamed into BigQuery with `row_id` as the insertId for best-effort dedup (durable dedup via a `row_id` view downstream). Source: `src/routes/ingest/clay-passthrough.ts`.

### Phase 1 flagship — what I want to build first

After Clay enriches a lead, it fires **one** HTTP call into Togari that fans out **in parallel**:

```
Clay enriches lead → POST /webhooks/clay/lead
        ├─ 1. DNC check      screen against Do-Not-Contact before outreach   [NEW]
        ├─ 2. Add to GCP     persist enriched record to BigQuery              [EXISTS today]
        └─ 3. Rytual sync    push lead into Rytual workspace audience         [NEW]
```

One endpoint, not three Clay columns — fan-out, ordering, and errors live in Togari where we control them. Returns per-branch status. **Recommendation:** a DNC hit _blocks_ the Rytual sync (don't distribute a suppressed lead).

### Decisions (Karthik, resolved)

- **Rytual audience target:** a **BigQuery table**, not an external Rytual API. Same pattern as the DNC lists — separate tables with unique IDs, one per brand. "Sync to Rytual audience" = insert into the Rytual-branded audience table. This unblocks the flagship: all three fan-out branches are BigQuery writes.
- **Multiple tables per brand:** separate tables, each with a unique ID — **BMA**, **Rytual**, and **Amber** (eventually) — for both DNC lists and audiences.
- **DNC storage:** BigQuery for now. Postgres is on the table for faster point lookups since the list is small — Caleb + Maggie to make that call. BigQuery stays the move for production / large-enterprise scale.
- **Outbound Clay key:** use Caleb's key for now (stored as `CLAY_API_KEY` in Railway). A shared BMA general key to be created with Maggie later.

### Still open

- **DNC store: BigQuery vs Postgres** — Caleb + Maggie decision. Recommendation: Postgres for the live per-lead screen (small list, fast point lookups); BigQuery for scale.
- **Per-brand table names/IDs** — exact IDs for each brand's DNC + audience tables. Minor; Caleb can define via a routing map (like `TAG_ROUTING`).

### After Phase 1 (menu, sized in the full doc)

- **Inbound hardening:** multi-tenant tags, Slack alerts, dead-letter queue, idempotency receipts.
- **Downstream automation:** auto-score/tier on ingest, auto-materialize into structured tables, agent notifications.
- **Outbound (net new, needs Clay API key + credit budget):** on-demand enrichment, bulk list dispatch, re-enrichment on staleness, cost guardrails.
- **End state:** full round-trip loop — request → enrich → ingest → score → surface — and Clay as one of many sources (Grata / ZoomInfo / Exa through the same door).

### Effort read

Phase 1 is **~2 new branches** (DNC + Rytual) on top of the GCP insert we already have. Fast to ship once Q1/Q2 are answered. Everything else is post-Phase-1 and sequenced in the full roadmap.
