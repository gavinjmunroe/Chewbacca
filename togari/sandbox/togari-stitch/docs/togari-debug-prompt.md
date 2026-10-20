# Togari Healthcare MCP Server — Debug Handoff

## Context

The Togari Healthcare MCP server is running **locally via stdio transport** (NOT the Railway-deployed instance at `togari-amber-production.up.railway.app/sse` — that's a separate repo/project). The local server starts successfully and registers all 14 tools, but has two active issues.

### Server Startup (confirmed working)

The server starts cleanly and outputs:
```
Registered tools: search_patients, enrich_contact, enrich_company, upload_file, process_file, score_lead, create_patient, get_patient, update_patient, query_data, normalize_data, search_web, healthcare_analytics, health_check
```

Minor startup notes (not blockers):
- `[sentry] No DSN configured` — expected for local dev
- `Secret Manager unavailable for "redis-url"` with `invalid_rapt` error — falls back to env var, fine for local dev. The Google Cloud auth token needs reauthentication if Secret Manager is desired later.

### Health Check Results (from local server, confirmed by ~4ms latency)

```json
{
  "tenant": "unknown",
  "services": {
    "anthropic": { "healthy": true, "latency_ms": 4 },
    "exa": { "healthy": true, "latency_ms": 4 },
    "gcs": { "healthy": true, "latency_ms": 4 },
    "clay": { "healthy": false, "latency_ms": 91 },
    "structify": { "healthy": false, "latency_ms": 10499 }
  }
}
```

- Anthropic, Exa, GCS — all healthy
- Clay — unhealthy (fast response = auth/permission error, not connectivity)
- Structify — unhealthy (10.5s timeout = likely outage on their end, deprioritize)

---

## Issue 1: Tenant Context Not Resolving (CRITICAL — Blocks All Writes)

### Symptom

Every mutating operation fails with:
```
Error: No tenant context available. Ensure the request passed through tenant middleware (HTTP) or createStdioTenantContext() was used (stdio).
```

The health check returns `"tenant": "unknown"`. Read-only operations work; any write operation (e.g., `create_patient`) fails.

### Root Cause

**This is a stdio server, not HTTP.** The error message itself tells us the fix: `createStdioTenantContext()` is not being called. The HTTP tenant middleware is irrelevant here — the stdio transport path needs its own tenant context initialization.

### What to Do

1. **Find `createStdioTenantContext`** — Search the codebase for this function. It's defined somewhere but not being invoked in the stdio entry point.

2. **Find the stdio entry point** — This is the file that initializes the MCP server for stdio transport (likely the main entry file, something like `index.ts`, `main.ts`, `server.ts`, or `stdio.ts`). Look for where the MCP server is created and where `stdio` transport is configured.

3. **Call `createStdioTenantContext()` before the server starts accepting tool calls.** Check what arguments it expects — likely a tenant ID, org ID, or config object. There may be an env var like `DEFAULT_TENANT`, `TENANT_ID`, or `ORG_ID` that should supply the value. Check `.env.example`, `.env`, or config files for tenant-related variables.

4. **Ensure the tenant context wraps or is available to all tool handlers.** The pattern is probably something like:
   ```typescript
   const tenantContext = createStdioTenantContext({ tenantId: process.env.TENANT_ID });
   // server setup uses tenantContext...
   ```
   But check the actual function signature and how existing HTTP middleware provides tenant context to handlers — the stdio version should provide the equivalent.

5. **If a tenant ID is needed, check for env vars** that should supply it. If none exist, a default tenant may need to be configured for local dev.

### Expected Result

`create_patient` and all other write operations work. Health check shows an actual tenant name instead of `"unknown"`.

---

## Issue 2: Clay API Connection Failing

### Symptom

- Health check reports Clay as **unhealthy** with low latency (91ms).
- Direct Clay tool calls return generic execution errors.
- Fast response + error = **authentication or authorization issue**, not connectivity.

### Background: How Clay's API Works

Clay's API is more complex than a typical SaaS API. Key findings from research:

#### Authentication Format

Clay uses **Bearer token authentication**:
```
Authorization: Bearer YOUR_API_KEY
```
NOT `x-api-key`, `Api-Key`, or bare tokens. **Verify the Togari Clay client uses exactly this format.**

Note: The community-built Clay MCP server (bpw-civic/clay-mcp-server) uses `X-Api-Key` — if Togari is wrapping or referencing that project, the header might be wrong.

#### Two API Versions

- **`api.clay.com/v1/`** — Limited REST API (community MCP server targets this)
- **`api.clay.com/v3/`** — Internal API, historically cookie-based auth. Clay's official MCP endpoint is at `/v3/mcp` with token-based auth.

Check which URL/version Togari's health check and enrichment code targets.

#### Plan Tier May Block Access (HIGH LIKELIHOOD)

**Clay's pricing page lists "Clay API access" as Enterprise-only.** Tier breakdown:

- **Free** — No API access
- **Launch** ($185/mo) — BYOK support, no external API access
- **Growth** ($495/mo) — HTTP API enrichment columns (calling OTHER APIs from Clay), webhooks — but NOT programmatic access TO Clay's API from external code
- **Enterprise** (custom) — Includes "Clay API access"

If the account isn't Enterprise, the key is valid for internal Clay features but rejected for external API calls — producing exactly the "fast error" pattern we see.

#### MCP-Specific Requirements

If Togari connects to Clay's MCP endpoint (`api.clay.com/v3/mcp`):

- **Streamable HTTP transport** — JSON-RPC 2.0 via HTTP POST
- **Session management** — If the server returns `Mcp-Session-Id` after init, the client MUST include it on subsequent requests
- **Accept header** — Should include `application/json, text/event-stream`
- **MCP Beta enrollment** — May be required; check with Clay support
- **Workspace admin controls** — Admins can restrict which users can use MCP servers

#### API Key Details

- Found under **Settings → Your Profile → API key** in Clay dashboard
- One key per user account, no scopes or permissions granularity
- Regenerating a key immediately invalidates the old one
- Keys are workspace-scoped
- **Hidden characters pitfall** — Clay's docs warn to paste into plain text editor to check for invisible characters

### Diagnostic Steps

Work through in order:

1. **Find the Clay client code** — Search for: `clay`, `CLAY_API_KEY`, `api.clay.com`, `Authorization`, `Bearer`.

2. **Check the auth header format** — Must be `Authorization: Bearer <key>`. This is the #1 code-level fix if wrong.

3. **Add response logging to the health check** — Capture the HTTP status code and response body from Clay. This tells you immediately:
   - `401` → Key missing, malformed, or invalid
   - `403` → Key valid but lacks permission (plan-tier issue)
   - `429` → Rate limited
   - `400` → Malformed request or missing `Mcp-Session-Id`

4. **Test with curl directly** — Isolate whether it's a code issue or key/account issue:
   ```bash
   curl -X POST https://api.clay.com/v3/mcp \
     -H "Authorization: Bearer $CLAY_API_KEY" \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"togari-test","version":"1.0.0"}},"id":1}'
   ```

5. **Check the env var** — Verify `CLAY_API_KEY` (or whatever it's named) is set in your local `.env` and matches the current key in Clay's dashboard. Compare character-by-character in a plain text editor.

6. **Check if Togari uses Clay's MCP endpoint vs REST API** — Make sure the health check tests the same endpoint the actual enrichment features use.

7. **If all code-level checks pass** — The account likely needs Enterprise tier or MCP beta enrollment. Contact Clay support (support@clay.com, 9 AM–9 PM EST Mon–Fri) or Clay Community Slack (community.clay.com).

### Expected Result

Clay health check returns `"healthy": true` and enrichment features work.

---

## Priority

1. **Fix tenant context** — Call `createStdioTenantContext()` in the stdio entry point. This unblocks all write operations.
2. **Fix Clay connection** — Start with auth header format + response code logging, escalate to plan-tier investigation if code fixes don't resolve it.
3. **Structify** — Deprioritize. 10.5s timeout is likely an outage on their end.
