---
name: Togari strategy and Friday delivery
description: Sagar's vision for Togari, headless data warehouse first, frontend later, Clay eliminated via baked-in Exa/Crust/Perplexity APIs, DealCloud realtime sync is the prize
type: project
originSessionId: ca5080bd-5c54-4ab4-98c2-85fe479727f9
---

Togari is a headless data warehouse + AI orchestration wrapper for PE / buy-side / sell-side advisory firms. Sagar's order of operations:

1. **Headless togari data warehouse by Friday**, mandate entering → Clay processing → store in warehouse → DealCloud real-time sync. The full pipeline ships before any UI/UX polish.
2. **Frontend interface to replicate DealCloud** comes AFTER the data layer is locked.
3. **The prize**: tasks updated from ChatGPT/Claude reflected in DealCloud real-time.

**Eliminate Clay dependency** by baking in directly:

- Exa API
- Crust Data API
- Perplexity API
- Grata API (for list-building endpoints, confirmed by Caleb May 11, 2026; separate from 48NorthPlatform's Grata-XLSX-import workflow)
- Later: Smartlead API

This kills the need for Clay enterprise warehouse access (which they don't grant easily).

**Cascade strategy:**

- Build E2E for 48North as the first tenant
- BMA interns use Clay externally to activate workflows for selling Togari itself
- Enterprise customers → custom Togari build-outs
- Non-enterprise customers (think AIJ) → leverage Amber companion app + ad-hoc Clay build-outs

**Other API integrations on the roadmap:** Grata, ZoomInfo, True People Data.

**MCP layer**: Togari MCP needs to connect into Claude/Perplexity/ChatGPT/Slack/Teams and leverage the internal warehouse + the bundled APIs on usage-based pricing. Design principles still unscoped.

**Why:** Sagar wants Togari positioned as the wrapper for PE advisory before competitors fill the gap. The Clay-replacement strategy makes margins viable and avoids being held hostage by Clay's enterprise gating.

**How to apply:** When prioritizing Togari work, the data warehouse / sourcing pipeline / DealCloud sync / API integrations beat frontend polish. The togari-frontend dashboard rewrite that shipped May 9 is speculative UI ahead of the data layer, fine to have but not the gate. The two unmerged branches on togari-platform (`caleb/sourcing-ai-orchestration`, `caleb/sourcing-prewrites-and-validation`) are part of the Friday warehouse delivery.

## CORRECTION (May 11, 2026): what Sagar's "production-ready repo" actually is

Sagar's referenced repo is `lattice-partners/autotier` (cloned at `/Users/joelnewton/autotier`). Full lift inventory: see `project_togari_autotier_lift_plan.md`.

**Plot twist**: autotier does NOT have Exa / Perplexity / CrustData / Clay / DealCloud integrations. It has ZoomInfo + Enformion + OpenAI web-search + Google Places + Playwright, wrapped in a production-grade harness: Postgres scheduler, BullMQ buffer, AI agent loop with 7 tools, cost tracking, status state machine, mandate intake UI. Sagar handed us the chassis, not the destination.

**Revised execution model**: lift autotier's harness into togari-platform + togari-frontend (scheduler, cost tracker, retry, agent loop, ui primitives), strip vendor + autotier-branding cleanly on the way in, then write Exa / CrustData / Perplexity as NEW tools that slot into autotier's existing 7-tool registration pattern. The Clay-elimination thesis ships natively because the harness doesn't care which tools the agent calls.

**Critical gates that autotier doesn't solve and Togari must build:**

1. **Multi-tenancy**, autotier is single-tenant with zero `tenant_id` and zero RLS policies. Togari must bake `tenant_id` into every table and write actual RLS policies BEFORE running any lifted migration.
2. **DealCloud writeback**, truly greenfield. Build as a post-finalization hook on tiering_run completion.
3. **Real auth**, autotier uses next-auth Credentials with a shared `APP_PASSWORD`. Togari needs Auth0 (`dev-4prs757badfajpi5.us.auth0.com`) or Privy per Karthik's Monday decision.
4. **Exa / CrustData / Perplexity tool implementations**, net new code, drop into the agent harness as tools.

## CORRECTION (May 11, 2026, Sagar's feedback): list-building workflow

Sagar's locked workflow as of May 11: **Perplexity (the frontend UI everyone on the team uses) → Clay (list-build enrichment middleware) → Togari (warehouse)**. Clay is the primary list-building engine for now; eventually Togari absorbs that role too. Today, at the end of a Clay list build there are two destinations in parallel: DealCloud (existing manual XLSX import) AND Togari (new, what we are building). Long-term those converge into one, just Togari.

**Implication for Thursday's cut** (Sagar locked the minimum scope May 11):

- The MUST-HAVE on the data side is a Clay → Togari webhook ingestion endpoint that receives completed list-build payloads, verifies HMAC, persists to BigQuery, and is ready to feed downstream tiering / enrichment / DealCloud export.
- Tab 5 in the parallel plan is now this Clay ingestion endpoint, NOT Exa/CrustData/Perplexity/Grata.
- Exa, CrustData, Perplexity, and Grata API clients DEFER to next week. Sagar's framing: "Exa and CrustData should be in Togari for simpler list builds that don't need the Clay functionality. It's a lower priority." Their spec remains as a paste-ready Tab 5b sketch in the deferred appendix of `TOGARI_PARALLEL_PLAN.md`.

**How to apply:** when prioritizing Togari work this week, the Clay webhook receiver + DealCloud XLSX export are the two destinations Sagar wants live by Thursday. Don't build Exa/CrustData/Perplexity/Grata API clients yet; they ship next week as the secondary "simpler list builds without Clay" path. Perplexity-as-a-Togari-MCP-tool is also deferred since the team uses Perplexity's own UI as the entry point, not Togari.
