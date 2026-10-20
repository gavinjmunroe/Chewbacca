# Clay ↔ Togari Integration Roadmap

**Author:** Caleb Newton
**Reviewer:** Karthik
**Status:** Proposal — pre-build review
**Scope:** Enhancements to the Clay data-enrichment integration, both inbound and outbound

---

## 1. Where we are today

The integration is **inbound only**: Clay pushes finished company/contact rows into Togari; Togari never calls out to Clay.

**Live in production** (`togari-bma-prod`):

| Route                           | Auth                                          | Payload         | Destination                  |
| ------------------------------- | --------------------------------------------- | --------------- | ---------------------------- |
| `POST /webhooks/clay/companies` | `Authorization: Bearer <CLAY_INGEST_API_KEY>` | one company row | `togari_data_lake.companies` |
| `POST /webhooks/clay/contacts`  | same                                          | one contact row | `togari_data_lake.contacts`  |
| `GET /webhooks/clay/health`     | same                                          | —               | BigQuery reachability check  |

**Legacy HMAC batch route — now DISABLED** (`POST /api/ingest/clay`): persisted via per-row BigQuery DML (does not scale), so it is gated off and returns `501` unless `CLAY_HMAC_INGEST_ENABLED=true`. The passthrough route above is the supported path.

**Key implementation facts**

- Source: `src/routes/ingest/clay-passthrough.ts`, mounted in `src/server.ts` at `/webhooks/clay`.
- `tag` field routes to a dataset/table via `TAG_ROUTING` / `CONTACTS_TAG_ROUTING`. Only `"bma"` is wired today; unknown tags return `400 unknown_tag`.
- Column allowlist (125 company cols, 98 contact cols) is **hardcoded**, and now mirrored 1:1 by a committed migration (`sql/migrations/0027_togari_data_lake_ingest.sql`). Non-allowlisted keys are dropped and echoed back in `columns_dropped`.
- Dedup: `row_id` = SHA-256 of a natural key (companies: `tag + name + website`; contacts: `tag + name + email + company`) is passed as the BigQuery streaming **insertId** for best-effort dedup of retries. Durable long-window dedup is via a `ROW_NUMBER() OVER (PARTITION BY row_id ...)` view, not the raw table. Lineage columns (`_import_run_id`, `_imported_at`, `_source_file`) are stamped server-side.
- Auth: constant-time Bearer comparison (`CLAY_INGEST_API_KEY`).
- Rate limit: per-IP fixed window on `/webhooks/clay/*`, default 600/min (`CLAY_INGEST_RATE_LIMIT_PER_MIN`). Note: the `clay: 200` in `rate-limiter.ts` is the **outbound** Clay connector budget, not this inbound limit.

---

## 2. Phase 1 flagship: Lead enrichment → compliance & sync

**This is the first thing I want to build.** Everything in Sections 4–6 is the longer menu; this is the concrete near-term target.

**Goal:** after Clay finishes enriching a lead, it fires **one** HTTP API request into Togari. That single call handles compliance and distribution automatically — no extra Clay columns, no manual steps.

```
                         Clay enriches a lead
                                  │
                                  ▼
        POST /webhooks/clay/lead   (one HTTP API call, fires post-enrichment)
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
        1. DNC check        2. Add to GCP        3. Add to Rytual
        Screen against      Land enriched        audience
        Do-Not-Contact      record in our        Sync lead into the
        before any          GCP data store       Rytual workspace
        outreach            (BigQuery)           audience
                         ── runs in parallel ──
```

**Trigger:** a single HTTP API call from Clay, right after enrichment.

**Server-side fan-out (parallel):**

| Step                          | What it does                                                                                                   | Build status                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **1. DNC check**              | Screen the lead against a Do-Not-Contact suppression list before anyone reaches out. Flag/suppress if matched. | **New**                                         |
| **2. Add to GCP**             | Persist the enriched record to our GCP data store (BigQuery).                                                  | **Exists** — this is today's passthrough insert |
| **3. Add to Rytual audience** | Sync the lead into the Rytual workspace audience for distribution.                                             | **New**                                         |

