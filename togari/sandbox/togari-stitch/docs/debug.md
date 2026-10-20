# Togari Healthcare MCP Server — Debug & Status

**Last Updated:** April 7, 2026

---

## Current Architecture

- **Operational Store:** Cloud Firestore (Native mode, us-central1) — replaced Structify as of April 2
- **Analytical Store:** BigQuery (analytics, audit logs, reporting)
- **File Storage:** Google Cloud Storage (GCS), tenant-scoped paths
- **Enrichment:** Exa (primary), Clay (secondary — currently 401), Structify (optional extraction only)
- **AI:** Anthropic (Claude — normalization, complexity estimation)
- **Identity:** Auth0 (JWT-based multi-tenancy with Organizations)
- **Transport:** stdio (local dev via Claude Desktop), Streamable HTTP (Cloud Run)
- **Tenant:** `org_test123` (via TENANT_ID env var + module-level fallback in stdio mode)
- **Cloud Run URL:** `https://togari-healthcare-mcp-813373326630.us-central1.run.app`

---

## Service Health (as of April 7, 2026)

| Service | Status | Latency | Notes |
|---------|--------|---------|-------|
| Firestore | ✅ Healthy | ~3ms (cached) | Primary CRUD store, replaced Structify |
| Anthropic | ✅ Healthy | ~4ms | AI normalization + complexity estimation |
| Exa | ✅ Healthy | ~3ms | Contact/company enrichment |
| GCS | ✅ Healthy | ~3ms | File storage, tenant-scoped paths |
| Clay | ❌ 401 | ~190ms | API key invalid or Enterprise plan required |
| Structify | ⚠️ Optional | N/A | Repositioned as optional enrichment/extraction only |

---

## Tool Status (All 14 Verified — April 7)

| Tool | Status | Store/Service |
|------|--------|---------------|
| create_patient | ✅ Working | Firestore |
| get_patient | ✅ Working | Firestore |
| update_patient | ✅ Working | Firestore |
| search_patients | ✅ Working | Firestore |
| query_data | ✅ Working | Firestore |
| score_lead | ✅ Working | Pure compute |
| health_check | ✅ Working | All services |
| enrich_contact | ✅ Working | Exa |
| enrich_company | ✅ Working | Exa |
| upload_file | ✅ Working | GCS |
| process_file | ✅ Working | GCS + Pipeline |
| healthcare_analytics | ✅ Working | BigQuery (empty — Firestore→BQ sync not wired) |
| normalize_data | ⚠️ Error | Anthropic connection error (pre-existing) |
| search_web | 🔲 Not tested | Exa (should work — same path as enrich) |

---

## Known Issues

### Clay API — 401 Unauthorized
- **Status:** Pre-existing, not related to Firestore refactor
- **Error:** `Clay API returned 401 at v3/tables: API key may be invalid or expired`
- **Diagnostic cascade:** Health check tries `/v1/tables` then `/v3/tables`, short-circuits on 401/403 with actionable messages
- **Action:** Verify Clay API key in dashboard (Settings → Your Profile → API key). If key is valid, may require Clay Enterprise plan for API access. Contact support@clay.com or Clay Community Slack (community.clay.com).

### Normalize Data — Anthropic Connection Error
- **Status:** Pre-existing, not related to Firestore refactor
- **Error:** `Upstream API error from claude: Connection error`
- **Action:** Check Anthropic API key validity and network connectivity. Tool falls back to degraded mode (returns raw data with `degraded: true`).

### Firestore → BigQuery Sync Not Wired
- **Status:** Pending implementation
- **Impact:** `healthcare_analytics` queries return empty results because Firestore data isn't syncing to BigQuery analytics tables yet
- **Options:** Firebase Extension (`firebase/firestore-bigquery-export`) or Pub/Sub pipeline with BigQuery Subscription
- **Priority:** Next sprint

### Cloud Run — Redis Not Connected
- **Status:** Known, non-blocking
- **Details:** Redis connection times out on Cloud Run (no VPC connector attached in current deploy). Falls back to in-memory rate limiter. Add `--vpc-connector=togari-connector` to deploy.sh when ready.

---

## HIPAA Compliance Checklist (Pre-Production)

- [ ] Sign Google Cloud BAA (Task 0.0 — currently skipped)
- [ ] Enable CMEK on Firestore database (must be set at database creation time — may require recreating the database)
- [ ] Enable Data Access audit logs for Firestore (`datastore.googleapis.com` → enable Data Read + Data Write)
- [ ] Verify all Firestore access uses Admin SDK only (not client SDKs)
- [ ] Confirm VPC Service Controls if needed for network isolation

---

## Remaining Deployment Tests

- [ ] Test Auth0 JWT flow (get M2M token → call Cloud Run `/mcp` endpoint)
- [ ] Verify audit logs flow to BigQuery `togari_audit.tool_invocations`
- [ ] Verify Pub/Sub events (DLQ should be empty after tool invocations)
- [ ] Attach VPC connector for Redis connectivity on Cloud Run

---

## Resolved Issues (Historical)

### Tenant Context Not Resolving — ✅ FIXED (March 30-31)
- **Root cause:** MCP SDK's StdioServerTransport dispatches tool handlers in async contexts that don't inherit AsyncLocalStorage. Multiple fix attempts (tenantStorage.run, enterWith) failed.
- **Fix:** Module-level fallback `_stdioFallbackCtx` in `src/core/middleware/tenant.ts` + `setStdioFallback()` called at stdio startup.

### Clay Deprecated Endpoint — ✅ FIXED (March 30)
- **Root cause:** Health check hit `GET /v1/health` which returned 404.
- **Fix:** Diagnostic cascade trying `/v1/tables` then `/v3/tables` with actionable error messages per status code.

### Structify as CRUD Store — ✅ FIXED (April 1-7)
- **Root cause:** Structify (an AI knowledge graph platform) was misused as the primary CRUD database. No HIPAA BAA, no ACID transactions, consistently timing out at 10.5s.
- **Fix:** Migrated all CRUD operations to Cloud Firestore (Native mode). Structify retained as optional enrichment/extraction layer for `process_file`. All 14 tools verified working through Firestore on April 7.

### Health Check Not Surfacing Errors — ✅ FIXED (March 30)
- **Root cause:** Clay and Structify healthCheck() methods returned boolean false without error details.
- **Fix:** Added AbortController timeouts and Error throwing with HTTP status code + response body. Probe captures as `last_error`.

### Stdio Transport Logs Corrupting JSON-RPC — ✅ FIXED (March 27)
- **Root cause:** Logger wrote to stdout in stdio mode, mixing log lines with JSON-RPC messages.
- **Fix:** All log output routes to stderr when `MCP_TRANSPORT=stdio`. ANSI color codes disabled.
