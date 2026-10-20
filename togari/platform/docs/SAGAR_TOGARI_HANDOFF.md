# Togari Handoff

Prepared for Sagar Tiwari (Blue Modern Advisory).

This is the honest state of Togari: what it is, how to connect to it, everything it can do today, how to onboard a client, and the short punch list before it carries daily production load. Everything described here is deployed and live unless a line explicitly says otherwise.

- Production URL: `https://togari-bma-prod.up.railway.app`
- MCP endpoint: `https://togari-bma-prod.up.railway.app/mcp`
- BigQuery: project `midyear-glazing-485303-u3`, dataset `togari_data_lake`
- Runtime intelligence: Anthropic (Claude) via MCP; driveable from Claude and Perplexity

---

## 1. What Togari is now

Togari is a working, natural-language-controlled headless CRM and data lakehouse for BMA, live in production on Railway and backed by BigQuery. You drive the whole thing in plain English from Claude or Perplexity through an MCP connector: ingest any data, structure it with AI, run a deal pipeline, manage a do-not-contact list, enrich records, and push/pull with Clay, all without a form or a dashboard. It is not a UI product yet. There is no client login and no operator dashboard today; the frontend is Colin's work and in progress. Everything below is the backend and the MCP surface, which is what is real and deployed.

---

## 2. How to connect it

Togari speaks MCP over Streamable HTTP (what Claude.ai uses) with a legacy SSE fallback. Access is gated by a per-org JWT passed as a `?token=` URL parameter (Claude.ai and Perplexity connectors cannot send Authorization headers, so the token rides in the URL).

### Claude / Claude Code

Add it as a custom connector (Settings, Connectors, Add custom connector) with the URL:

```
https://togari-bma-prod.up.railway.app/mcp?token=<jwt>
```

Or from the CLI:

```
claude mcp add --transport http togari "https://togari-bma-prod.up.railway.app/mcp?token=<jwt>"
```

Caveat: some clients cap the visible tool list at roughly the first 20 to 25 tools. Togari registers the high-value new product tools first (DNC, ingestion, enrichment, provisioning, schema, pipeline, opportunity emails, Clay), then the core CRM tools, and registers Exa and ZoomInfo last on purpose so those are the ones dropped if a client truncates. If a tool you expect is missing, it was cut by the client's cap, not un-deployed.

### Perplexity

Add a custom MCP connector pointing at the same URL. Perplexity caches the tool list, so if the tools look stale or a newly added tool does not appear, remove and re-add the connector fresh to force a reload.

### How connector tokens are minted

Tokens are JWTs signed with `MCP_JWT_SECRET`, minted one per org with `scripts/issue-token.ts`:

```
MCP_JWT_SECRET=... pnpm tsx scripts/issue-token.ts \
  --sub bma_admin \
  --email sagar@bluemodernadvisory.com \
  --org bma \
  --role admin \
  --scopes togari_data_lake
```

The script prints the token and the ready-to-paste connector URL on the last line. Tokens default to a 365-day expiry. The `--org` value becomes the token's tenant (the `client_id` the tools operate under). Issue one token per org and treat it as a secret.

---

## 3. Everything it can do

Every capability below is an MCP tool callable in natural language. Tool names are exact. The example prompt is one way to trigger each; the client model picks the tool, you do not name it.

### Do-not-contact (compliance)

| Tool                  | What it does                                                                              | Example prompt                                                    |
| --------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `togari_dnc_check`    | Check if an email/domain/contact is suppressed (checking an email also checks its domain) | "Is jane@acme.com safe to contact?"                               |
| `togari_dnc_suppress` | Add an email or domain to the do-not-contact list (acts immediately, reason required)     | "Suppress the whole competitor.com domain, they asked us to stop" |
| `togari_dnc_list`     | List recent suppressions, newest first                                                    | "Show me everyone on our do-not-contact list"                     |

