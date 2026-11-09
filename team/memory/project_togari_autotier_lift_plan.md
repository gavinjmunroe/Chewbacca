---
name: Togari autotier lift plan
description: Concrete lift plan from lattice-partners/autotier into Togari, what to port, what to strip, what's net new, blockers to clean before copying
type: project
originSessionId: ca5080bd-5c54-4ab4-98c2-85fe479727f9
---

AutoTier (`lattice-partners/autotier`, cloned at `/Users/joelnewton/autotier`) is the "production-ready repo" Sagar referenced. **Critical correction to earlier assumptions**: it has ZERO Exa / Perplexity / CrustData / Apollo / Hunter / Clay / DealCloud integrations. What it has is the harness, Postgres-driven scheduler, BullMQ buffer, AI agent loop with 7 tools, cost tracking, status machine, mandate intake UI. The Clay-elimination thesis ships by writing new Exa/CrustData/Perplexity tool implementations into AutoTier's existing tool-registration pattern.

**Stack:** Next.js (apps/web → Vercel) + BullMQ worker (apps/worker → Railway) + Supabase Postgres. No workspaces/Turbo, each app standalone. Biome via ultracite. License ISC. 639 commits as of 2026-04-30.

## Backend files to LIFT into togari-platform

- `apps/worker/src/lib/scheduler.ts` (512 LOC), Postgres-driven adaptive scheduler, 3s active / 30s idle polling, cooperative cancellation via status flips, stale-job recovery, batched completion RPCs. The crown jewel.
- `apps/worker/src/lib/costTracking.ts` + migration `20260116100000_add_cost_tracking.sql`, `cost_logs` per-call ledger + `updateRunCostSummary` rollup.
- `apps/worker/src/lib/retry.ts`, `withRetry`, `withRetrySilent`, `withRetryAndCircuitBreaker`, Cloudflare gateway error markers.
- `apps/worker/src/lib/tracing.ts` + `aiGatewayUsage.ts`, Braintrust + AsyncLocalStorage tracing + per-user spend attribution.
- `apps/worker/src/lib/{logger,logging,env,redis,settings,bullBoard}.ts`, base utilities.
- `apps/worker/src/worker.ts`, bootstrap with stalled-job recovery, SIGTERM graceful shutdown.
- `apps/worker/src/processors/start/enrichment/agent/{agentConfig,tools,systemPrompt}.ts` (~2,500 LOC combined), the full agent harness: 7-tool registration, ContactAccumulator pattern, audit-log output format, `stopWhen: stepCountIs(maxSteps)` loop. Reskin the 7 tools for Exa/CrustData/Perplexity; keep everything else.
- `apps/worker/src/processors/start/enrichment/agent/{affiliationScoring,companyNameUtils,qualityScoring,crossValidation}.ts`, reusable scoring helpers (Jaro-Winkler domain similarity, legal-suffix stripping).
- `apps/worker/src/processors/services/tiering/ai/{generateTierResult,getBusinessOverview,checkRelevance,analyzeImages}.ts`, structured-rationale tiering (yes/maybe/no per data point).
- `apps/worker/src/processors/processHelpers.ts`, cooperative cancellation pattern.
- Migrations: baseline + `add_queued_status` + `add_cost_tracking` + `add_structured_rationale` + `scheduler_completion_count_rpcs` + `add_priority_preempted_by`, the state machine + completion RPCs.

## Frontend files to LIFT into togari-frontend

- `apps/web/src/hooks/use-visibility-polling.ts`, recursive setTimeout, visibility-aware, overlap-safe. Lift verbatim.
- `apps/web/src/components/criteria/criteria-form.tsx` + `key-data-points-input.tsx` + parse/compile helpers in `lib/utils.ts`, sectioned mandate-criteria editor.
- `apps/web/src/components/companies/{company-table,company-filter-panel,global-company-filter-panel,bulk-tag-dialog,company-details-drawer}.tsx`, bedrock table with dataSource discriminated union, multi-select filters, tier hydration via react-query.
- `apps/web/src/components/upload/xlsx-upload-card.tsx` + `lib/upload/{parser,direct-storage,spreadsheet}.ts`, XLSX intake via signed-URL direct-to-Supabase upload (bypasses Vercel 4.5MB limit).
- `apps/web/src/lib/import-state.ts`, IndexedDB stash for parsed rows between upload → preview → commit.
- `apps/web/src/components/runs/{processing-progress,run-status-badge,structured-rationale-display,run-detail-page-skeleton,run-timeline,manual-tier-override-drawer}.tsx` + `lib/run-progress.ts`, ETA estimation `(waiting × secPerCompany) / active`.
- `apps/web/src/components/ui/*`, entire shadcn-derived primitive folder including `cva`-based `status-badge.tsx`.
- `apps/web/src/app/dashboard/layout.tsx` + `components/ui/sidebar.tsx` + `breadcrumb-context.tsx` + `breadcrumbs.tsx`, sidebar shell + per-page breadcrumb injection via `useBreadcrumbs([...])`.
- `apps/web/src/components/enrichment/{contact-badges,contact-details-drawer,confidence-breakdown,source-comparison,source-icon}.tsx`, multi-source contact display with provenance.
- `apps/web/src/app/api/batches/_lib/{get-batch-snapshot,batch-progress-from-postgres,resolve-run-from-batch-id}.ts`, Postgres-as-source-of-truth batch progress.
- `apps/web/src/lib/{supabase-fetch,api-route-timing}.ts`, Supabase fetch-with-deadline + `[api-timing]` JSON server logs.

