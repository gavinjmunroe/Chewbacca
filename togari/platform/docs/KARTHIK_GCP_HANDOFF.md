# Karthik GCP Handoff — Togari Platform

**Owner being onboarded:** Karthik
**Scope:** GCP project, BigQuery datasets, IAM, audit/logging, Cloud Run
deploy, env-var contract, first smoke tests, open decisions.
**Position:** Togari Platform is the canonical backend complementing
Amber (B2C) and amber-id (private passport). Enterprise-grade activation
is a capability boundary on top of this same codebase, not a fork.

> Read the [`README.md`](../README.md) first if you have not. The
> business doctrine — Amber is Perplexity for People, Perplexity API is
> the default for research/reasoning, Perplexity Computer is the
> operating engine — is product-shaping, not background colour.

---

## 1. Concrete next work (what to do, in order)

Each item is sized to be picked up independently. Sequencing matters
where called out.

### 1a. Land in the GCP project and verify access
1. Get added to GCP project `midyear-glazing-485303-u3` with the roles
   listed in §3.
2. `gcloud auth login` and `gcloud config set project
   midyear-glazing-485303-u3`.
3. `bq ls togari_pdw` and `bq ls togari_data_lake` — confirm both
   datasets are visible from your account.
4. Pull the latest Cloud Run revision: `gcloud run services describe
   togari-admin --region <region>`. Capture the current image tag and
   env-var set as a baseline before any changes.

### 1b. Stand up a *staging* Cloud Run deploy
We do not currently have a separate staging environment for
Togari Platform. This is the first piece of net-new work.

- Create a sibling Cloud Run service `togari-admin-staging` in the same
  project (or a dedicated `togari-staging` project — see open decision
  D1).
- Mirror env vars from prod (§4) but point to staging-only secrets and a
  staging BigQuery dataset prefix (`togari_pdw_staging`,
  `togari_data_lake_staging`).
- Wire it into Sentry as a separate `environment: staging` so prod alerts
  are not poisoned.

### 1c. Codify dataset + IAM as Terraform (or `gcloud` scripts checked in)
Today the BigQuery datasets exist in the console and `sql/pdw_create_tables.sql`
captures only the `togari_pdw` DDL.

- Add `infra/bigquery/` with DDL for **both** datasets, including
  `togari_data_lake.togari_structured_deals` and the audit-log table.
- Add `infra/iam/` with the role bindings from §3 (Terraform preferred;
  shell scripts acceptable as a stop-gap).
- Goal: a fresh GCP project can be bootstrapped to a working Togari
  Platform from this repo alone.

### 1d. Audit logging — close the loop
- `src/middleware/audit.ts` and `src/bigquery/client.ts` already write
  audit rows. Confirm the destination table exists (`togari_data_lake.audit_log`
  or equivalent — verify the exact name; see open decision D2).
- Add a partitioned + clustered DDL for it under `infra/bigquery/`.
- Add a 30-day retention policy and document who is allowed to query it.

### 1e. Replace per-callsite hard-coded `'midyear-glazing-485303-u3'`
There are 7+ files that hard-code the project id (see grep in §6).
Centralize on `process.env.GCP_PROJECT_ID` with a single fallback in one
place (`src/secrets/manager.ts`). This unblocks the staging deploy in 1b.

### 1f. Perplexity wiring
Per the doctrine, Perplexity API is the default for research / reasoning
flows, and Perplexity Computer is the operating engine. Today this repo
calls Anthropic directly for Claude tool-use loops. Next step:

- Add `perplexity` to `src/config/connectors.ts` with rate-limits and a
  resilience profile.
- Add `perplexityApiKey` to `src/secrets/known-secrets.ts`.
- Introduce a thin `src/core/research.ts` that takes a question and runs
  it through the Perplexity API. Wire it as an MCP tool *and* a REST
  endpoint (`POST /api/v1/research`). Existing Anthropic tool-use loops
  stay where they are; this is additive.
- Open decision D3 covers whether agent loops migrate to Perplexity
  Computer wholesale or stay split.