### AI enrichment (the Clay-killer)

| Tool               | What it does                                                                                                                                                    | Example prompt                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `togari_enrich`    | Research a deal/contact/company against a prompt, structure the answer into typed fields, and write them back onto the record (optionally web-grounded via Exa) | "For deal d-123, find the company's industry, employee count, and HQ city and save them" |
| `togari_structure` | Turn an unstructured blob into typed JSON fields (writes nothing, no target record)                                                                             | "Pull the company, title, and seniority out of this email signature"                     |

### Universal ingestion

| Tool                   | What it does                                                                                                                                                   | Example prompt                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `togari_ingest_text`   | Paste any free-form text; the raw is preserved verbatim, then contacts/companies/activities/tasks/facts/pipeline updates are extracted and routed into the CRM | "Log this: met Priya from Northwind at the summit, she runs corp dev, wants a call next week" |
| `togari_ingest_status` | Look up a prior ingestion by id and report status and extracted count                                                                                          | "What was the status of ingestion abc-123?"                                                   |

### Gmail / Fireflies ingestion

| Tool                      | What it does                                                                                      | Example prompt                         |
| ------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `togari_ingest_gmail`     | Pull recent emails from the configured BMA mailbox and ingest each through the universal pipeline | "Ingest the last 20 emails"            |
| `togari_ingest_fireflies` | Pull recent Fireflies meeting transcripts and ingest each                                         | "Pull in my last 5 Fireflies meetings" |

### Provisioning a client

| Tool                       | What it does                                                                                                       | Example prompt                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `togari_provision_preview` | Plan a client's warehouse (pipelines, ordered stages, custom fields) from a description; read-only, writes nothing | "Preview a setup for a PR firm tracking outlet, journalist, angle, and embargo date"                                                      |
| `togari_provision_client`  | Same plan, but builds it (pipeline_stages rows + custom-field defs); idempotent                                    | "Provision a client named AIJ Communications that does PR, pipelines media outreach and retainers, track outlet/journalist/angle/embargo" |

### Agentic schema (custom fields, no DDL)

| Tool                        | What it does                                                                            | Example prompt                               |
| --------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------- |
| `togari_schema_add_field`   | Define a custom field on deal/contact/company (stored as metadata rows, never a column) | "Add a field called thesis_fit to companies" |
| `togari_schema_list_fields` | List the custom fields defined for the tenant                                           | "What custom fields do we have on deals?"    |
| `togari_schema_set_value`   | Set a custom field value on one record (auto-defines the field if new)                  | "Set thesis_fit to 'strong' on company acme" |
| `togari_schema_get`         | Read all custom values on one record                                                    | "Show the custom fields on company acme"     |

### Pipeline / CRM

| Tool                                  | What it does                                                      | Example prompt                                        |
| ------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| `togari_pipeline_list_stages`         | List configured pipeline stages in order                          | "Show me the outbound pipeline stages"                |
| `togari_pipeline_seed_default_stages` | Seed the canonical six stages (lead to closed_won) for a pipeline | "Seed default stages for the partnership pipeline"    |
| `togari_pipeline_move_deal`           | Move a deal to a new stage and log a stage_change activity        | "Move deal d-123 to negotiation"                      |
| `togari_pipeline_overdue`             | Surface deals past their next_action_date and not closed          | "What follow-ups are overdue?"                        |
| `togari_activity_log`                 | Log an activity (note/call/email/meeting) against a deal/contact  | "Log a call with the Northwind team about pricing"    |
| `togari_activity_recent`              | List recent activity, newest first                                | "What's happened on deal d-123 recently?"             |
| `query_deals`                         | Query deals and pipeline in natural language                      | "What's our total pipeline value this quarter?"       |
| `create_deal` / `update_deal`         | Create or update a deal                                           | "Create a deal for Northwind, discovery stage, $50k"  |
| `get_deal_context`                    | All known info on a person or company from the CRM                | "Tell me everything we know about Priya at Northwind" |
| `log_activity`                        | Legacy activity logger (company/contact scoped)                   | "Log an email to jane@acme.com"                       |
| `ask_togari`                          | Freeform: Togari picks the right action                           | "What should I do next on the Northwind deal?"        |
| `help`                                | Capability menu with example phrasings                            | "What can you do?"                                    |

