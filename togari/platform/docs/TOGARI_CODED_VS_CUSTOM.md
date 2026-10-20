# Togari: Coded Core vs Per-Client Customization

Prepared for Sagar. This is the design deliverable he asked for: what should be **coded once** (the platform every client shares) versus what is a **customization for a client** (set up per client, instantly, from a description). It also maps the client workflow and the touchpoints that deserve a digital interface.

## The one-line model

> **Coded = the engine and the verbs. Customization = the client's nouns.**

Togari is a data lakehouse with a fixed engine (ingest, structure, store, search, act) that every client shares. What differs per client is their _data shape_: their pipelines, their stages, the data points they care about, and which touchpoints they use. Those differences are **data (rows), not code**, so a new client is provisioned by writing rows, never by shipping a deploy.

---

## Layer 1: Coded once (the platform)

Built once, identical for every client. A client never changes this; only BMA engineering does.

| Capability                 | What it is                                                                                                    | Where it lives                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Universal ingestion**    | Accept any data (text, CSV, JSON, XLSX, file, Clay, later Gmail/Fireflies), preserve the raw verbatim         | `src/ingest/universal/`, `POST /api/v1/ingest`, `raw_ingestions`        |
| **AI structuring**         | Turn raw/unstructured content into entities (contacts, companies, activities, tasks, facts, pipeline updates) | `src/ingest/universal/extractor.ts`                                     |
| **Canonical entities**     | The shared nouns every org has: contacts, companies, deals, activities                                        | `togari_structured_deals`, `togari_companies`, `contacts`, `activities` |
| **Clay both ways**         | Inbound passthrough + outbound push/enrich + the lead fan-out                                                 | `routes/ingest/clay-*`, `mcp/tools/clay-outbound.ts`                    |
| **DNC / compliance**       | Suppression store + enforcement gate (block on match)                                                         | `src/dnc/`, `togari_dnc`                                                |
| **Opportunity emails**     | Signal subscription to draft to approve to send                                                               | `src/opportunity/`                                                      |
| **Pipeline mechanics**     | Move a deal, log activity, compute overdue/priority                                                           | `mcp/tools/pipeline.ts`                                                 |
| **Perplexity/MCP surface** | Every verb above exposed as MCP tools, per-org connector                                                      | `transports/mcp/`, `scripts/issue-token.ts`                             |
| **Custom-field engine**    | Store client-specific fields as rows, no DDL                                                                  | `src/schema/`, `custom_field_defs`, `custom_field_values`               |
| **Provisioning engine**    | Turn a client description into pipelines + stages + fields                                                    | `src/provision/`                                                        |
| **Tenancy + audit**        | client_id isolation, raw preservation, lineage                                                                | throughout                                                              |

**Rule of thumb:** if two different clients would both benefit from it, it is coded once. Compliance, ingestion, structuring, search, and the CRM verbs are universal. They are never rebuilt per client.

---

## Layer 2: Customization per client (data, not code)

Set up per client, instantly, by writing rows. This is what Sagar configures with Joe in a two-minute conversation and then provisions in one prompt.

| Customization           | What varies per client                                                                                      | Stored as                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Pipelines**           | Joe: "media outreach", "retainer clients". Serif: something else                                            | rows in `pipeline_stages` (client_id scoped)        |
| **Stages**              | The steps within each pipeline, in order                                                                    | rows in `pipeline_stages`                           |
| **Data points**         | Joe cares about outlet, journalist, angle, embargo date; a PE client cares about EBITDA, sector, thesis fit | rows in `custom_field_defs` / `custom_field_values` |
| **Touchpoints enabled** | Which portal features this client uses (DNC, opportunity email, upload)                                     | client config (flag rows)                           |
| **DNC scope**           | The client's own suppression list                                                                           | `togari_dnc` rows scoped to the client              |
| **Clay workspace/keys** | The client's own Clay account (per decision)                                                                | `tenant_secrets` per client                         |

**How it gets set up:** `togari_provision_client` takes a sentence ("Joe runs a PR firm, pipelines media outreach and retainer clients, track outlet/journalist/angle/embargo") and writes all of the above. No engineer, no deploy. That is the "it is written, send it to you, done" moment.

---

## The dividing test (use this when unsure)

Ask three questions:

1. **Would every client want it?** Yes to code it. No to customize it.
2. **Does getting it wrong for one client break another?** Yes to code it (shared safety, like DNC enforcement). No to customize.
3. **Is it a noun (a thing this client tracks) or a verb (an action on things)?** Nouns customize. Verbs are coded.

Danger zone: never let a client's custom data shape require a code change. If provisioning a client needs new code, the engine is missing an abstraction. The custom-field engine and the provisioning engine exist precisely so that never happens.

---

## The client workflow and its touchpoints

Sagar's first gap: "there is no connection with what we do with our clients." Here is the end-to-end BMA client workflow, top of funnel to delivery, with the touchpoints that deserve a digital interface marked.

```
  TOP OF FUNNEL                 ENGAGEMENT                 DELIVERY / ONGOING
  ────────────                  ──────────                 ──────────────────
  1. Sourcing (Clay)            4. Onboard client          8. Do-not-contact  [TOUCHPOINT]
     data in via Clay/enrich       provision warehouse        client submits, Togari enforces
        |                          [TOUCHPOINT]                  |
  2. Structure + score          5. Define pipelines        9. Opportunity email  [TOUCHPOINT]
     ingest -> entities            + data points              client requests, BMA approves, send
        |                          [TOUCHPOINT: provision]        |
  3. Pipeline (BMA)             6. Run outreach            10. Reporting / status  [TOUCHPOINT]
     deals, stages, activity       Clay + email               client sees their history
     [managed in Perplexity]          |
                                7. Meetings booked
                                   Fireflies -> capture
```

**Touchpoints (where a client interacts with Togari, so these get an interface):**

| #   | Touchpoint                    | Who                           | Interface                                        | Status                                 |
| --- | ----------------------------- | ----------------------------- | ------------------------------------------------ | -------------------------------------- |
| A   | **Onboard / provision**       | BMA sets up a client          | `togari_provision_client` (Perplexity) or portal | Built (backend)                        |
| B   | **Do-not-contact portal**     | Client (Joe) submits          | `/api/v1/portal/dnc` + login                     | Built (backend); needs frontend + auth |
| C   | **Opportunity email**         | Client requests, BMA approves | `/api/v1/portal/opportunity-email`               | Built (backend); needs frontend        |
| D   | **Upload / free-form update** | Client or BMA drops any data  | `/api/v1/ingest`, `togari_ingest_text`           | Built (backend)                        |
| E   | **Status / history**          | Client sees their submissions | portal read endpoints                            | Partial                                |
| F   | **Pipeline management**       | BMA (Sagar/Tyler)             | Perplexity/MCP (off Slack)                       | Built (MCP)                            |

**Everything else in the workflow is internal** (sourcing, structuring, scoring, outreach, meeting capture) and runs through Perplexity/MCP and Clay. It does not need a client-facing UI. Only touchpoints A to F touch a client, so only those get interfaces. That is the scope boundary Sagar asked us to draw.

---

## What this means for the first Joe demo

Joe's world is exactly three touchpoints on top of the shared engine:

1. **Onboard (A):** one prompt provisions Joe's pipelines + data points.
2. **DNC (B):** Joe submits, Togari enforces (blocks outreach on a match).
3. **Opportunity email (C):** Joe requests, BMA approves, it sends.

All three are coded once and simply _configured_ for Joe. The next client (serif) reuses the identical engine with a different one-prompt provision. That is the proof that the coded-vs-custom line is drawn in the right place.
