# Togari Discovery Summary

Prepared for Sagar. Grounded in a full read of `togari-platform` **and a live inspection of the production BigQuery warehouse** (`midyear-glazing-485303-u3`) on 2026-07-10. No code, data, or infrastructure was changed — all warehouse access was read-only (`bq ls` / `bq show` / `SELECT`).

> **Important correction vs. a code-only view:** the deployed warehouse is **far more built-out than this repository**. Several things I would have called "missing" from the code alone are in fact **deployed** (DNC, opportunity/signal alerts, per-client pipelines, a vertical CRM template, paid data-pulls). The repo is a fraction of the real system, so the questions below are grounded in what is actually running.

## What Togari currently is

Togari is a **single-tenant (BMA) organizational CRM + data warehouse with a wide set of productized capabilities deployed but thinly used.** Concretely, in production:

- **One tenant/org: `bma`.** `togari_data_lake.users` has 7 users, all `tenant_id = bma`. `togari_dnc.contacts` has 4,323 contacts, all `org_id = bma`.
- **A "client" dimension of ~40 BMA clients** modeled as `client_id` values like `aij_communications_06302026`, `48north_06262026`, `rytual_06302026`, `serif_health_04022026` (`togari_data_lake.togari_structured_deals`: **42 deals across 42 clients — one deal each**).
- **AIJ Communications already exists as a client** — `client_id = aij_communications_06302026`, `client_brand = bma`, with exactly **one deal**: "AIJ Communications", stage `proposal_sent`, pipeline `outbound`, value **$3,800**. AIJ is a small live BMA client, not a hypothetical.

On top of that CRM, these capabilities are **deployed** (schemas live in BigQuery), though most carry little or no real data yet:

- **DNC / suppression layer** (`togari_dnc`): `contacts` (4,323 rows, `is_dnc`/`dnc_reason`/`dnc_added_at`, `owner_did`, `org_id`, Apple + social sync, realness scoring), `social_connections` (`is_dnc` clustered), staging tables, `sync_log`, and unified views `v_dnc_unified`, `v_dnc_unified_by_owner`, `v_dnc_only`, `v_contacts_enriched`. **Populated, but 0 contacts are currently flagged `is_dnc`.**
- **Opportunity / signal-alert product** (`togari_data_lake`): `opportunity_subscriptions` (a subscriber sets a `signal_query` + target criteria, `notification_channels`, `clay_table_webhook_url`, Stripe billing, `monitor_frequency`), `signal_results` (`matched_contacts`/`exa_results`), `notification_history` (channel, matches, `enrichment_cost_usd`). **There is a live active enterprise subscription** (`caleb@bluemodernadvisory.com`).
- **Per-client pipelines** (`togari_data_lake.pipeline_stages`): `client_id`-scoped stages with `auto_rules` JSON. **Currently 0 rows** (schema deployed, unused).
- **Activity log** (`togari_data_lake.activities`: deal_id/client_id/contact_id/type/content).
- **Paid data-pull product** (`togari_data_lake.data_pull_requests`: `natural_language_query` → CSV, Stripe checkout, cost). Only `test-qa-client` rows so far.
- **A vertical CRM template** (`togari_healthcare`: companies/persons/relationships/touchpoints/scoring_history/campaigns, all `client_id`-clustered, with `composite/internal/external_score`, personas, verticals). **Empty** — a provisioned template.

And these run live from the repo: the **BMA Slack/REST deal agent** (`src/core/engine.ts:842`), **inbound Clay passthrough** (`src/routes/ingest/clay-passthrough.ts` → `togari_data_lake.companies|contacts`), **Fireflies capture** (`src/transports/webhooks/fireflies.ts`), **email draft/send** as `sagar@bluemodernadvisory.com`, and the **MCP server** (deal/email/meeting tools + Exa + ZoomInfo).

## What is working