### 1g. PDW ingestion runbook
`src/pdw/` has adapters for Gmail, Fireflies, GDrive, Loom but no
documented "how to onboard a new owner" runbook. Write one under
`docs/PDW_ONBOARDING.md` covering: OAuth grants required, watermark
seeding, first-run cost estimate, where to watch for failures.

---

## 2. GCP services in use

| Service | Resource | Used by |
|---|---|---|
| Cloud Run | `togari-admin` (prod) | `src/server.ts` |
| BigQuery | dataset `togari_pdw` | `src/pdw/*`, `sql/pdw_create_tables.sql` |
| BigQuery | dataset `togari_data_lake` | `src/core/tools/deal-ops.ts`, `src/agents/slack-sync/*`, `src/server.ts` `/deals/write`, `src/email-engine/deal-lookup.ts` |
| BigQuery | audit table (see D2) | `src/middleware/audit.ts`, `src/bigquery/client.ts` |
| Secret Manager | secrets in `src/secrets/known-secrets.ts` | `src/secrets/manager.ts` |
| Pub/Sub | event bus | `src/events/publisher.ts` |
| Cloud Storage | raw-content blobs | `src/storage/gcs.ts`, `togari_pdw.interactions.raw_content_gcs_uri` |
| Cloud Logging | structured logs | `src/observability/logger.ts` (Cloud Trace header propagated) |
| Sentry (external, but GCP-adjacent) | error reporting | `src/observability/sentry.ts` |

---

## 3. IAM — minimum role matrix

For the **Cloud Run service account** that runs `togari-admin`:

| Role | Why |
|---|---|
| `roles/bigquery.dataEditor` on `togari_pdw` | PDW writes (persons, interactions) |
| `roles/bigquery.dataEditor` on `togari_data_lake` | Deal CRUD + audit-log inserts |
| `roles/bigquery.jobUser` on the project | Run query jobs |
| `roles/secretmanager.secretAccessor` on the listed secrets | Resolve API keys at boot |
| `roles/pubsub.publisher` on relevant topics | Event emission |
| `roles/storage.objectAdmin` on the raw-content GCS bucket | Read/write transcript blobs |
| `roles/logging.logWriter` | Structured logs |
| `roles/cloudtrace.agent` | Trace propagation |

For **Karthik's user account** (during onboarding):

| Role | Why |
|---|---|
| `roles/bigquery.dataViewer` on both datasets | Inspect data |
| `roles/bigquery.jobUser` | Run ad-hoc queries |
| `roles/run.viewer` | Inspect Cloud Run revisions/logs |
| `roles/logging.viewer` | Read service logs |
| `roles/secretmanager.viewer` | List secrets (not access values) |
| `roles/iam.securityReviewer` (optional) | Audit role bindings |

Grant `roles/secretmanager.secretAccessor` on individual secrets only
when a specific debugging task requires it; revoke after.

---

## 4. Env-var contract

These are read by the live code (verified via grep in §6). **None of
these values belong in the repo or in PR descriptions** — Secret Manager
or the Cloud Run revision config only.

### Required for boot
| Var | Purpose | Source of truth |
|---|---|---|
| `GCP_PROJECT_ID` | Project for BQ + Pub/Sub clients | Secret Manager → env |
| `GCP_CREDENTIALS_BASE64` *(or `GOOGLE_CREDENTIALS_BASE64`)* | Base64 service-account JSON for non-Cloud-Run runs | Secret Manager. On Cloud Run, prefer attached SA + omit. |
| `ANTHROPIC_API_KEY` | Claude tool-use loop | Secret Manager |
| `PORT` | HTTP port (Cloud Run sets this) | Platform |

### Required for full feature surface
| Var | Purpose |
|---|---|
| `SLACK_BOT_TOKEN` | Slack message send |
| `SLACK_SIGNING_SECRET` | Slack event verification |
| `SMARTLEAD_API_KEY` | Smartlead message history |
| `SMARTLEAD_WEBHOOK_SECRET` | Smartlead HMAC verify |
| `FIREFLIES_API_KEY` | Meeting intel |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Calendar |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google Calendar |
| `GOOGLE_CALENDAR_REFRESH_TOKEN` | Google Calendar |
| `TOGARI_API_KEY` | REST `/api/v1/*` auth (set or auth is open) |
| `AUTH0_DOMAIN` | MCP OAuth verification |
| `OAUTH_RESOURCE_URL` | OAuth resource advertisement |
| `SENTRY_DSN` | Error reporting |
| `TENANT_ID`, `TENANT_TIER`, `USER_ID`, `USER_EMAIL` | Tenant context (single-tenant deploys) |