### Meetings, proposals, email (deal-ops)

| Tool                | What it does                                                             | Example prompt                                           |
| ------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| `schedule_meeting`  | Create a Google Calendar event                                           | "Book a discovery call with John Doe Tuesday 3pm"        |
| `analyze_meeting`   | Analyze a Fireflies recording (next steps, action items, summary, table) | "What were the action items from my meeting with Priya?" |
| `search_meetings`   | Search Fireflies recordings by person/topic/keyword                      | "Find my meetings about pricing"                         |
| `generate_proposal` | Generate a proposal/SOW from a meeting and deal context                  | "Draft a proposal for Northwind, 15k for a 3-month POC"  |
| `draft_email`       | Draft a professional email                                               | "Draft a follow-up to jane@acme.com about next steps"    |
| `send_email`        | Send from sagar@bluemodernadvisory.com via Gmail                         | "Send that email"                                        |

### Clay connector (both ways)

| Tool                        | What it does                                                                            | Example prompt                                                  |
| --------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `togari_clay_list_pushable` | Read-only preview of the warehouse rows a Clay push would send                          | "Show me which companies we'd push to Clay"                     |
| `togari_clay_push`          | Select companies/contacts and push them into a Clay table webhook                       | "Push all Software-industry companies to this Clay table [url]" |
| `togari_clay_enrich`        | Push specific row_ids to Clay for enrichment (results return async via inbound webhook) | "Send these three contact ids to Clay for enrichment [url]"     |

Inbound Clay is the passthrough webhook path (`POST /webhooks/clay/companies` and `/contacts`) plus the universal connector (`POST /clay/v1/sync`), covered in section 5.

### Web / enrichment (Exa, ZoomInfo)

| Tool                                | What it does                                               | Example prompt                                                |
| ----------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| `togari_exa_search`                 | Neural/keyword web search, ranked URLs                     | "Find recent news on Northwind Capital"                       |
| `togari_exa_find_similar`           | Pages similar to a seed URL (lookalike discovery)          | "Find companies like this one [url]"                          |
| `togari_exa_get_contents`           | Full text / highlights / summaries for Exa ids             | "Read the top result and summarize it"                        |
| `togari_exa_answer`                 | One-shot synthesized answer with citations                 | "Who is the CEO of Northwind and what's their thesis?"        |
| `togari_zoominfo_company_search`    | Search companies by name/website (free, no credits)        | "Search ZoomInfo for Northwind Capital"                       |
| `togari_zoominfo_company_enrich`    | Full firmographics for one company (1 credit)              | "Enrich Northwind's firmographics"                            |
| `togari_zoominfo_person_search`     | Search people at a company (free)                          | "Find corp dev people at Northwind"                           |
| `togari_zoominfo_person_enrich`     | Full PII for one person: email, phone, LinkedIn (1 credit) | "Get contact details for that person"                         |
| `togari_zoominfo_similar_companies` | Lookalikes by industry and revenue band                    | "Find companies similar to Northwind for the buy-side thesis" |

Plus `togari_hello`, a smoke-test tool that returns the resolved tenant, auth mode, and server time so you can confirm a connector is authenticated and hitting the live process.

---

## 4. How to onboard a new client

The onboarding promise is: describe a client in one sentence and Togari builds their data architecture, no engineer and no deploy.