- The BMA deal agent end-to-end (Slack + `/api/v1/*` + MCP); inbound Clay passthrough with raw-column preservation + lineage; Fireflies ingestion; per-tenant encrypted secrets (`togari_core.tenant_secrets` — note the caveat below); per-org MCP token issuing (`scripts/issue-token.ts`).
- The DNC data layer and the opportunity/signal product are **deployed and partially in use** (Caleb's subscription is live).
- Raw-source preservation + provenance is consistent (`row_id`, `_import_run_id`, `_imported_at`, `_source_file`, `raw_platform_data` JSON, `source_detail` JSON).

## What is incomplete

- **DNC has infrastructure but no enforcement in the agent path.** The store, flags, and views exist; nothing in the outbound/email/Clay code reads `is_dnc` to block anything, and 0 contacts are flagged. It's a database, not yet a control.
- **Per-client pipelines and the healthcare vertical are empty schemas** — deployed, unused.
- **The CRM is thin** — 42 clients, one deal each. It is a lightweight book, not yet an operational system of record.
- **Tool-use loop migration** is flag-gated (`TOGARI_TOOL_LOOP_ENABLED`); PDW Gmail/Drive/Loom adapters exist but aren't wired to a scheduler.

## What is missing entirely

- **Any client-facing tenant / portal / login.** There is no "Joe" user, no client login, no portal. Clients are `client_id` rows that BMA staff operate on; none is a first-class tenant with its own users.
- **`togari_core` dataset** — it **does not exist in production** (confirmed via `bq ls`). This is why the entire PE-sourcing MCP suite (mandates/tiering/enrichment/companies/contacts/datapoints/clay/costs/admin) is disabled (`src/transports/mcp/server.ts:27-44`). The sourcing engine is coded but dark.
- **Outbound Clay** — `CLAY_API_KEY` is defined (`.env.example:60`) but unused; only read-only import-log tools exist (`src/mcp/tools/clay.ts`).
- **Document processing** (PDF/Office/image/OCR/vision), **free-form unstructured→entities pipeline**, **semantic/vector search** — none exist (all search is SQL/`LIKE`).

## The most important architectural discovery

**Tenancy is keyed four different ways across the deployed system, and no single key is canonical:**

- `tenant_id = bma` (repo's newer tables: `users`, `togari_reminders`, `togari_invocations`, `tenant_secrets`).
- `client_id = <name>_<MMDDYYYY>` (the CRM: `togari_structured_deals`, `pipeline_stages`, `activities`, `data_pull_requests`, and the `togari_healthcare` vertical).
- `org_id = bma` + `owner_did` (the DNC/contacts layer: `togari_dnc.*`).
- `client_brand ∈ {bma, amber, rytual, togari}` (a secondary axis on deals).

So "a tenant," "a client," "an org," and "an owner" are represented by different columns in different datasets. Unifying these is the single biggest determinant of whether AIJ can cleanly become an isolated, client-facing tenant.

## The biggest mismatch between the existing system and the intended product

Sagar wants **AIJ/Joe as a client-facing tenant, controlled through Perplexity, with DNC and opportunity-email workflows.** What exists is **BMA-internal:** AIJ is one `client_id` (a $3,800 outbound proposal) inside the single `bma` tenant that BMA staff operate; the DNC and opportunity products are wired to BMA/Caleb, not to a client login. The capabilities Sagar wants are **mostly already deployed** — the gap is **(a) unifying the tenancy keys, (b) promoting a `client_id` (AIJ) to a real tenant with a user (Joe), and (c) turning the DNC/opportunity data layers into client-facing, enforced workflows.** This is assembly and product definition far more than green-field building.

## The safest and fastest path toward the intended system

1. **Pick and unify the tenancy key** (P0-01, P0-13) — decide whether `client_id` becomes the canonical tenant key and reconcile `tenant_id`/`org_id`/`owner_did` to it.
2. **Promote AIJ to a real tenant** with Joe as its first user, scoped to `client_id = aij_communications_06302026`.
3. **Turn DNC from a store into a control** — add the enforcement read (`is_dnc`) into every outbound/export/Clay path; the data layer already exists.
4. **Point the opportunity/signal product at AIJ** and define the client-facing "opportunity email" on top of the existing `opportunity_subscriptions`/`signal_results`/`notification_history` machinery.
5. **Expose it through the existing MCP + a portal shell**, using the per-org token issuer that already works.

---

# Architecture Found

| Area                      | Status                                                                                                                                                                                                                                            | Evidence                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Frontend**              | **Unknown / deferred** — Colin is building in his own repo and will share Monday. (The `amber-organization/togari-frontend` repo is a separate/legacy 48N sourcing dashboard on mock data — not Colin's current work; excluded from conclusions.) | per Caleb, 2026-07-10                                                                    |
| **Backend (engine)**      | **Working** (BMA deal agent) / **Partial** (tool-loop flag-gated)                                                                                                                                                                                 | `src/core/engine.ts:842`; `src/core/tool-registry.ts:266-514`                            |
| **Authentication**        | **Working but fragmented** — MCP: Auth0 JWT + URL-token JWT + legacy bearer + **dev-anon admin fallback**; REST: shared `X-Togari-Key` (or open in dev); `/deals/write`: **no auth**                                                              | `src/mcp/auth.ts:122-262`; `src/transports/api/router.ts:36-54`; `src/server.ts:425-488` |
| **Database**              | **Working, richer than repo** — BigQuery datasets live: `togari_data_lake`, `togari_dnc`, `togari_healthcare`, `togari_audit`, `togari_sourcing_48north`. **`togari_core` absent.** App-layer isolation, **no RLS**                               | live `bq ls`; `sql/README.md`                                                            |
| **GCP**                   | **Working, accessible** — project `midyear-glazing-485303-u3` (shared with Medha: `medha_*` datasets present); we are authed as `togari-mcp-…` SA                                                                                                 | live `gcloud`/`bq`                                                                       |
| **Railway**               | **Working** — current deploy target (`node dist/server.cjs`)                                                                                                                                                                                      | `railway.json`                                                                           |
| **Cloud Run**             | **Aspirational** — README-canonical, not confirmed live                                                                                                                                                                                           | `README.md:14-16` vs `railway.json`                                                      |
| **MCP**                   | **Working (subset)** — live: 12 deal/email/meeting tools + `togari_hello` + 4 Exa + 5 ZoomInfo. **Disabled**: 9 sourcing modules (`togari_core` missing)                                                                                          | `src/transports/mcp/server.ts:27-44,62-74`                                               |
| **Clay (inbound)**        | **Working** (passthrough) / **Disabled** (legacy HMAC, 501)                                                                                                                                                                                       | `src/routes/ingest/clay-passthrough.ts`; `src/routes/ingest/clay.ts:45-52`               |
| **Clay (outbound)**       | **Missing** — `CLAY_API_KEY` unused; read-only import-log tools only                                                                                                                                                                              | `src/mcp/tools/clay.ts`; `.env.example:60`                                               |
| **CRM**                   | **Working (thin)** — 42 clients × 1 deal in `togari_structured_deals`; `pipeline_stages`/`activities` deployed; per-client CRM template in `togari_healthcare` (empty)                                                                            | live queries                                                                             |
| **DNC**                   | **Deployed, unused as a control** — `togari_dnc` populated (4,323 contacts, 0 flagged); enforcement not wired into agent                                                                                                                          | live `togari_dnc.*`; `v_dnc_unified`                                                     |
| **Opportunity / signals** | **Deployed, live subscription** — `opportunity_subscriptions`/`signal_results`/`notification_history`, Stripe billing                                                                                                                             | live `togari_data_lake.opportunity_subscriptions`                                        |
| **AI**                    | **Working** — Anthropic Claude is the runtime (`claude-sonnet-4-6`). Perplexity used only for enrichment fit-scoring (`sonar`), not the "operating engine" the README claims. OpenAI dep unused                                                   | `src/config/models.ts:5-10`; `README.md:26`                                              |
| **Ingestion**             | **Working**: Clay passthrough, Fireflies, CSV script, Gmail/Fireflies adapters. **Missing**: JSON/PDF/Office/images/OCR/Slack/audio/free-form-text                                                                                                | `src/routes/ingest/`, `src/pdw/adapters/`                                                |
| **Search**                | **Working (SQL only)** / **Missing (semantic)** — no vectors                                                                                                                                                                                      | `src/bigquery/sql-generator.ts`                                                          |
| **Background processing** | **Working** — Pub/Sub worker (tiering + enrichment), DLQ, backpressure; in-process behind `TOGARI_WORKER_ENABLED`                                                                                                                                 | `src/worker/*`                                                                           |
| **Deployment**            | **Working (manual)** — Railway auto-deploy on push; no CI; migrations manual via `bq query`; **repo migrations lag deployed schema**                                                                                                              | `railway.json`; `sql/README.md`; live schema drift                                       |

---

# Decisions You Can Make Without Sagar

| #   | Decision                              | Recommendation                                                                                                                                            | Reason                                                                                          | Evidence                                      | Reversibility | Risk |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------- | ---- |
| D1  | Canonical dataset                     | Declare `togari_data_lake` canonical; treat `togari_core` as retired (it doesn't exist in prod)                                                           | Live data is here; sourcing dataset never created                                               | `bq ls`; commit `50882f4`                     | Reversible    | Low  |
| D2  | Source of truth for schema            | Treat **deployed BigQuery as source of truth** and backfill the repo migrations to match, so the code stops lying about the schema                        | Repo migrations (27) omit `pipeline_stages`, `opportunity_subscriptions`, DNC, healthcare, etc. | live vs `sql/migrations/*`                    | Reversible    | Med  |
| D3  | Deploy target (near-term)             | Keep Railway canonical; defer Cloud Run                                                                                                                   | Railway runs today                                                                              | `railway.json` vs `README.md:14`              | Reversible    | Low  |
| D4  | Raw-source preservation + idempotency | Keep raw-columns + `row_id`=SHA-256 natural key + lineage; reuse for every new source                                                                     | Proven in passthrough                                                                           | `clay-passthrough.ts:449-456`                 | Reversible    | Low  |
| D5  | Dynamic "schema" mechanism            | Custom fields as key/value **rows** + JSON columns (`enrichment_data`, `source_detail`, `raw_platform_data` already exist), never NL-driven `ALTER TABLE` | Pattern already deployed                                                                        | `togari_dnc.contacts.source_detail:JSON` etc. | Reversible    | Low  |
| D6  | Close dev-anon MCP admin hole         | Require `ALLOW_DEV_ANON=true` before the anonymous-admin fallback is honored                                                                              | Absent auth env vars → anyone gets `role: admin`                                                | `src/mcp/auth.ts:236-262`                     | Reversible    | Med  |
| D7  | Auth on `/deals/write`                | Put it behind the same key/JWT as `/api/v1/*`                                                                                                             | Unauthenticated BigQuery writer                                                                 | `src/server.ts:425-488`                       | Reversible    | Med  |
| D8  | DNC enforcement seam                  | Add a single `isDnc(email\|domain\|person)` check (reads existing `v_dnc_unified`) into outbound/export/Clay paths                                        | Store exists; only the read is missing                                                          | `togari_dnc.v_dnc_unified`                    | Reversible    | Med  |
| D9  | Testing/CI                            | Add a minimal GitHub Actions typecheck+test gate                                                                                                          | No CI today                                                                                     | no `.github/workflows`                        | Reversible    | Low  |
| D10 | Perplexity doctrine vs reality        | Treat Anthropic as runtime, Perplexity as a research tool; fix the README                                                                                 | Code already works this way                                                                     | `README.md:26` vs `src/config/models.ts`      | Reversible    | Low  |

---

# Questions for Sagar

Answer each with a letter and one sentence.

## P0: Required before implementation

## P0-01: Do we promote AIJ from a `client_id` to a real tenant with Joe as a user?

**Why this must be answered:** AIJ exists today as `client_id = aij_communications_06302026` inside the single `bma` tenant, operated by BMA staff. A client-facing portal for Joe requires promoting that client to a first-class tenant with its own user and isolation. This decides the entire identity/data-scoping model.

**What the existing system appears to do:** 42 clients are `client_id` rows under `tenant_id = bma`; AIJ has one deal ($3,800, proposal_sent). There is no client login and no "Joe" user (`togari_data_lake.users` = 7 BMA users).

**Recommended default:** Promote AIJ to a tenant scoped by its existing `client_id`, add Joe as its first user, and keep BMA staff as cross-tenant operators.

**Question for Sagar:** Should AIJ become its own tenant (Joe logs in, sees only AIJ), or stay a `client_id` that only BMA staff touch?

**Answer options:**
A. Promote AIJ to a tenant keyed on its `client_id`; Joe is its first user (recommended)
B. Keep AIJ as a BMA `client_id`; no client login yet — BMA operates it for Joe
C. AIJ is a tenant, but Joe gets a read-only view only
D. Other

**What we will build if Sagar accepts the recommendation:** AIJ promoted to a client-facing tenant scoped by `client_id`, with Joe as user and BMA staff retaining cross-client access.

---

## P0-02: Which single key becomes canonical tenancy — `client_id`, `tenant_id`, or `org_id`?

**Why this must be answered:** Tenancy is keyed four ways across deployed data (`tenant_id=bma`, `client_id=<client>`, `org_id=bma`+`owner_did`, `client_brand`). Every isolation guarantee, join, and DNC lookup depends on picking one and reconciling the rest. This is the biggest architectural fork.

**What the existing system appears to do:** CRM uses `client_id`; repo tables use `tenant_id`; DNC uses `org_id`/`owner_did`. They don't line up.

**Recommended default:** Make `client_id` the canonical tenant key (it already scopes the CRM, pipelines, and the healthcare vertical), map `tenant_id`/`org_id` onto it, and keep `client_brand` as a secondary label.

**Question for Sagar:** Are you comfortable standardizing on `client_id` as the one tenant key, with the others mapped onto it?

**Answer options:**
A. Yes — `client_id` is canonical; reconcile the rest to it (recommended)
B. Use `tenant_id`; migrate `client_id` data onto it
C. Keep separate keys per subsystem (accept the fragmentation)
D. Other

**What we will build if Sagar accepts the recommendation:** A tenancy reconciliation that makes `client_id` the enforced isolation key across CRM, DNC, and MCP.

---

## P0-03: Turn DNC into an enforced control — what exactly must a suppression block?

**Why this must be answered:** The DNC store is deployed and populated (`togari_dnc.contacts`, 4,323 rows) but **0 are flagged and nothing enforces it.** We need the enforcement semantics to wire `is_dnc` into the agent/outbound paths.

**What the existing system appears to do:** `togari_dnc` has `is_dnc`/`dnc_reason`/`dnc_added_at` and unified views (`v_dnc_unified`), keyed by `owner_did`/`org_id` and matched on email/contact — but no code reads it to block anything.

**Recommended default:** A DNC flag **blocks outbound email, blocks Clay distribution/enrichment, and blocks export**, matched on **email + domain + person/contact id**, retained-but-flagged, with a reason and audit, applied retroactively to in-flight workflows.

**Question for Sagar:** When AIJ marks someone do-not-contact, which effects must be guaranteed, and on what match keys?

**Answer options:**
A. Block outbound email + Clay distribution + export; match email/domain/person; retain+flag+audit (recommended)
B. Block outbound email only; tag the rest
C. Full suppression + hide the record everywhere
D. Other (state the blocked actions + match keys)

**What we will build if Sagar accepts the recommendation:** An `isDnc()` gate reading `v_dnc_unified` before every outbound/export/Clay action, with reason + audit + retroactive stop.

---

## P0-04: Is the "opportunity email" the existing signal-subscription alert, and what is Joe's version?

**Why this must be answered:** The `opportunity_subscriptions` → `signal_results` → `notification_history` product is already live (Caleb has an active enterprise subscription). We need to confirm "opportunity email" means this, and define the AIJ/Joe-facing variant (who subscribes, who receives, sender identity, auto vs approved).

**What the existing system appears to do:** A subscriber sets a `signal_query` + targets; the system finds matches (Exa/Clay), and sends notifications by email/Slack with cost tracking. Sending live email is possible today as `sagar@bluemodernadvisory.com`.

**Recommended default:** "Opportunity email" = a notification generated from an AIJ opportunity_subscription; Joe requests/configures it in his portal; Togari drafts; a BMA human approves; it sends from a BMA/AIJ identity; the send is logged. No auto-send in v1.

**Question for Sagar:** Is the opportunity email the signal-alert notification, and for AIJ should it auto-send or go through BMA approval first?

**Answer options:**
A. Yes, it's the signal alert; Joe requests → Togari drafts → BMA approves → send → log (recommended)
B. It's the signal alert and should auto-send with no human in the loop
C. It's something different (describe trigger, recipient, sender, approval)
D. Other

**What we will build if Sagar accepts the recommendation:** An AIJ opportunity_subscription feeding a draft → BMA approval → tracked send, reusing the deployed signal/notification tables.

---

## P0-05: Does Togari/AIJ get its own GCP project, or share `midyear-glazing-485303-u3` with Medha?

**Why this must be answered:** The project is **shared with Medha** (`medha_audit`, `medha_conversations`, `medha_pdw`, etc. are all in the same project) and the id is hardcoded in 7+ files. Putting a _client's_ data in a project shared with another product line is a data-ownership and blast-radius decision that's expensive to reverse.

**What the existing system appears to do:** All Togari and Medha datasets live in one project; `src/server.ts:438` and others hardcode it.

**Recommended default:** Give Togari its own GCP project for client data and config-seam the hardcoded id; isolate AIJ by `client_id` within it.

**Question for Sagar:** Should client data live in a dedicated Togari GCP project separate from Medha, or stay in the shared project?

**Answer options:**
A. Dedicated Togari project for client data (recommended)
B. Keep the shared project; isolate by dataset/client only
C. Dedicated project per client (AIJ gets its own)
D. Other

**What we will build if Sagar accepts the recommendation:** A project-id config seam and AIJ data provisioned in a dedicated Togari project.

---

## P0-06: For the Joe portal, do we start with a focused DNC/opportunity flow or broad "submit anything"?

**Why this must be answered:** Sets the first-build ingestion scope. A focused flow leverages what's deployed; "submit any document" pulls in file upload, OCR, and free-form extraction (none of which exist yet).

**What the existing system appears to do:** No portal input exists. Ingestion supports Clay rows and Fireflies; no file upload, no document processing, no free-form pipeline.

**Recommended default:** Ship a DNC + opportunity-request flow that accepts structured fields **plus** free-form text and an optional file stored raw; extract from text/CSV first; defer PDF/image extraction.

**Question for Sagar:** For the first Joe demo, is a focused DNC + opportunity flow (fields + text + optional file) enough, or must Joe upload arbitrary documents from day one?

**Answer options:**
A. Focused DNC + opportunity flow; free-form text + optional raw file (recommended)
B. Broad "submit anything" incl. PDFs/images with extraction from day one
C. Structured forms only, no free-form, no files
D. Other

**What we will build if Sagar accepts the recommendation:** DNC + opportunity intake that preserves raw submissions and extracts structured records from text/CSV, with a raw-stored fallback for unsupported files.

---

## P0-07: Which MCP/Perplexity actions may fire real-world side effects without confirmation?

**Why this must be answered:** Full write access is the goal, but `send_email` sends live mail as Sagar and future tools may delete data. We need the exact unconfirmed-action boundary for Perplexity commands.

**What the existing system appears to do:** `send_email` is a live MCP tool (`src/transports/mcp/handlers.ts:253-265`); Slack has button-confirms, but MCP/Perplexity has no gate; no delete tools yet.

**Recommended default:** Reads, CRM writes, custom-field changes, and DNC records fire unconfirmed; **live email-send and hard deletes require one-tap confirmation** even via Perplexity.

**Question for Sagar:** May a Perplexity command do everything unconfirmed, or everything except live email-send and deletes?

**Answer options:**
A. Everything except live email-send and hard deletes (recommended)
B. Truly everything, including auto-send and deletes
C. Everything except any outbound (email/Clay/export)
D. Other

**What we will build if Sagar accepts the recommendation:** Unconfirmed CRM/schema/DNC writes; a lightweight confirm for email-send and deletes.

---

## P0-08: One MCP connector per organization, and can one person span multiple orgs?

**Why this must be answered:** Defines onboarding and how the connector resolves "which client am I acting on." The per-org token infra already exists; we need the intended shape.

**What the existing system appears to do:** `scripts/issue-token.ts` mints per-org JWTs with scoped datasets; tenant resolves from the token's `org_id` (`src/mcp/auth.ts:169-199`). Nothing models one user across orgs.

**Recommended default:** One connector (token) per organization; a multi-org person installs one per org; active org is fixed by the token.

**Question for Sagar:** One connector per org, and should a single user switch between multiple orgs inside one connector?

**Answer options:**
A. One connector per org; multi-org users install one per org (recommended)
B. One connector, user switches active org inside it
C. One connector per user, org chosen per request
D. Other

**What we will build if Sagar accepts the recommendation:** A per-org connector issuance flow in the portal, each token bound to one tenant.

---

## P0-09: When Togari "reorganizes data" via natural language, how visible and reversible must it be?

**Why this must be answered:** "Nontechnical users reorganize data via language" is core but is the highest-risk feature on _client_ data. We must set the mechanism and the visibility/undo requirement before building ingestion normalization.

**What the existing system appears to do:** No dynamic schema. JSON columns (`enrichment_data`, `source_detail`, `raw_platform_data`) and would-be key/value patterns exist; no custom-field registry, no rollback.

**Recommended default:** Implement schema changes as **custom fields/tables in a metadata registry (key/value + JSON)**, applied as visible, logged, reversible operations — never live `ALTER TABLE` from language; raw source always preserved.

**Question for Sagar:** Should inferred schema changes apply silently, or must the user see and be able to undo them?

**Answer options:**
A. Visible + reversible custom-field registry; raw preserved; no live DDL (recommended)
B. Silent and automatic; no undo needed
C. Proposed-then-approved per change
D. Other

**What we will build if Sagar accepts the recommendation:** A custom-field/table metadata layer with audit + undo.

---

## P0-10: What is the first AIJ workflow the demo must reproduce exactly?

**Why this must be answered:** AIJ is a communications/PR firm with one $3,800 outbound proposal today. We need the single real workflow the demo must nail, since the generic BMA pipeline model may not fit.

**What the existing system appears to do:** AIJ = one `outbound` deal at `proposal_sent`. Pipelines are BMA-brand channels; `pipeline_stages` (per-client, with `auto_rules`) is deployed but empty.

**Recommended default:** Model AIJ's DNC/compliance intake + suppression proof as the demo spine (concrete, valuable, uses deployed DNC data).

**Question for Sagar:** What is the one AIJ workflow the first demo must reproduce — DNC/compliance intake, opportunity generation → email, or an outreach pipeline?

**Answer options:**
A. DNC / compliance intake and suppression (recommended)
B. Opportunity generation → email (reuse signal product)
C. AIJ outreach pipeline (define its stages)
D. Other

**What we will build if Sagar accepts the recommendation:** A faithful AIJ DNC intake → suppression → proof workflow, with AIJ's real stages seeded into `pipeline_stages`.

---

## P0-11: What is ingestion source #2 after Clay, and is historical backfill required?

**Why this must be answered:** After Clay, the next wired source decides which adapter we finish (Gmail/Fireflies adapters exist but aren't scheduled). Backfill vs go-forward changes the build.

**What the existing system appears to do:** Clay passthrough is live; Fireflies webhook works; Gmail/Drive/Loom adapters exist but aren't scheduled; no backfill jobs.

**Recommended default:** Portal file/CSV upload is source #2 (self-serve, no OAuth); Gmail/Fireflies auto-ingest is third, go-forward only.

**Question for Sagar:** After Clay, what ingests next — portal upload, Gmail, or Fireflies — and do we need historical backfill?

**Answer options:**
A. Portal file/CSV upload next; Gmail/Fireflies later, go-forward only (recommended)
B. Gmail next, with backfill
C. Fireflies next, go-forward only
D. Other

**What we will build if Sagar accepts the recommendation:** A portal upload → raw-preserve → extract pipeline; defer OAuth ingestion.

---

## P1: Required before production rollout

## P1-01: Can BMA staff see all clients, and can a client (Joe) see BMA-internal notes?

**Why:** Defines the boundary enforced in every query once AIJ becomes client-facing. **Existing:** app-layer `client_id` filtering, no RLS; no cross-tenant role or internal-only field flag. **Recommended:** BMA staff = cross-client operators; Joe sees only AIJ, never internal notes. **Options:** A. BMA sees all, Joe sees AIJ only, internal notes hidden (recommended) B. Strict isolation even for BMA C. Joe can see BMA notes about AIJ D. Other. **We'll build:** a cross-client BMA operator scope + per-field internal-only flag.

## P1-02: Are people/companies globally deduplicated across clients, or siloed per client?

**Why:** `togari_dnc.contacts` is `owner_did`/`org_id`-scoped and heavily merged (`merge_count`, `sources`); the CRM is `client_id`-scoped. Cross-client dedup could leak client confidentiality. **Existing:** DNC contacts merge across sources within an owner; CRM is per-client. **Recommended:** siloed per client; a person may hold client-specific facts; no cross-client sharing without consent. **Options:** A. Siloed per client (recommended) B. Global record, shared facts C. Global identity, client-scoped facts D. Other. **We'll build:** client-scoped entity resolution.

## P1-03: May enriched/derived data (Exa/ZoomInfo/AI) be reused across clients?

**Why:** Reuse saves credits but may breach ownership. **Existing:** enrichment cost is logged per subscription/tenant; `enrichment_cost_usd` tracked in `notification_history`. **Recommended:** no cross-client reuse; each client owns/pays for its enrichment. **Options:** A. Strictly per-client (recommended) B. Reuse public firmographics C. Reuse everything D. Other.

## P1-04: Does Joe see status/history of his submissions and requests?

**Why:** Decides whether the portal needs a status lifecycle + activity feed. **Existing:** internal status columns exist (`sync_log`, `data_pull_requests.status`, `notification_history`) but nothing client-facing. **Recommended:** a simple per-request status timeline. **Options:** A. Yes, per-request timeline (recommended) B. Fire-and-forget v1 C. Final outcome only D. Other.

## P1-05: On a DNC hit during Clay distribution, block or tag?

**Why:** Core compliance behavior of the Clay flagship. **Existing:** roadmap F-3 recommends "block on match," unconfirmed (`docs/CLAY_INTEGRATION_ROADMAP.md:79`); DNC data exists to enforce it. **Recommended:** block distribution on match, report per branch. **Options:** A. Block on match (recommended) B. Tag and continue C. Block + alert internal D. Other.

## P1-06: DNC lifecycle — expiration, removal, reason, cross-system sync?

**Why:** Sets suppression schema + audit. **Existing:** `dnc_reason`/`dnc_added_at` exist; no expiry/removal flow; `sync_log` implies external sync intent. **Recommended:** match email+domain+contact id; reason required; optional expiry; reversible + audited; sync suppression outward. **Options:** A. email+domain+id, reason, optional expiry, reversible+audited (recommended) B. email only, permanent C. email+phone+domain, permanent D. Other.

## P1-07: Which Clay workspace/account does AIJ use — BMA's or its own?

**Why:** Decides where the Clay key lives and who pays. **Existing:** outbound `CLAY_API_KEY` is "Caleb's key" and unused; DNC has `contacts_clay_staging` (BMA-side Clay sync). **Recommended:** BMA's workspace now; per-tenant client keys supported later via `tenant_secrets`. **Options:** A. BMA now, client keys later (recommended) B. Client's own from day one C. Separate BMA workspace per client D. Other.

## P1-08: Portal connector-install UX, and is Perplexity Spaces part of onboarding?

**Why:** Defines onboarding UI. **Existing:** per-org token issuing works; no onboarding UI or Spaces flow. **Recommended:** portal shows a copy-paste connector URL + install steps; Spaces documented, not required for v1. **Options:** A. Connector steps only, Spaces optional (recommended) B. Guided Spaces in v1 C. Spaces is primary D. Other.

## P1-09: How are ownership, priority, and "overdue" defined for CRM automation?

**Why:** `pipeline_stages.auto_rules` (JSON) exists but is empty — automation needs concrete rules. **Existing:** deal `owner` = Slack id; no priority/overdue model; `auto_rules` unused. **Recommended:** priority = client>pipeline>prospect, revenue-weighted; overdue past `next_action_date`; owner defaults to last actor. **Options:** A. as recommended B. manual priority only C. recency-based D. Other.

## P1-10: What must Sagar and Tyler trust before dropping the spreadsheet/notebook?

**Why:** The real adoption bar; defines "done." **Existing:** live CRM is `togari_structured_deals` (42 thin records) driven from Slack. **Recommended:** reliable NL query+edit, activity/next-action tracking, daily priorities. **Options:** A. as recommended B. reliable deal list+stages only C. something specific (list it) D. Other.

## P1-11: How does a client deletion / data-removal request work?

**Why:** A client platform needs a defined deletion path. **Existing:** no delete MCP tools; raw preserved in JSON/GCS; DNC could double as re-ingest suppression. **Recommended:** soft-delete + flag; hard-purge raw on explicit request; audit; suppress re-ingest. **Options:** A. as recommended B. always hard-purge C. soft-delete only D. Other.

---

## P2: Can be answered during iteration

## P2-01: Inferred pipeline changes (from emails/transcripts) — silent, or surfaced for review?

**Recommended:** suggest-then-accept until trusted (fits empty `auto_rules`). **Options:** A. suggest-then-accept (recommended) B. silent auto-apply C. silent+logged with undo D. Other.

## P2-02: How does a user correct a bad AI extraction?

**Recommended:** inline edit on the derived record, raw preserved, correction logged. **Options:** A. inline edit (recommended) B. re-submit source C. none in v1 D. Other.

## P2-03: Retention policy for raw ingested content (JSON blobs, transcripts, files)?

**Recommended:** retain per tenant until deletion request; revisit at scale. **Options:** A. indefinite until deletion (recommended) B. fixed window C. client-configurable D. Other.

## P2-04: May client data improve shared models/schemas/prompts?

**Recommended:** never cross-tenant. **Options:** A. never (recommended) B. aggregate/anonymized only C. with consent D. Other.

## P2-05: Should production migrations run automatically on deploy?

**Recommended:** manual/reviewed until a runner + CI exist (repo already lags prod). **Options:** A. manual for now (recommended) B. auto on deploy C. auto in staging only D. Other.

## P2-06: Should Colin get a formal, versioned frontend integration contract (once he shares his repo Monday)?

**Recommended:** yes — publish OpenAPI + typed client against the deployed routes. **Options:** A. yes, OpenAPI + typed client (recommended) B. informal endpoint list C. not yet D. Other.

## P2-07: Does the first demo need multimodal (PDF/image) ingestion, or is it a fast follow?

**Recommended:** fast follow; store raw now, add extraction next. **Options:** A. fast follow (recommended) B. needed in v1 C. never D. Other.

## P2-08: Should the sourcing engine (`togari_core`) be revived, or retired?

**Recommended:** retired for now (dataset never created); revive on a client's demand and unify onto `togari_data_lake`. **Options:** A. retired, revive on demand (recommended) B. revive+unify now C. delete the code D. Other.

---

# Proposed First Demonstration

The most ambitious coherent demo the **deployed** architecture supports, mapped to reality.

1. **Joe signs in (Google/Auth0).** _Needs implementation_ — real Auth0 for an AIJ tenant; no client login exists.
2. **Joe enters the AIJ tenant.** _Mostly exists_ — promote `client_id = aij_communications_06302026` to a tenant; scope the session.
3. **Joe submits a do-not-contact request.** _Needs UI + enforcement; store exists_ — write to `togari_dnc` with `is_dnc=true`; DNC schema/views already deployed.
4. **Togari preserves raw + extracts structured suppression.** _Partially exists_ — raw-preserve patterns + JSON columns exist; the extractor is new.
5. **A Clay table flows into Togari for AIJ.** _Exists_ — `/webhooks/clay/*` live; point at the AIJ client/tag.
6. **Search/reason over both via Perplexity.** _Partially exists_ — MCP + Exa live; a tenant-scoped query tool over `togari_data_lake` is a thin add. No semantic search in v1.
7. **Add/update a CRM record via MCP.** _Exists_ — `create_deal`/`update_deal`/`log_activity` live (scope to AIJ `client_id`).
8. **Show DNC suppression working.** _Needs the enforcement read (D8)_ — block a suppressed contact from outbound/export; data already present.
9. **Joe requests an opportunity email.** _Mostly exists_ — create an AIJ `opportunity_subscription`; draft from `signal_results`; add BMA approval (P0-04).
10. **Show pipeline + activity history.** _Partially exists_ — seed AIJ `pipeline_stages`; `activities` table deployed.
11. **Send data back into Clay.** _Needs implementation_ — outbound Clay does not exist; finale or fast-follow.

**Demoable today:** inbound Clay, MCP CRM writes, Fireflies capture, email drafting, Perplexity connectivity, the live DNC/opportunity data.
**Needs implementation:** real Auth0 + AIJ tenant promotion, DNC enforcement read, portal forms, opportunity-email approval, outbound Clay, tenant-scoped search.
**Needs credentials:** real Auth0 app, AIJ Clay table, a sending email identity, GCP-project decision.
**Needs Sagar's answers:** P0-01 (tenant), P0-02 (key), P0-03 (DNC), P0-04 (opportunity email), P0-06 (portal scope).

---

# Recommended Build Order After Sagar Responds

Do not begin until P0-01/02/03/04/06 are answered.

1. **Architecture stabilization** — declare `togari_data_lake` canonical; backfill repo migrations to match deployed schema (D2); config-seam the GCP project id; close the dev-anon MCP hole (D6); auth `/deals/write` (D7); minimal CI.
2. **Tenancy unification + AIJ tenant** — pick the canonical key (P0-02), promote AIJ (`client_id`) to a tenant, add Joe; real Auth0; thread scope through MCP + REST.
3. **DNC as a control** — wire `isDnc()` (reads `v_dnc_unified`) into outbound/export/Clay (P0-03, P1-05/06).
4. **AIJ CRM** — seed `pipeline_stages` for AIJ; tenant-scoped deals/captures/activities.
5. **Raw ingestion + processing** — extend passthrough raw-preserve to portal file/text upload; extraction from text/CSV.
6. **Clay inbound for AIJ** — point passthrough at AIJ; reprocessing + failed-row visibility.
7. **Search/retrieval** — tenant-scoped NL query/search MCP tool; defer semantic/vector.
8. **MCP + Perplexity connector** — per-org connector in the portal; confirm-gated email-send/delete (P0-07/08).
9. **Joe portal workflows** — DNC submission, opportunity-email request + approval (on `opportunity_subscriptions`), status/history (P0-04, P0-06, P1-04).
10. **Gmail/Fireflies auto-ingest** — finish wiring adapters to a scheduler; go-forward only (P0-11).
11. **CRM intelligence** — populate `auto_rules`; inferred pipeline/priority as suggestions (P1-09, P2-01).
12. **Clay outbound** — net-new create/append/update/push via `CLAY_API_KEY`.
13. **Hardening + Colin handoff** — OpenAPI contract for his (Monday) repo, real-backed routes, RLS-equivalent review, migration runner.

---

# Access or Credential Blockers

| Blocker                                | Why needed                                             | Env / credential                                                              | Proceed without it?                  | Owner         | Next action                                 |
| -------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------ | ------------- | ------------------------------------------- |
| ~~GCP / BigQuery access~~ **RESOLVED** | Verified live datasets/tenants directly                | authed as `togari-mcp-…` SA on `midyear-glazing-485303-u3`                    | N/A — done                           | Caleb         | none                                        |
| Colin's frontend repo                  | Assess the real portal shell; define the REST contract | (repo URL, shared Monday)                                                     | Yes — backend proceeds independently | Colin         | get repo link Monday                        |
| Real Auth0 app for the portal          | Joe's login; promote AIJ to a client-facing tenant     | Auth0 `dev-4prs757badfajpi5.us.auth0.com`, client id/secret, `AUTH0_AUDIENCE` | No — portal login blocked            | Karthik/Sagar | provision an Auth0 app for AIJ              |
| AIJ Clay table                         | Route real AIJ Clay data                               | `CLAY_INGEST_API_KEY` (in), `CLAY_API_KEY` (out)                              | Partially — demo on a test table     | Sagar/Caleb   | confirm workspace (P1-07), create AIJ table |
| Sending email identity for AIJ         | Opportunity emails + outbound                          | Gmail domain-wide delegation / `GOOGLE_OAUTH_*`                               | No — email-send blocked              | Sagar         | decide sender (P0-04), provision it         |
| `MCP_JWT_SECRET` (prod)                | Mint AIJ Perplexity connector                          | `MCP_JWT_SECRET`                                                              | No — connector issuance blocked      | Karthik       | confirm prod secret, issue AIJ token        |
| GCP project decision                   | Whether AIJ data gets a dedicated project              | n/a (P0-05)                                                                   | No — provisioning blocked            | Sagar         | answer P0-05                                |

---

# Evidence Appendix

**Live warehouse facts (`midyear-glazing-485303-u3`, read-only, 2026-07-10)**

- Datasets present: `togari_data_lake`, `togari_dnc`, `togari_healthcare`, `togari_audit`, `togari_sourcing_48north`, plus Medha's `medha_*`. **`togari_core` absent** (confirms disabled sourcing MCP).
- Tenancy: `togari_data_lake.users` → 7 users, all `tenant_id=bma`. `togari_dnc.contacts` → 4,323 rows, `org_id=bma`, **0 flagged `is_dnc`**.
- Clients: `togari_structured_deals` → 42 deals across 42 `client_id`s (one each). AIJ = `aij_communications_06302026` (brand `bma`), one deal: "AIJ Communications", `proposal_sent`, `outbound`, **$3,800**. 48 North = `48north_06262026` (a client, not a separate product).
- Deployed-but-empty: `pipeline_stages` (0 rows, has `auto_rules` JSON), `togari_healthcare.*` (empty vertical template), `data_pull_requests` (only `test-qa-client`).
- Live product: `opportunity_subscriptions` has an active enterprise subscription (`caleb@bluemodernadvisory.com`) with a `signal_query`; `signal_results`/`notification_history` back it with Stripe billing + `enrichment_cost_usd`.

**Key repo paths**

- Entry/routes: `src/server.ts` (MCP `:112`, Clay `:211/:215`, Fireflies `:221`, unauthed `/deals/write` `:425-488`)
- REST: `src/transports/api/router.ts` (`/api/v1/message|deals|meetings|proposals|emails`; `X-Togari-Key` `:36-54`)
- Engine: `src/core/engine.ts:842`; tools `src/core/tool-registry.ts:266-514`; pipelines `src/core/config/brand-pipelines.ts:13-24`
- MCP: `src/transports/mcp/server.ts` (disabled modules `:27-44`); auth `src/mcp/auth.ts` (dev-anon admin `:236-262`); issuer `scripts/issue-token.ts`
- Clay: `src/routes/ingest/clay-passthrough.ts`; legacy 501 `src/routes/ingest/clay.ts:45-52`; outbound read-only `src/mcp/tools/clay.ts`
- Ingestion: `src/pdw/adapters/*`, `src/transports/webhooks/fireflies.ts`, `scripts/import-springdale-csv.ts`
- Secrets: `src/secrets/*` (per-tenant AES-256-GCM in `togari_core.tenant_secrets` — **note: `togari_core` is absent in prod, so this store may be unprovisioned**)

**Deployed tables that matter**

- CRM: `togari_data_lake.{togari_structured_deals, togari_structured_contacts, togari_associated_contacts, togari_captures, togari_companies, pipeline_stages, activities, users}`
- DNC: `togari_dnc.{contacts, social_connections, contacts_clay_staging, sync_log, api_keys}` + views `v_dnc_unified`, `v_dnc_unified_by_owner`, `v_dnc_only`, `v_contacts_enriched`
- Opportunity: `togari_data_lake.{opportunity_subscriptions, signal_results, notification_history, data_pull_requests, lead_lists, signal_subscriptions(view)}`
- Vertical template: `togari_healthcare.{companies, persons, relationships, touchpoints, scoring_history, campaigns, enrichment_log}`
- DealCloud mirror: `togari_sourcing_48north.*` (~62 tables, incl. `do_not_contact` string)

**Routes / MCP tools**

- Live REST: `/api/v1/message(+/stream)`, `/api/v1/deals`, `/api/v1/meetings/*`, `/api/v1/proposals/generate`, `/api/v1/emails/draft|send`, `/webhooks/clay/*`, `/webhooks/fireflies`, `/deals/write`
- Live MCP: `query_deals, create_deal, update_deal, log_activity, schedule_meeting, analyze_meeting, generate_proposal, draft_email, send_email, search_meetings, get_deal_context, ask_togari, help, togari_hello`, `togari_exa_*` (4), `togari_zoominfo_*` (5)
- Disabled MCP: `togari_{mandates,tiering,enrichment,companies,contacts,datapoints,clay,costs,admin}_*`

**Env vars**: `MCP_JWT_SECRET`, `MCP_BEARER_TOKEN`, `MCP_DEFAULT_TENANT_ID=bma`, `AUTH0_DOMAIN=dev-4prs757badfajpi5.us.auth0.com`, `TOGARI_API_KEY`, `TENANT_ID`, `GCP_PROJECT_ID=midyear-glazing-485303-u3` (shared with Medha), `GCP_CREDENTIALS_BASE64`, `CLAY_INGEST_API_KEY`, `CLAY_API_KEY` (unused), `TENANT_SECRETS_MASTER_KEY`, `EXA_API_KEY`, `ZOOMINFO_*`, `TOGARI_TOOL_LOOP_ENABLED`, `TOGARI_WORKER_ENABLED`, `AUTO_POLL`

**Deployment**: Railway `togari-platform` (`node dist/server.cjs`) is current prod; Cloud Run README-canonical but unconfirmed; no CI; **repo migrations lag the deployed schema**.

**Recent commits that matter**: `50882f4` (cut routing to `togari_data_lake`), `2ff9924` (Clay ingest hardening), `b0687ad` (Clay bidirectional roadmap), `1520ff4` (model-string cleanup), `134d162` (16-tool tool-use migration), `57db3b6` (48N DealCloud mirror), `e72890e` (email sender Kevin→Sagar).
