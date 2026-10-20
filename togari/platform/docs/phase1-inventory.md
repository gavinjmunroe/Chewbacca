# Phase 1 — Inventory

_Snapshot of `togari-bma-prod` as of the start of the Core-extraction refactor._

## TL;DR — Current state vs. target

**The refactor is partially complete already.** A `src/core/` directory and a
`src/transports/` directory both exist. The MCP transport and REST API
transport already import from `core/` with no business-logic duplication.
The Slack path is the main outlier: it lives under `src/agents/slack-sync/`
and contains a parallel implementation of parsing, deal-ops, calendar-ops,
fireflies, query, and proposal generation. This is where the bulk of the
remaining work is.

Also, a few pieces called for by the target spec do not yet exist:
- `core/claude-loop.ts` (a generalized Claude tool-use loop)
- `core/prompts/system.ts` with an examples-loader hook
- `core/models/router.ts`
- `core/identity.ts`
- `core/tools/` directory (ops files are currently flat in `core/`)
- `Attachment` / `UserContext` types on `TogariRequest`
- `conversationId` on `TogariRequest`

## 1. Files that call the Anthropic API

Hits for `@anthropic-ai/sdk` / `new Anthropic(...)` / `anthropic.messages`:
only one file directly uses the SDK client:
- `src/bigquery/sql-generator.ts` — uses `new Anthropic()` to turn NL into
  SQL for `queryDeals`.

All other callers use `fetch('https://api.anthropic.com/v1/messages', ...)`
directly:

| File | Purpose |
|------|---------|
| `src/core/engine.ts` | `handleConversation()` fallback chat |
| `src/core/intent-router.ts` | Intent classification |
| `src/core/meeting-intel.ts` | Claude-powered meeting finder + analysis |
| `src/core/email-ops.ts` | Draft reply generation |
| `src/core/proposal-ops.ts` | Proposal markdown generation |
| `src/core/deal-ops.ts` | Uses Claude (via `sql-generator`) for NL->SQL |
| `src/agents/slack-sync/index.ts` | **Duplicate** `handleConversation()` + inline meeting-analysis Claude call |
| `src/agents/slack-sync/parser.ts` | **Duplicate** of intent classification |
| `src/agents/slack-sync/query-handler.ts` | **Duplicate** of NL->SQL path |
| `src/agents/slack-sync/proposal-generator.ts` | **Duplicate** of proposal-ops |
| `src/agents/slack-sync/fireflies-client.ts` | Claude-based meeting resolver |
| `src/agents/smartlead-responder/classifier.ts` | Smartlead email classifier (out of scope) |
| `src/email-engine/classifier.ts` | Inbound email classifier (out of scope) |

`src/resilience/circuit-breaker.ts`, `src/secrets/*.ts`,
`src/middleware/rate-limiter.ts`, `src/bigquery/sql-generator.ts`,
`src/config/connectors.ts` only *mention* Anthropic in strings/config — no
calls.

## 2. Files that call external tool APIs

### Gmail / Calendar (`googleapis`)
- `src/core/email-ops.ts` — core Gmail send/draft
- `src/core/calendar-ops.ts` — core Calendar event create
- `src/agents/slack-sync/calendar-sync.ts` — **duplicate** Calendar path used only by Slack
- `src/email-engine/gmail-client.ts` — inbox polling (out of scope)
- `src/pdw/adapters/gmail.ts`, `gdrive.ts`, `loom.ts`, `fireflies.ts` — PDW ingestion (out of scope)
- `src/agents/slack-sync/parser.ts` — string reference only

### Fireflies
- `src/core/meeting-intel.ts` — core Fireflies search/transcript
- `src/agents/slack-sync/fireflies-client.ts` — **duplicate** Fireflies client
- `src/transports/mcp/handlers.ts` / `tools.ts` — references only
- `src/transports/api/router.ts` — references only
- `src/pdw/adapters/fireflies.ts` — PDW ingestion (out of scope)
- `src/secrets/known-secrets.ts`, `src/config/connectors.ts` — config only