1. Say it in plain English to `togari_provision_client`, for example: "Provision a client named Acme Communications that runs a PR firm; pipelines media outreach and retainer clients; track outlet, journalist, angle, and embargo date." Run `togari_provision_preview` first if you want to see the plan before it writes.
2. Togari slugifies the client display name into a stable `client_id` (for example "Acme Communications" becomes `acme_communications`) and writes that client's pipelines and ordered stages into `pipeline_stages` and their custom data-point fields into the schema registry (`custom_field_defs`), all scoped to that `client_id`. It emits no DDL: fields are additive rows, so provisioning is idempotent and re-running only adds what is missing.
3. That `client_id` is the isolation key. The client's stages, custom fields, DNC suppressions and ingested raw data all carry it. Their warehouse is logically separate from every other client's inside the shared `togari_data_lake` dataset.
4. From then on, DNC, ingestion, pipeline moves and enrichment all work for that client the same way they do for BMA, filtered by `client_id`. Important honest nuance: the MCP tools other than provisioning resolve `client_id` from the connector token's org (default `bma`), while provisioning can target any client slug. So today, to operate as a specific provisioned client through MCP, you mint that client a token with `--org <client_slug>`. See the punch list (7a) for the reconciliation this implies.

---

## 5. Architecture in 6 lines

1. Storage: one BigQuery dataset, `togari_data_lake` in project `midyear-glazing-485303-u3`; canonical entities (`togari_structured_deals`, `togari_companies`, `contacts`, `activities`) plus feature tables (`togari_dnc`, `pipeline_stages`, `custom_field_defs`/`custom_field_values`, `raw_ingestions`, `opportunity_requests`, `clay_table_registry`).
2. Tenancy: `client_id` is the canonical key on every table; provisioning targets any client slug, but MCP tools other than provisioning currently derive `client_id` from the connector token's org (default `bma`), so bma-org and per-client-slug scoping are not yet unified (see 7a).
3. Raw preservation: every ingestion lands verbatim in `raw_ingestions` before AI extraction routes structured entities out, so extraction is re-runnable and nothing is lost; writes are INSERT/UPDATE/MERGE only (DELETE/DROP/ALTER are blocked).
4. MCP transport: Streamable HTTP (`POST/GET/DELETE /mcp`) with legacy SSE fallback (`/mcp/sse`, `/mcp/messages`); each connection gets its own server instance, sessions live in memory with 24h TTL and auto-recover across redeploys.
5. Deploy: Railway service `togari-bma-prod` at `https://togari-bma-prod.up.railway.app`, auto-deploying on push.
6. Runtime intelligence: Anthropic (Claude) does the extraction, structuring, and enrichment; Exa and ZoomInfo provide web/firmographic grounding.

---

## 6. What is verified working

Tested live against the deployed BigQuery warehouse:

- DNC end-to-end: suppress an email or domain, then a check on that email (or any email on a suppressed domain) returns suppressed; list returns the suppressions.
- AI enrichment writing back: `togari_enrich` researches a record and writes the structured fields onto it via the schema registry.
- Provisioning isolated clients: `togari_provision_client` builds a distinct client's pipelines, stages, and custom fields under its own `client_id`, idempotently.
- Agentic schema: add a custom field, set a value on a record, read it back, no DDL emitted.
- Universal ingestion routing: paste free-form text, raw is preserved in `raw_ingestions`, entities are extracted and routed into the CRM tables, status is queryable by ingestion id.
- Gmail and Fireflies ingestion: both connectors pull real data from the configured accounts and route each item through the universal pipeline (and report cleanly when a source is not configured).
- Pipeline mechanics: seed stages, move a deal (with a logged stage_change activity), list recent activity, list stages.
- Clay both ways: inbound passthrough webhook inserts rows; outbound `togari_clay_push`/`togari_clay_enrich` select warehouse rows and push to a Clay table webhook.
- MCP transport and auth: `togari_hello` confirms token auth, tenant resolution, and that the client is hitting the live process; tool-list ordering behaves under client caps.

---

## 7. Honest punch list before daily production use