**Why one endpoint instead of three Clay columns:** Clay stays simple (one HTTP API request), and the fan-out, ordering, and error handling live in Togari where we control them. The call returns an aggregated result (`{ dnc: {...}, gcp: {...}, rytual: {...} }`) so Clay can see what happened per branch.

**Design notes / decisions this raises:**

- **Parallel with a compliance gate.** DNC is a _compliance_ step. Decision: do we (a) run all three in parallel and just tag DNC hits, or (b) let a DNC hit _block_ the Rytual sync (don't distribute a suppressed lead)? Recommend **(b)** — screen first, and skip distribution on a match. Worth confirming.
- **Partial failure.** If GCP insert succeeds but Rytual sync fails, we return `207`-style per-branch status rather than failing the whole call. Clay retries are idempotent on our side already (`row_id`).
- **New endpoint vs extend existing.** Cleanest is a new `POST /webhooks/clay/lead` that internally calls the existing GCP insert plus the two new branches, rather than overloading `/companies`.

**Open questions specific to this workflow (need answers before build):**

- **F-1. DNC source of truth.** Where does the Do-Not-Contact list live — a BigQuery suppression table, an external compliance API, or both? What's the match key (email, phone, domain)?
- **F-2. Rytual audience API.** What's the actual endpoint/auth to push a lead into the Rytual workspace audience? Is this Rytual Health / Medha-side, or a third-party audience tool?
- **F-3. Block vs tag on DNC hit.** Confirm the recommended "block distribution on match" behavior above.
- **F-4. What counts as a "lead" here** — contact-level, company-level, or both in one payload?

---

## 3. Open questions for Karthik

Flagging these before any build starts — they change the design:

1. **Batching vs per-row.** Do we want to add an array/batch endpoint to get past 200 req/min for large Clay runs, or keep it strictly per-row and throttle Clay-side?
2. **Allowlist ownership.** Should the column allowlist stay hardcoded (deploy to change) or move to a config table / BigQuery-driven source so onboarding a field is not a deploy?
3. **Outbound direction.** Is Togari → Clay in scope for this quarter, or do we harden inbound first? (Outbound is the bigger lift and needs a Clay API key + credit budget.)
4. **Multi-tenant.** How many client tags do we expect near-term? That determines whether auto-onboarding of unknown tags is worth building.
5. **Dataset conventions.** `TAG_ROUTING` currently hardcodes `togari_data_lake`. Confirm the target dataset naming per new client so I match your infra layout.

---

## 4. Inbound roadmap (Clay → Togari)

Enhancing the existing, live path.

### 4a. Data quality & routing

| #   | Item                                                       | Effort | Notes                                          |
| --- | ---------------------------------------------------------- | ------ | ---------------------------------------------- |
| I-1 | Multi-tenant tag routing (add clients beyond `bma`)        | S      | One line per tag today; consider config-driven |
| I-2 | Auto-onboard / quarantine unknown tags instead of 400      | M      | Route to a review table vs hard reject         |
| I-3 | Config-driven column allowlist (no deploy to add fields)   | M      | Depends on Q2 above                            |
| I-4 | Field validation & coercion (numbers, emails, domains)     | M      | Reject or flag malformed rows                  |
| I-5 | Cross-source dedup (Clay + DealCloud + Grata → one record) | L      | Needs a shared entity-resolution key           |
| I-6 | Enrichment provenance (which Clay table/workbook)          | S      | Extend lineage columns                         |

### 4b. Reliability & observability

| #    | Item                                                | Effort | Notes                          |
| ---- | --------------------------------------------------- | ------ | ------------------------------ |
| I-7  | Dead-letter queue for failed inserts                | M      | Retryable, no lost rows        |
| I-8  | Ingest dashboard (rows in, drops, failures by tag)  | M      |                                |
| I-9  | Slack alerts on breakage / spikes / new unknown tag | S      | Reuse existing Slack transport |
| I-10 | Idempotency receipts (new vs overwrite in response) | S      | Small change to insert logic   |
| I-11 | Batch endpoint (array of rows per request)          | M      | See Q1 — rate-limit relief     |

### 4c. Downstream automation (after data lands)

| #    | Item                                                 | Effort | Notes                                   |
| ---- | ---------------------------------------------------- | ------ | --------------------------------------- |
| I-12 | Auto-trigger scoring/tiering on new company          | M      | Hook into PeopleRank / tiering          |
| I-13 | Auto-materialize raw drop into structured tables     | M      | Removes manual ETL pass                 |
| I-14 | Notify agent on high-value arrivals (iMessage/Slack) | M      | "3 new targets matched your mandate"    |
| I-15 | Mandate matching on ingest                           | L      | Check rows against active mandates      |
| I-16 | DNC / Do-Not-Contact screening on ingest             | M      | Phase 1 flagship, Section 2 — needs F-1 |
| I-17 | Rytual audience sync on ingest                       | M      | Phase 1 flagship, Section 2 — needs F-2 |

---

## 5. Outbound roadmap (Togari → Clay) — net new

Does not exist today. This turns Clay into an on-demand research engine that Togari commands. Requires a Clay API key + credit budget (see Q3).

### 5a. Push work to Clay

| #   | Item                                                        | Effort | Notes                         |
| --- | ----------------------------------------------------------- | ------ | ----------------------------- |
| O-1 | On-demand enrichment (missing-data row → Clay → back)       | M      | Closes the loop               |
| O-2 | Bulk list dispatch (mandate list → Clay table)              | M      | Run waterfall on a whole list |
| O-3 | Re-enrichment on staleness (records older than X → refresh) | M      | Scheduled job                 |
| O-4 | Contact-finding jobs (companies in → decision-makers out)   | M      |                               |
| O-5 | Trigger-based enrichment (deal stage change → enrich)       | M      | Event-driven                  |

### 5b. Control & feedback

| #   | Item                                                      | Effort | Notes                    |
| --- | --------------------------------------------------------- | ------ | ------------------------ |
| O-6 | Enrichment status sync (pending/done, no double-requests) | M      |                          |
| O-7 | Cost guardrails (credit cap per run, spend per mandate)   | M      | Depends on credit budget |
| O-8 | Quality feedback loop (Togari corrections → Clay)         | L      |                          |
| O-9 | Waterfall orchestration (Togari picks providers/order)    | L      | Clay as executor         |

---

## 6. Bidirectional / bigger plays

| #   | Item                                                                   | Effort | Notes                                    |
| --- | ---------------------------------------------------------------------- | ------ | ---------------------------------------- |
| B-1 | Full round-trip pipeline (request → enrich → ingest → score → surface) | L      | The end state                            |
| B-2 | Chat-driven enrichment ("enrich these 20 companies")                   | L      | Agent orchestrates end to end            |
| B-3 | Clay as one of many sources (Grata/ZoomInfo/Exa same door)             | L      | Unify ingest + routing + dedup + scoring |
| B-4 | Two-way DealCloud bridge (Clay → Togari → DealCloud, and back)         | L      |                                          |
| B-5 | Field-level lineage graph across all hops                              | M      | Every field knows its origin             |

---

## 7. Recommended sequencing

A pragmatic order that ships value early and de-risks the big stuff:

1. **Ship the Phase 1 flagship (Section 2)** — the enrichment → DNC + GCP + Rytual fan-out. GCP already works; the net-new pieces are the DNC check and Rytual sync. Blocked only on F-1 / F-2 answers.
2. **Harden inbound** — I-1, I-9, I-10, I-7 (multi-tenant + alerting + receipts + DLQ). Low effort, high reliability payoff.
3. **Close the automation gap** — I-12, I-13 (auto-score + auto-materialize) so ingested data becomes useful without manual steps.
4. **Prove the outbound loop** — O-1 (single on-demand enrichment round-trip) as a spike, gated behind a credit cap (O-7).
5. **Scale outbound** — O-2, O-4, O-5 once the loop is proven.
6. **Bigger plays** — B-1/B-2 after both directions are solid.

**My pick for first build:** the **Phase 1 flagship (Section 2)**. It delivers a visible, end-to-end win (compliance built in from day one), reuses the GCP insert we already have, and only needs two new branches. I just need the DNC source (F-1) and Rytual audience API (F-2) nailed down to start.

---

_Effort legend: S = small (hours–1 day), M = medium (days), L = large (multi-day / needs design)._