### BigQuery (`@google-cloud/bigquery`)
- `src/bigquery/client.ts` — shared client (used by core + slack-sync)
- `src/bigquery/sql-generator.ts` — shared NL->SQL
- `src/core/deal-ops.ts` — core deal CRUD / queries
- `src/agents/slack-sync/deal-sync.ts` — **duplicate** deal upsert (Slack-only)
- `src/agents/slack-sync/deal-context.ts` — **duplicate** deal lookup (Slack-only)
- `src/agents/slack-sync/query-handler.ts` — **duplicate** NL query (Slack-only)
- `src/email-engine/deal-lookup.ts` — email inbound lookup (out of scope)
- `src/pdw/*` — PDW ingestion (out of scope)
- `src/server.ts` — direct REST `/deals/write` endpoint
- `src/middleware/audit.ts`, `src/index.ts` — admin infra

### Deal CRUD / Reminders
- `src/core/deal-ops.ts`, `src/core/reminder-ops.ts` — canonical core impls
- `src/agents/slack-sync/deal-sync.ts`, `deal-context.ts`, `responder.ts`
  `scheduleReminder()` / `scheduleNativeReminders()` — Slack-specific duplicates

## 3. Files with Slack-specific imports

Only 2 files import from `@slack/web-api`:
- `src/email-engine/slack-client.ts` — posts inbound-email summaries (out of scope)
- `src/agents/slack-sync/responder.ts` — the BMA CRM bot's Slack client

Files with heavy Slack-specific logic (Block Kit formatting, `chat.postMessage`,
`chat.scheduleMessage`, URL parsing of `<@U…>` mentions, `thread_ts`):
- `src/agents/slack-sync/index.ts` — webhook handler + aggregation + Block Kit
- `src/agents/slack-sync/responder.ts` — Slack API wrapper
- `src/agents/slack-sync/parser.ts` — uses Slack raw text context
- `src/agents/slack-sync/deal-sync.ts` — embeds Slack permalinks in notes
- `src/agents/slack-sync/proposal-output.ts` — Block Kit for proposals
- `src/agents/slack-sync/proposal-generator.ts` — formats for Slack UI
- `src/agents/smartlead-responder/slack-actions.ts` — Smartlead modal actions (out of scope)
- `src/server.ts` — Slack interactivity + events routes, signature verify
- `src/ontology/channels.ts`, `src/core/types.ts`, `src/core/engine.ts`,
  `src/core/intent-router.ts`, `src/core/proposal-ops.ts` — the string `'slack'` appears as a platform enum only

## 4. Files with MCP-specific imports

`@modelcontextprotocol/sdk` only referenced in:
- `src/transports/mcp/server.ts` — Streamable HTTP + SSE transport setup
- `src/transports/mcp/handlers.ts` — per-tool handlers (already delegates to core/)
- `src/transports/mcp/tools.ts` — tool schema definitions

`src/server.ts` wires `setupMcpRoutes(app)`. Other matches (`src/core/types.ts`,
`src/index.ts`, `src/middleware/audit.ts`, `src/observability/logger.ts`) only
contain the string `'mcp'` as a platform discriminator — no SDK imports.

## 5. Shared utilities already in common locations

| Directory | Purpose |
|-----------|---------|
| `src/observability/` | `createLogger`, Sentry wrapper |
| `src/bigquery/` | Shared BigQuery client + NL->SQL generator |
| `src/secrets/` | Secret Manager wrapper, known-secret registry |
| `src/auth/` | JWT / OAuth discovery |
| `src/resilience/` | Circuit breaker + connector registry |
| `src/middleware/` | Rate limiter, audit middleware |
| `src/errors/` | Error types + handler |
| `src/ontology/` | Enums (pipelines, stages, platforms), channel constants, guardrails |
| `src/config/` | Limits, model IDs, connector config |
| `src/tenant/` | Tenant context plumbing |
| `src/storage/` | GCS wrapper |
| `src/events/` | Pub/Sub publisher |
| `src/utils/` | Validation, hashing |
| `src/pdw/` | Person Data Warehouse (independent subsystem) |

## 6. Current `core/` surface (already extracted)