Built fast and happy-path tested. None of these are broken features; they are the near-term iteration list to make it load-bearing for daily client work.

**a) Tenancy key reconciliation.** `client_id` is canonical on the tables, but provisioning targets a client slug while the other MCP tools derive `client_id` from the connector token's org (default `bma`). Unify these so one operator token can act across BMA and per-client scopes without minting a separate token per client.

**b) No frontend / client login yet.** There is no operator dashboard and no client-facing UI. This is Colin's work in progress. Today everything runs through the MCP connector in Claude/Perplexity.

**c) Portal routes use a shared identity, not per-client auth.** The portal REST routes identify the client via an `x-togari-client` header (defaulting to `bma`), and the Clay connector uses one shared `CLAY_CONNECTOR_KEY`. There is no per-client authenticated login. Real client accounts and auth are required before a client touches the portal directly.

**d) Overdue detection needs data.** `togari_pipeline_overdue` keys off `next_action_date`. It only surfaces deals once that column is populated, so the follow-up signal is only as good as the discipline (or automation) that sets next-action dates.

**e) Fireflies ingest is synchronous.** Each meeting takes roughly 51 seconds to pull and process, done inline. Fine for a handful on demand; a bulk backfill needs a queue/worker so it does not block the request.

**g) Built fast, happy-path tested.** Coverage is on the success paths. Error handling, retries under load, and adversarial inputs need hardening before this is the daily system of record.

---

## 8. Config / secrets needed

Env var names only (never values). Anything blank in Railway needs to be set for the corresponding capability to work in production. Full annotations live in `.env.example`.

| Var                                                                 | Enables                                                                                                         |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `MCP_JWT_SECRET`                                                    | Signing/verifying connector tokens (auth is disabled without it; every request runs as dev-anonymous BMA admin) |
| `MCP_BEARER_TOKEN`                                                  | Legacy static `?token=` bearer for connectors                                                                   |
| `MCP_DEFAULT_TENANT_ID`                                             | Tenant assumed for URL-token/dev-anonymous auth (set per Railway environment to avoid cross-tenant leakage)     |
| `GCP_CREDENTIALS_BASE64` or `GOOGLE_CREDENTIALS_BASE64`             | BigQuery access (base64 service-account JSON)                                                                   |
| `GCP_PROJECT_ID`                                                    | Target GCP project (`midyear-glazing-485303-u3`)                                                                |
| `AUTH0_DOMAIN` / `AUTH0_AUDIENCE`                                   | Bearer-JWT auth path (tenant `dev-4prs757badfajpi5.us.auth0.com`)                                               |
| `OPENAI_API_KEY`                                                    | Enrichment/extraction fallback in non-production                                                                |
| `TENANT_SECRETS_MASTER_KEY`                                         | AES-256-GCM key to read/write per-tenant secrets                                                                |
| `EXA_API_KEY`                                                       | Exa web search/enrichment tools                                                                                 |
| `ZOOMINFO_USERNAME` / `ZOOMINFO_CLIENT_ID` / `ZOOMINFO_PRIVATE_KEY` | ZoomInfo firmographic/person tools                                                                              |
| `CLAY_INGEST_API_KEY`                                               | Inbound Clay passthrough webhook auth                                                                           |
| `CLAY_CONNECTOR_KEY`                                                | Universal Clay connector (`/clay/v1/sync`) auth (falls back to `CLAY_INGEST_API_KEY`)                           |
| `CLAY_API_KEY`                                                      | Outbound Togari-to-Clay enrichment calls                                                                        |
| `SMARTLEAD_API_KEY` / `SMARTLEAD_WEBHOOK_SECRET`                    | Smartlead inbound email webhook                                                                                 |
| `SLACK_SIGNING_SECRET`                                              | Slack events/interactivity routes                                                                               |
| `SENTRY_DSN`                                                        | Error observability                                                                                             |