## What's NET NEW (autotier doesn't have it)

1. **Multi-tenancy.** AutoTier is single-tenant: zero `tenant_id`, RLS enabled in baseline migration but ZERO `CREATE POLICY` statements anywhere; worker uses service-role key (bypasses RLS). Togari must add `tenant_id` to every table + write real RLS policies from day zero.
2. **DealCloud realtime writeback.** Truly greenfield. AutoTier has XLSX export for manual import only. Build as a post-completion hook on `tiering_run` finalization.
3. **Exa + CrustData + Perplexity tool implementations.** Net new. Each becomes a tool in the existing 7-tool agent harness. ZoomInfo + Enformion clients (~2,700 LOC) become reference-for-shape only.
4. **Real auth.** AutoTier uses next-auth Credentials with a single `APP_PASSWORD` and fake `user@radar.com` identity. Replace with Auth0 (`dev-4prs757badfajpi5.us.auth0.com`) or Privy.
5. **AI-assisted thesis intake.** AutoTier intake is pure text, zero `streamText` / `useChat` / `generateObject` usage in the web app despite `@ai-sdk/openai` being a declared dep. Togari can leapfrog by streaming a parser that turns mandate docs into structured criteria.
6. **Smartlead / Retell / Grata / ZoomInfo / TruePeopleData wrappers.** All on the roadmap, all net new.

## What to STRIP / leave behind

- ZoomInfo (`services/enrichment/zoominfo.ts` 851 LOC + `services/tiering/zoominfo.ts` 718 LOC) + Enformion (`enformion.ts` 939 LOC + `enformionParser.ts` + `enformionPhoneMerge.ts` + `enrichmentEmailFilter.ts`). Vendor glue.
- `processors/start/enrichment/startContactEnrichment.ts`, legacy sequential pipeline.
- `/dashboard/benchmark`, `api/benchmark/*`, `scripts/benchmark-*`, `resources/benchmark-self-improvement/`.
- `/credits` UI + `api/credits/route.ts`.
- `tiering-image-gallery.tsx` + Playwright screenshot pipeline (optional, useful for SMB sourcing but not core PE).
- Single-password auth (`auth.ts:31`, `APP_PASSWORD` env, fake `user@radar.com` identity).
- Heroicons everywhere, pick Lucide per stack standard.

## Lift blockers (clean BEFORE copying)

- Sentry org hardcoded: `apps/web/next.config.ts:17` → `org: "lattice-partners"`, `project: "48n-frontend"`. Client DSN in `apps/web/src/instrumentation-client.ts:10`. Worker DSN in `apps/worker/src/instrument.ts:15`.
- Braintrust project `"48North"` in `apps/worker/src/lib/tracing.ts:33`.
- Storage bucket name `"autotier-files"` in `apps/web/src/lib/upload/spreadsheet.ts:18`, `api/download/route.ts:25`, `api/mandates/[id]/companies/import-list/route.ts:164`.
- IndexedDB name `autotier_import_db` in `apps/web/src/lib/import-state.ts:25`.
- BullMQ globalThis namespace `__autotier_task_queue` in `apps/web/src/app/api/queue/_lib/queue.ts:5`.
- Service-role Supabase on every web API route, only 3 of ~60 call `await auth()`. Auth-gate all routes before multi-tenant.
- Hardcoded model strings `openai/gpt-5.4` and `openai/gpt-5.4-nano` (AutoTier's AI Gateway aliases), verify in Togari's gateway or rename.
- AutoTier branding strings in `app/layout.tsx:19-22`, `dashboard/layout.tsx:55-76`, `login/page.tsx:33-39,85`, plus inlined SVG logo.

## How to apply

When building Togari sourcing/enrichment work, the order is:

1. Fork the harness pieces into a feature branch on togari-platform / togari-frontend.
2. Strip identity (Sentry, Braintrust, bucket names, branding) on the way in.
3. Add `tenant_id` to every lifted migration BEFORE running them. Write RLS policies.
4. Re-implement the 7 agent tools as Exa / CrustData / Perplexity instead of ZoomInfo / Enformion. Keep the agent harness (agentConfig.ts, systemPrompt.ts structure, accumulator pattern) intact.
5. Build DealCloud writeback as a post-finalization hook on tiering_run completion.

Don't recreate the scheduler, cost tracker, retry helpers, agent loop, status state machine, or polling hooks, port them. Don't lift the vendor-specific tool implementations or the autotier branding/auth.
