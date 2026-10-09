---
name: Togari 48NorthPlatform lift plan
description: The Grata→DealCloud pipeline and MCP scaffolding to lift from Nicolasgarcia12/48NorthPlatform into Togari; corrects assumptions about Grata API + DealCloud write
type: project
originSessionId: ca5080bd-5c54-4ab4-98c2-85fe479727f9
---

`Nicolasgarcia12/48NorthPlatform` (cloned at `/Users/joelnewton/48NorthPlatform`) is the Colombian team's repo. Only the DealCloud + MCP layers are relevant to Togari, the AI JSX editor, market-map generator, and 40-file proprietary intel UI are out of scope.

## Critical corrections to earlier assumptions

1. **48NorthPlatform's "Grata integration" is an XLSX import workflow only, but Togari ALSO needs a live Grata API integration.** What 48N built: users export from Grata's UI to `.xlsx`, upload, the platform reshapes into a DealCloud workbook. Zero Grata REST calls in 48N's code, no `GRATA_API_KEY`. The OpenAI middle stage fills missing HQ city/state via `gpt-4o-mini` + Responses-API web search, then classifies industry/vertical/sub-vertical against a tree in Supabase table `dealcloud_settings`. Expected XLSX columns: `Name, Notes, Headquarters, Domain/Website, Milestone, Tier, Industry, Vertical, Sub-Vertical, Business Description`. **What Togari adds (net new)**: a live Grata API integration for list-building endpoints, joins Exa, CrustData, Perplexity as a fourth first-party data source. Per Caleb May 11, 2026: "grata integration, along with being an XLSX import workflow, is also an API integration that will be used for list building endpoints." Build under `src/integrations/grata/` alongside the other three Clay-killer APIs.

2. **DealCloud integration is READ-ONLY** in this codebase. Schema discovery + data reads via REST v4 (`POST /api/rest/v4/data/entrydata/rows/query/{entryTypeId}` with MongoDB-style filters like `{Milestone: {$in: ['NDA Signed']}, Engagement: {$eq: 123}}`). Auth: OAuth2 `client_credentials`, scope `"data"`, 900s token TTL, in-process cache with 60s safety margin. WRITES are deferred to a human importing the generated XLSX via DealCloud's bulk-import UI. `docs/ARCHITECTURE.md` is explicit: "DealCloud integration: One-way pull only." The 48N team deliberately avoided REST v4 write endpoints.