### To add (per §1f)
| Var | Purpose |
|---|---|
| `PERPLEXITY_API_KEY` | Perplexity API access for research/reasoning surface |

### Operational toggles
| Var | Purpose | Default |
|---|---|---|
| `AUTO_POLL` | Enable email polling loop on boot | `false` |
| `POLL_INTERVAL_MINUTES` | Email poll cadence | `15` |
| `NODE_ENV` | Logger + Sentry environment tag | `development` |
| `MCP_TRANSPORT` | `stdio` switches logger/audit to stderr | unset (HTTP) |

---

## 5. Deploy order

For a clean deploy from scratch (or a fresh project bootstrap):

1. **Create / select the GCP project.** Confirm billing is attached.
2. **Enable APIs**: `run.googleapis.com`, `bigquery.googleapis.com`,
   `secretmanager.googleapis.com`, `pubsub.googleapis.com`,
   `storage.googleapis.com`, `cloudtrace.googleapis.com`,
   `logging.googleapis.com`.
3. **BigQuery**: apply `sql/pdw_create_tables.sql`. Then create the
   `togari_data_lake` dataset and run the (to-be-added) DDL for
   `togari_structured_deals` and the audit table.
4. **Secret Manager**: create the secrets listed in
   `src/secrets/known-secrets.ts` plus the env vars in §4. Populate
   values out-of-band.
5. **Service account**: create `togari-admin-sa@<project>.iam`,
   grant the roles in §3.
6. **GCS bucket**: create the raw-content bucket (name TBD — see D4) and
   grant the SA `objectAdmin` on it.
7. **Pub/Sub**: create topics referenced by `src/events/publisher.ts`.
8. **Cloud Run**: deploy from this repo (`npm run build` produces the
   bundle invoked by `node dist/server.cjs`, per `railway.json` —
   mirror that command on Cloud Run). Attach the SA, mount env vars
   from Secret Manager, set min-instances appropriately.
9. **Auth0**: register the resource URL (`OAUTH_RESOURCE_URL`) and
   configure the JWKS endpoint (`AUTH0_DOMAIN`).
10. **Smoke tests** (§6).

---

## 6. First smoke tests

Run in order. All are idempotent and read-only except where noted.

### 6a. Health
```bash
curl -fsS https://<cloud-run-url>/health
# expect: {"status":"ok",...}
```

### 6b. Admin status
```bash
curl -fsS https://<cloud-run-url>/admin/status | jq '.connectors'
# expect: every connector with a green/known state, no "secret missing"
```

### 6c. MCP discovery
```bash
curl -fsS https://<cloud-run-url>/.well-known/oauth-protected-resource | jq
curl -fsS https://<cloud-run-url>/.well-known/oauth-authorization-server | jq
# expect: both 200 with the configured Auth0 domain
```

### 6d. REST API auth gate
```bash
curl -i https://<cloud-run-url>/api/v1/health
# expect 200 (health is open)
curl -i -X POST https://<cloud-run-url>/api/v1/message -d '{"text":"hello"}'
# expect 401 if TOGARI_API_KEY is set; 200 if not (dev mode)
curl -i -X POST https://<cloud-run-url>/api/v1/message \
  -H "X-Togari-Key: $TOGARI_API_KEY" -H "content-type: application/json" \
  -d '{"text":"what deals are in the pipeline"}'
# expect 200 with a JSON envelope
```

### 6e. BigQuery read path
```sql
-- in BQ console, as the Cloud Run SA (impersonated) or as Karthik:
SELECT COUNT(*) FROM `midyear-glazing-485303-u3.togari_pdw.persons`;
SELECT COUNT(*) FROM `midyear-glazing-485303-u3.togari_data_lake.togari_structured_deals`;
```