```
src/core/
  engine.ts          processMessage(TogariRequest) -> TogariResponse
  intent-router.ts   classifyIntent(TogariRequest) -> ParsedIntent[]
  deal-ops.ts        searchDeal, createDeal, updateDeal, queryDeals, logActivity
  calendar-ops.ts    scheduleEvent
  email-ops.ts       sendEmail, draftReply
  meeting-intel.ts   findMeeting, searchMeetings, analyzeMeeting
  proposal-ops.ts    generateProposal
  reminder-ops.ts    setReminder
  types.ts           TogariRequest, TogariResponse, ParsedIntent, Deal, ...
```

Already consumed by `transports/mcp/handlers.ts` and `transports/api/router.ts`.
**Not yet consumed by `agents/slack-sync/`**, which still runs its own
parallel implementation.

## 7. Gap between current `core/` and the target spec

| Target (from task) | Current status |
|--------------------|----------------|
| `core/processMessage.ts` | Exists as `core/engine.ts::processMessage` |
| `core/classifier.ts` | Exists as `core/intent-router.ts::classifyIntent` |
| `core/claude-loop.ts` | **Missing** — Claude calls are inlined per-op |
| `core/tools/*.ts` | Currently flat `core/*-ops.ts` files (no `tools/` subdir) |
| `core/prompts/system.ts` | **Missing** — prompts inlined in engine.ts + intent-router.ts |
| `core/models/router.ts` | **Missing** — model id is hardcoded per call |
| `core/types.ts` (Attachment, UserContext, conversationId) | Partial — `TogariRequest` exists but has no `attachments`, `conversationId`, `UserContext`, no `Attachment` type |
| `core/identity.ts` | **Missing** — userId is passed through from transport |
| `transports/slack/` | **Missing** — Slack code lives at `agents/slack-sync/` and is not thin |
| `transports/mcp/` | Exists, already thin |
| `transports/api/` | Exists (bonus — not in target spec, but works) |

## 8. Out-of-scope subsystems that also live in `src/` (leave alone)

- `src/agents/smartlead-responder/` — Smartlead inbound-email classifier + Slack card UI for cold-outbound replies.
- `src/email-engine/` — Polls team Gmail inboxes, classifies inbound, posts to Slack.
- `src/pdw/` — Person Data Warehouse ingestion pipeline.
- `src/server.ts` `/deals/write`, `/email/process*` endpoints — admin REST surfaces.

## 9. Test suite

**There are no existing tests.** `package.json` has no test script and no
test framework dependencies (`vitest`, `jest`, `mocha`) installed. Step 1
will add `vitest` as a devDep and create `tests/smoke/`.

## 10. Risks / notes for the refactor

1. The Slack `parser.ts` (513 lines) and `core/intent-router.ts` (386 lines)
   have **different** prompt text and **different** parser output shapes
   (`ParsedSlackMessage` vs `ParsedIntent`). Collapsing them to one will
   require a careful field-by-field check to avoid regressing Slack behavior.
2. `slack-sync/index.ts::processSingleAction` duplicates every branch of
   `core/engine.ts::handleSingleIntent` with Slack-specific side effects
   (e.g. `postTextReply` mid-flow for proposal loading indicator, direct
   Slack scheduleMessage for reminders). The Slack transport will need
   callbacks / a streaming response API, or it must accept slightly later
   "progress" messaging than it does today.
3. `slack-sync/deal-sync.ts` embeds a Slack permalink in the deal `notes`
   field. This is a transport-specific side effect that must be preserved
   either via a `context.slackPermalink` field in `TogariRequest` or a
   post-processor hook.
4. `slack-sync/responder.ts::scheduleReminder` uses Slack's
   `chat.scheduleMessage` directly. `core/reminder-ops.ts::setReminder`
   takes a `platform` param but its behavior on Slack needs to be verified
   to match the existing Slack-specific path exactly.
5. Two separate `handleConversation()` implementations with **different**
   system prompts (one mentions Smartlead, one doesn't). The merged one
   should be the `core/engine.ts` version (no Smartlead tie-in) since the
   core is transport-agnostic.
