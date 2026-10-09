---
name: Togari open threads
description: Unscoped or pending items from the May 2026 sync, Sagar's mystery repo, DealCloud writeback, MCP design principles, Retell setup, Karthik's CI hardening
type: project
originSessionId: ca5080bd-5c54-4ab4-98c2-85fe479727f9
---

These are the items from the May 2026 strategy sync (Sagar's notes + Karthik's reply to Caleb's 5 questions) that don't yet have an owner, plan, or location.

**1. Sagar's "full, production ready repo to build off of."** He referenced this as already-secured but the location/name was not given. Worth asking before assuming the work starts from togari-platform or togari-bma-dvlp.

**2. DealCloud realtime writeback.** Sagar named this as "the prize", tasks updated from ChatGPT/Claude reflected in DealCloud real-time. Not on Karthik's weekend list. No design pass yet. Needs scoping before code.

**3. Togari MCP layer design principles.** Sagar wants Togari MCP connecting into Claude/Perplexity/ChatGPT/Slack/Teams with usage-based pricing, leveraging the warehouse + bundled APIs (Exa, Crust, Perplexity, eventually Smartlead, Grata, ZoomInfo, True People Data). Pricing model and surface area not yet specified.

**4. Retell phone-number plumbing for 48N.** Karthik will pull a sandbox dataset that's accurate to 48N's work for Retell to play with. Inbound callback number defaults to Retell-issued unless Parker wants to use an internal 48N sales contact. Confirmation pending Parker.

**5. Karthik's CI/health hardening for togari-platform.** Memory limits, branch protection, typecheck-on-PR, all planned by end of weekend (May 10-11, 2026). Until those land, multi-branch development is flying blind on type safety. Caleb already has `caleb/ci-typecheck` on togari-bma-dvlp pushed but no equivalent on platform yet.

**6. Auth0 + Privy combo decision.** Karthik is evaluating both for Togari. Decision and re-integration happens Monday/Tuesday May 11-12 after the Auth0 team call and GCP call. Until then, Auth0 stays disabled in the platform flow.

**7. Karthik's Wed/Thu deliverable target.** He's confident about a Wed/Thu (~May 14-15, 2026) testable cut for the 48N team. Sagar's pull is more aggressive ("should be implemented tonight" was said about a slice of this). Real expectation lives somewhere between those two dates.

**How to apply:** When picking up Togari work, check if the task touches one of these threads. If yes, the answer probably waits on a person (Sagar for #1-3, Parker for #4, Karthik for #5-6). Don't invent specs in their absence, ask.

## Decisions locked May 11, 2026 (after the 48NorthPlatform scan)

1. **MCP SDK choice**: Use `@modelcontextprotocol/sdk` (Anthropic official) NOT `mcp-handler` (Vercel-specific). Portable across hosts; aligns with where the MCP ecosystem is going.
2. **DealCloud writeback**: Start with XLSX-download path (same as 48NorthPlatform). Keep REST v4 POST and Playwright bulk-import as future options if XLSX gets clunky for tenants. Do not over-build now.
3. **Hosting**: Togari stays on Railway (where togari-platform + togari-frontend already run). No 60s function timeout, that limit is Vercel Hobby, not Railway. Long-running enrichment + streaming MCP tool calls are fine natively.
4. **Multi-tenancy**: Single Supabase project for now since we are only serving 48N. Build with `tenant_id` columns on every table from day zero so the second tenant doesn't require a schema migration. Defer RLS policy authoring + per-org credential encryption until tenant #2 is on the horizon. (Update: as of May 11 the DB is GCP BigQuery, not Supabase; tenant_id discipline carries over.)

## Decisions locked May 11, 2026 (after Sagar's list-building workflow feedback)

5. **List-building workflow**: Perplexity (frontend UI the team uses) → Clay (enrichment middleware) → Togari (warehouse). Clay is the primary list-builder for now; eventually Togari subsumes that role. Today's outbound side of Clay has two destinations running in parallel: DealCloud (existing manual XLSX import) AND Togari (new, what we are building this week). Long-term those converge into one, just Togari.
6. **Clay → Togari ingestion mechanism**: Clay webhook POSTs to a Togari endpoint we expose at `POST /api/ingest/clay`. Push model, real-time. HMAC-SHA256 signature verification via `X-Clay-Signature` header against `CLAY_WEBHOOK_SECRET`. Payload validated by Zod, persisted to BigQuery (`companies`, `contacts`, `mandate_companies`, audit row in new `clay_imports` table).
7. **Thursday minimum scope** (May 14 cut for 48N team test): Clay → Togari webhook ingestion + DealCloud XLSX export. NOTHING ELSE on the data sources side this week. Exa, CrustData, Perplexity, and Grata API clients all DEFER to next week, their full spec is paste-ready in the deferred appendix of `TOGARI_PARALLEL_PLAN.md`. Sagar's framing: "Exa and CrustData should be in Togari for simpler list builds that don't need the Clay functionality. It's a lower priority."
8. **Perplexity-as-MCP-tool**: deferred. The team uses Perplexity's own UI as the entry point to the workflow; Togari doesn't need to expose Perplexity as an MCP tool until much later, if at all.