### 6f. Audit-log write path
Issue any authenticated `/api/v1/deals` GET, then:
```sql
SELECT * FROM `midyear-glazing-485303-u3.togari_data_lake.<audit_table>`
ORDER BY ts DESC LIMIT 5;
```
Confirm the call appears with `clientId` and `toolName`.

### 6g. Local repo checks (before any deploy PR)
```bash
npm run typecheck
npm test
```
Both must be green.

---

## 7. Where the project id is hard-coded today (§1e cleanup)

```
src/agents/slack-sync/deal-context.ts:13
src/agents/slack-sync/deal-sync.ts:15
src/agents/slack-sync/query-handler.ts:15,27
src/core/tools/deal-ops.ts:16
src/email-engine/deal-lookup.ts:21
src/events/publisher.ts:22
src/middleware/audit.ts:44
src/secrets/manager.ts:18
src/server.ts:254,267
```

Single-source-of-truth them through `secrets/manager.ts` so a staging
project drop-in needs one env var, not a sed across the tree.

---

## 8. Open decisions

| ID | Decision | Why it's open |
|---|---|---|
| **D1** | Staging in same project (`midyear-glazing-485303-u3`) with `_staging` dataset suffix, or a new project? | New project gives true isolation; same project is faster to spin up. Recommend: new project once we have >1 paid customer; same project until then. |
| **D2** | Confirm the exact name and schema of the audit-log table referenced by `src/middleware/audit.ts` and `src/bigquery/client.ts`. | Today the table name is passed at the call site. We should standardize on one (proposal: `togari_data_lake.audit_log`) and check in the DDL. |
| **D3** | Do we migrate the existing Anthropic tool-use loops to **Perplexity Computer** as the agent runtime, or keep Anthropic for tool loops and Perplexity for research/reasoning only? | Doctrine says Perplexity Computer is the operating engine. Practically, the tool-use loop in `src/core/claude-loop.ts` is mature. Decision drives whether `claude-loop.ts` is replaced or kept alongside. |
| **D4** | Final name + region for the raw-content GCS bucket (referenced by `togari_pdw.interactions.raw_content_gcs_uri`). | Not pinned in code today. Pick a name, document it, set lifecycle rules. |
| **D5** | Multi-tenant strategy — keep the env-var-driven single-tenant model in `src/tenant/context.ts`, or move to per-request tenant from JWT claims? | The capability-boundary plan (enterprise activation) needs per-tenant isolation eventually. Soonest blocker: when the second tenant lands. |
| **D6** | When does **enterprise activation** turn on as a real capability gate (vs. a doctrinal note)? Concrete trigger: first paying enterprise customer, or first regulatory ask. | Affects how we structure IAM, audit retention, and rate-limits in §3 / §4. |

---

## 9. Anti-goals (do not do these)

- Do **not** create a `togari-enterprise` repo or fork. Enterprise is a
  capability boundary, not a separate platform. New code lives here.
- Do **not** put secrets, customer data, or project-specific creds in
  this repo, in PR descriptions, or in chat with Anthropic.
- Do **not** bypass the connector ontology in
  `src/config/connectors.ts`. New external systems get added there
  first; resilience profile and rate-limits travel with them.
- Do **not** write Amber B2C feature code that reaches into amber-id
  internals. Use the documented identity contract.
- Do **not** duplicate core logic into agent folders. The Phase-1
  follow-ups (`docs/phase1-followups.md`) capture remaining
  consolidation work.

---

## 10. Pointers

- Repo overview & doctrine: [`README.md`](../README.md)
- Project conventions: [`CLAUDE.md`](../CLAUDE.md)
- Phase-1 inventory (what's already consolidated, what's not): [`docs/phase1-inventory.md`](phase1-inventory.md)
- Phase-1 follow-ups: [`docs/phase1-followups.md`](phase1-followups.md)
- PDW DDL: [`sql/pdw_create_tables.sql`](../sql/pdw_create_tables.sql)
- Connector ontology: [`src/config/connectors.ts`](../src/config/connectors.ts)
- Secret catalog: [`src/secrets/known-secrets.ts`](../src/secrets/known-secrets.ts)
- Cloud Run entrypoint: [`src/server.ts`](../src/server.ts)