3. **MCP scaffolding is gift-wrapped.** Two working MCP servers using `mcp-handler` (Vercel package):
   - `/api/dealcloud/[transport]/route.ts`, 8 generic DC schema-walker tools (list_entry_types, get_fields, get_choice_values, list_entries, get_entry_data, search_entries, get_list_views, get_view_data). Generic and portable.
   - `/api/intel/[transport]/route.ts`, 40 proprietary intel tools (DON'T port these unless Togari mirrors the same data model).
   - Auth: `?token=` URL query param (chosen for Claude.ai custom connector compatibility, no OAuth-less header injection). MCP uses service-role Supabase key, bypasses RLS, treat `MCP_BEARER_TOKEN` as a high-value secret.
   - Tool registration: `server.registerTool(name, {title, description}, async () => ({content: [{type: 'text', text: markdownString}]}))`. Output is markdown-formatted, not JSON.

## Files to LIFT into togari-platform

- `src/lib/tools/dealcloud/api.ts`, DC OAuth2 client + token cache + REST v4 query helper. Strip hardcoded entry-type IDs (`MA_COUNTERPARTY=32994`, `COMPANY=32993`, `ENGAGEMENT=32998`), these are 48N-tenant-specific. Move to per-tenant config table; re-discover on first connect.
- `src/lib/tools/dealcloud/grata.ts` + `stateAbbrev.ts`, Excel→Excel transformer + 2-stage OpenAI HQ enrichment + classifier. Rename to something tenant-neutral (e.g. `xlsx-mandate-import.ts`).
- `src/lib/xlsx-shim.ts`, `exceljs` wrapper (`readSheetAsJson`, `writeJsonAsXlsxBuffer`). Replaced the unmaintained `xlsx` package after a 2026-05-07 security audit.
- `src/lib/mcp/dealcloud.ts`, 8 generic DC MCP tool formatters (markdown output). Tenant-agnostic.
- `src/app/api/dealcloud/[transport]/route.ts`, DC MCP entrypoint. Rename `serverInfo.name` from `"48North DealCloud"`.
- `src/app/api/intel/[transport]/route.ts` + `tools-dc.ts`, MCP server scaffolding pattern. Keep URL-token auth verbatim.
- `src/lib/intel/dc-bridge.ts`, DC → local Supabase sync with field-level merge rules. Merge priority: DC wins for `website, hq_city, hq_state, revenue, ebitda, phone`. Local wins for `description, tags, entity_type, ownership_type, company_ownership`. Dedup priority for contacts: linkedin URL → email → `dc_contact_id`.
- All 7 `src/app/api/tools/dealcloud/*/route.ts` files: build, enrich, generate, discover, query, settings, bulk-upload. HTTP surface for the Grata flow.
- `src/lib/auth-guard.ts`, `requireAuth()` Supabase helper.
- Migration fragments from `20260504000000_intel_module_schema.sql`: `companies.dc_id TEXT UNIQUE` + index, `people.dc_contact_id TEXT UNIQUE`, `dc_sync_log` (line 370), `enrichment_jobs` (line 385), plus `dealcloud_settings` (type enum: mandate | industry | vertical | sub_vertical, self-referential `parent_id`).

## What to LEAVE BEHIND

- `src/app/admin/dashboards/*` + `/api/dashboards/*` + `/api/render/*`, Lovable-style AI JSX editor (separate product).
- `src/app/admin/intel/*`, 40+ files, proprietary Pitchbook clone.
- `src/lib/tools/travel-map/*` + `/api/tools/travel-map/*`, geocoding + map generator for in-person visits.
- `src/lib/tools/{google-maps,apify,merge}/*` + their API routes, consultancy-specific tooling.
- `src/lib/mcp/intel*.ts` (~700 LOC, 5 files), proprietary intel-write MCP tools.
- `supabase/migrations/20260305000000_bulk_import_mandates.sql`, 48N-specific mandate seeds (Trivest, Frontenac, etc.). DO NOT run on Togari.

## Lift blockers to clean before copying

- `src/app/api/intel/[transport]/route.ts:29`, `name: '48North Intel'`
- `src/app/api/dealcloud/[transport]/route.ts:166`, `name: '48North DealCloud'`
- `src/lib/tools/dealcloud/api.ts:38-43`, comment + hardcoded entry type IDs
- `src/lib/intel/dc-bridge.ts:15`, `COMPANY_ENTRY_TYPE = 32993`
- No LICENSE file at repo root (verify before public-fork).
- Single Supabase project, single DC creds in env, single MCP token, no multi-tenancy. Per-tenant DC creds must move from env to per-org encrypted Supabase rows. Per-tenant entry type IDs must be re-discovered on first connect.
- Hosting: 48NorthPlatform is on Vercel Hobby (60s function timeout). Long-running Togari enrichments need Railway or a higher Vercel tier.

## How to apply

1. Stand up the MCP server in togari-platform first (Step 2 of the revised 10-step plan). Lift `mcp-handler` + the `[transport]` route pattern + URL-token auth and get a "hello world" MCP tool deployed before touching anything else.
2. When porting `api.ts`, configure DC entry-type IDs per-tenant. The hardcoded `32993/32994/32998` are 48N's only.
3. When porting `grata.ts`, rename it. The "Grata" name implies a Grata API client that doesn't exist.
4. When porting any DC route, add a `tenant_id` claim check before any Supabase read.
5. The DealCloud "writeback" Sagar named as the prize requires a decision: live REST v4 POST (untested), Playwright the bulk-import UI (brittle), or stay with XLSX download (user manually imports). The 48N team chose option 3. None of options 1 or 2 exist in code yet.
