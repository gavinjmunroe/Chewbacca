# Togari GTM MCP Server — Buildout Status

*Last updated: March 30, 2026*

---

## What This Is

A Model Context Protocol (MCP) server — the unified GTM (Go-To-Market) Operating System for Blue Modern Advisory's healthcare sales operations. It exposes **59 MCP tools** across all 5 funnel stages (TOF/MOF/BOF/CS/Analytics), integrates BigQuery for natural language data queries, and enforces a theology-aware content governance system. Supports both stdio (Claude Desktop) and HTTP/SSE (Cloud Run / Railway) transports.

**What changed since v1:** BOF, CS, and Analytics agents are now fully implemented (no longer stubs). Production resilience layer added (circuit breakers, retry, structured errors). Direct-mode REST API bypasses Claude for core CRUD. Cloud Pub/Sub event system publishes every mutation. Sentry error tracking integrated. ToolProvider abstraction decouples external API clients. Governance test suite verifies all 7 guardrail systems. Tool count went from 56 to 59.

---

## Architecture

```
src/
├── index.ts                              ← MCP server entry (59 tools, stdio + HTTP/SSE)
├── config/
│   ├── channels.ts                       ← 15 channel definitions with theology frames
│   ├── team.ts                           ← 8 team members, roles, meeting routing rules
│   ├── personas.ts                       ← 3 buyer personas (A/B/C) with constraints
│   └── guardrails.ts                     ← Ethical floor, Six Dimensions of Health, volume rules
├── agents/
│   ├── top-of-funnel/                    ← 34 tools (signal scout, conscience check, 8 channels)
│   │   ├── shared/                       ← Signal scout, conscience check, research, personalization, sequencing, meeting booking
│   │   └── channels/
│   │       ├── cold-email/               ← 4 tools (build_list, personalize, create_sequence, book_meeting)
│   │       ├── warm-email/               ← 4 tools (inbound triggers)
│   │       ├── linkedin-posting/         ← 4 tools (content publishing + engagement)
│   │       ├── linkedin-dm/              ← 4 tools (partnerships — stub)
│   │       ├── instagram-dm/             ← 4 tools (stub)
│   │       ├── imessage-dm/              ← 4 tools (stub)
│   │       ├── instagram-posting/        ← 4 tools (stub)
│   │       └── x-posting/               ← 4 tools (stub)
│   ├── middle-of-funnel/                 ← 13 tools (deals, routing, analytics, playbook)
│   │   ├── orchestrator.ts               ← mof_orchestrator (routes to right agent)
│   │   ├── reply-router.ts               ← Classify replies, generate 3 response options
│   │   ├── meeting-router.ts             ← Extract deal intel from transcripts/calls
│   │   ├── deal-manager.ts               ← CRUD on BigQuery deals table + event publishing
│   │   ├── deal-store.ts                 ← BigQuery deal persistence (parameterized queries)
│   │   ├── fireflies-agent.ts            ← Normalize Fireflies transcripts
│   │   ├── gmail-agent.ts                ← Extract deal intel from Gmail threads
│   │   ├── chat-dump-interpreter.ts      ← Interpret messy raw notes into deal updates
│   │   ├── kanban-view.ts                ← Pipeline visualization by stage
│   │   ├── pipeline-analytics.ts         ← Funnel metrics, bottleneck analysis
│   │   ├── rep-analytics.ts              ← Per-rep performance + coaching suggestions
│   │   └── playbook-agent.ts             ← ICP, MEDDIC, objection handling lookup
│   ├── bottom-of-funnel/                 ← 3 tools (FULLY IMPLEMENTED)
│   │   ├── proposal-generator.ts         ← Persona-specific proposals + SOWs
│   │   ├── pilot-tracker.ts              ← Trial milestones, health scores
│   │   └── onboarding-orchestrator.ts    ← 8-task onboarding checklist generation
│   ├── customer-success/                 ← 3 tools (FULLY IMPLEMENTED)
│   │   ├── health-score.ts               ← Composite 0-100 account health
│   │   ├── qbr-generator.ts              ← Quarterly Business Review generation
│   │   └── upsell-detector.ts            ← Expansion signal detection
│   ├── analytics/                        ← 3 tools (FULLY IMPLEMENTED)
│   │   ├── cross-funnel-analytics.ts     ← Full-funnel metrics + bottlenecks
│   │   ├── data-enrichment.ts            ← Batch contact enrichment (Clay, Exa)
│   │   └── data-pipeline.ts              ← Data validation + transformation
│   └── slack-sync/                       ← Slack bot handler
│       ├── calendar-sync.ts              ← Sync calendar blocks to Slack
│       ├── deal-sync.ts                  ← Post deal updates to Slack threads
│       ├── parser.ts                     ← Parse Slack message commands
│       └── responder.ts                  ← Send Slack thread replies
├── events/                               ← Cloud Pub/Sub event system (NEW)
│   ├── types.ts                          ← 6 typed event schemas (discriminated union)
│   ├── publisher.ts                      ← publishEvent() — fire-and-forget
│   └── index.ts                          ← Barrel exports
├── lib/                                  ← Production resilience (NEW)
│   ├── circuit-breaker.ts                ← CLOSED/OPEN/HALF_OPEN state machine
│   ├── retry.ts                          ← Exponential backoff (3 attempts, 1s→2s→4s)
│   └── structured-error.ts              ← JSON error responses (no stack traces to Claude)
├── middleware/                            ← HTTP middleware (NEW)
│   ├── auth.ts                           ← JWT validation (Auth0 RS256) + AsyncLocalStorage tenant context
│   └── rate-limiter.ts                   ← Token bucket (100 req/min per tenant)
├── routes/                               ← Direct-mode REST API (NEW)
│   └── direct-api.ts                     ← /api/deals, /api/contacts/search, /api/pipeline/kanban
├── services/
│   ├── config.ts                         ← loadConfig() from GCP Secret Manager + env vars
│   ├── sql-generator.ts                  ← NL → BigQuery SQL via Claude
│   ├── bigquery-client.ts                ← Execute read-only SQL (SELECT only)
│   ├── audit-logger.ts                   ← Fire-and-forget tool invocation logging to BigQuery
│   ├── sentry.ts                         ← Sentry error tracking + wrapToolHandler() (NEW)
│   ├── oauth.ts                          ← OAuth discovery endpoints
│   ├── secret-manager.ts                 ← GCP Secret Manager client
│   ├── rate-limiter.ts                   ← Rate limiter service
│   └── providers/                        ← ToolProvider abstraction layer (NEW)
│       ├── tool-provider.ts              ← ToolProvider interface + BaseToolProvider
│       ├── tool-registry.ts              ← Central registry with circuit breakers per provider
│       ├── exa-provider.ts               ← Web search (100 calls/day limit)
│       ├── clay-provider.ts              ← Company/contact enrichment (10 calls/min limit)
│       ├── structify-provider.ts         ← Data normalization
│       ├── gmail-provider.ts             ← Gmail with OAuth token refresh
│       └── calendar-provider.ts          ← Google Calendar with OAuth token refresh
├── prompts/
│   ├── email-generation.ts               ← Persona-specific email prompt builder
│   ├── signal-generation.ts              ← 4-step signal package builder
│   ├── reply-classification.ts           ← Reply classification prompts
│   └── meeting-brief.ts                  ← Meeting prep prompts
├── schemas/
│   ├── enums.ts                          ← All Zod enums (personas, channels, theology, stages, etc.)
│   ├── email-templates.ts                ← Email draft/review schemas, word limits, blacklist
│   ├── pipeline-state.ts                 ← Deal/pipeline schemas
│   ├── signal-package.ts                 ← Signal package schema
│   ├── relationship-record.ts            ← Relationship schemas
│   ├── meeting-brief.ts                  ← Meeting brief schema
│   ├── content-brief.ts                  ← Content brief schema
│   └── conscience-report.ts              ← Conscience audit schema
├── tests/                                ← Test suites (NEW)
│   └── governance.test.ts                ← 131 assertions across all 7 governance systems
└── tools/
    └── query-contacts.ts                 ← query_contacts / query_deals handler

infra/
└── monitoring-setup.sh                   ← GCP Pub/Sub, Monitoring dashboard, alert policies (NEW)
```

---

## Core Concepts

### 1. Channel Theology System

Every outbound channel has a theology frame that governs what content is allowed. This is a hard enforcement system, not advisory.

| Frame | Channels | Rules |
|---|---|---|
| Enterprise Credible | bma_linkedin, cold_email, warm_email, linkedin_outbound, linkedin_posting | GTM signals only. No spiritual content whatsoever. |
| Vedic Systems | sagar_linkedin, x_posting | Nature-rooted wisdom. No Jesus content. Always seeking, never declaring. |
| Jesus Service | caleb_personal | Unapologetically Jesus-centered. No Vedic framing. |
| Nature Reverent | gartiwar, rytual, instagram_dm, instagram_posting | Contemplative, nature-as-teacher. No Jesus content. No hype. |
| Peer Warm | kevin_linkedin, linkedin_dm, imessage_dm | Relational, dependable. No theology required. |

`validateTheologyLine(channel, contentText)` checks every piece of content for violations before it goes out. Returns `{ valid: boolean, violations: string[] }`.

### 2. Buyer Personas

Three ICP segments, each with hard word limits and preferred structures:

| Persona | Title | Company Size | Max Words | Preferred Sender |
|---|---|---|---|---|
| A | VP Revenue Operations | 250-2,000, Series B+ | 120 | Kevin |
| B | Head of Strategy | 500-5,000, Series C+ | 150 | Sagar |
| C | Chief Commercial Officer (Digital Health Startup) | 30-200, Seed-Series A | 90 | Kevin |

Each has a `subjectLineFormula`, `bodyStructure[]`, and `preferredOfferTypes`.

### 3. Team Structure & Meeting Routing

8 team members across strategist/engineer roles:

- **Strategists:** Kevin Kong (closer), Sagar Tiwari (founder), Drew, Gwen (partnerships), Caleb (engineer + strategist)
- **Engineers:** Mike (triage), Maggie, Karthik (product bridge)

Hard routing rule: All positive signals → Kevin → Mike → Maggie (triage chain)

### 4. The Six Dimensions of Health

Every GTM decision is evaluated against:

1. Physical
2. Mental
3. Emotional
4. Social
5. Spiritual
6. Financial

"Financial enables, never overrides other dimensions."

### 5. Ethical Floor (Enforced Everywhere)

- No hatred, exploitation, fear-based copy, or reducing humans to metrics
- Animals and plants are stakeholders
- CAN-SPAM compliance: unsubscribe + physical address in every email footer
- HIPAA: Togari sells GTM intelligence, never patient data
- Unsubscribe = immediate removal, no follow-up ever

### 6. Volume Rules (Hard Limits)

- Max 40 cold emails per inbox per day, 200 per domain per day
- Send days: Tue-Thu only, 8am-11am recipient timezone
- Never Friday-Monday
- 4-week warmup: week 1 (5/day), week 2 (10), week 3 (20), week 4 (40)

### 7. Communication Levels

- **One-to-One** (cold email, reply drafts): feels like one human wrote it for another
- **One-to-Many** (LinkedIn posts, carousels): one voice, many listeners, goal is resonance
- **Many-to-Many** (relationship coordination): multiple voices as symphony, invisible coordination, visible care

---

## The 59 MCP Tools

### Top-of-Funnel — 34 Tools

**2 Shared Tools:**

| Tool | What It Does |
|---|---|
| `generate_signal_package` | 4-step signal generation: internal data → external research → relevance judgment → "Why Now" synthesis. Scores 1-10; below 6 = HOLD. |
| `glm_conscience_check` | Weekly ethical audit across Six Dimensions. Advisory only, non-blocking. Sent to Sagar + Caleb. |

**Cold Email — 4 Tools:**

| Tool | What It Does |
|---|---|
| `cold_email_build_list` | Research + score prospects by signal strength via Clay/Exa/Structify |
| `cold_email_personalize` | Generate persona-specific draft with strict word limits and blacklist enforcement |
| `cold_email_create_sequence` | 4-step sequence (Day 0→3→7→14) with reply branching logic |
| `cold_email_book_meeting` | Route positive reply through Kevin → Mike → Maggie triage chain |

**Warm Email — 4 Tools:**

| Tool | What It Does |
|---|---|
| `warm_email_build_list` | Scan for LinkedIn engagement, website visitors, GTME job postings |
| `warm_email_personalize` | Respond to trigger event, reference what they did |
| `warm_email_create_sequence` | Faster cadence (Day 0→2→5→10), priority booking |
| `warm_email_book_meeting` | Warm leads get immediate meeting routing |

**LinkedIn Posting — 4 Tools:**

| Tool | What It Does |
|---|---|
| `linkedin_posting_build_list` | Signal harvest from pipeline, engagement data, healthcare news |
| `linkedin_posting_personalize` | Content brief or carousel (6 variables: product, persona, channel, tone, content_type, timing) |
| `linkedin_posting_create_sequence` | 1-2 week content calendar with optimal spacing |
| `linkedin_posting_book_meeting` | Route high-intent LinkedIn engagement to meeting pipeline |

**5 Stub Channels** (linkedin-dm, instagram-dm, imessage-dm, instagram-posting, x-posting): 20 tools registered, return `not_yet_implemented` with channel-specific context.

**Internal Libraries** (NOT MCP tools — used by channel tools internally):

- `research.buildProspectList()` — Clay + Exa + Structify enrichment
- `personalization.buildPersonalizationPrompt()` — Channel-format specific content generation
- `sequencing.buildSequencePrompt()` — Multi-step sequence with branching
- `meetingBooking.buildMeetingBookingPrompt()` — Delegate to MOF meeting-router

### Middle-of-Funnel — 13 Tools

**Orchestration:**

| Tool | What It Does |
|---|---|
| `mof_orchestrator` | Routes requests to the right MOF agent (advisory only) |

**Reply & Meeting Processing:**

| Tool | What It Does |
|---|---|
| `mof_reply_router` | Classifies replies into 10 categories (interested, objection, budget_timing, unsubscribe, ooo, spam, etc.). Generates 3 response options (conservative / assertive / experimental). Routes positive to meetings, unsubscribe to immediate removal. |
| `mof_meeting_router` | Processes Fireflies/Calendar/ChatDump into structured deal intelligence. Extracts outcomes, objections, buying roles, timeline, competitors. Generates 5-7 bullet call debrief + 3-5 next actions. Flags Gwen for partnerships, Karthik for product questions. |

**Transcript Processing:**

| Tool | What It Does |
|---|---|
| `mof_fireflies_process` | Normalize Fireflies transcripts into standard call-log format, link to deal |
| `mof_gmail_process` | Extract deal intelligence from Gmail threads, recommend next touch |
| `mof_chat_dump` | Interpret messy raw notes → identify accounts/contacts → extract deal updates → ask clarifying questions |

**Deal Management (BigQuery deals table):**

| Tool | What It Does |
|---|---|
| `mof_deal_create` | New deal with validated pipeline/stage/owner/next_action. Publishes `deal_created` event to Pub/Sub. |
| `mof_deal_update` | Partial update (never overwrites fields not provided). Publishes `deal_updated` + `deal_stage_changed` events. |
| `mof_deal_search` | Find deals by company, contact, or email |

Deal Stages (universal across all 3 pipelines):
`researching → contacted → conversation_started → discovery_scheduled → discovery_complete → proposal_sent → negotiating → verbal_commit → contract_sent → closed_won / closed_lost`

Three Pipelines: partnerships (BD/referral), inbound (warm), outbound (cold)

**Visualization & Analytics:**

| Tool | What It Does |
|---|---|
| `mof_kanban_view` | Kanban board by stage. Filters by pipeline/rep/time window. Shows time-in-stage, overdue actions, stale deals. "Where the Heat Is": action_required, at_risk, hottest_deals. |
| `mof_pipeline_analytics` | Funnel conversion rates, time in stage, win rate, lost reasons. Bottleneck analysis. 3-5 actionable recommendations. |
| `mof_rep_analytics` | Per-rep metrics (deals touched, win rate, avg cycle time, stall stage). 3-5 specific coaching suggestions. |

**Playbook:**

| Tool | What It Does |
|---|---|
| `mof_playbook_query` | Look up ICP definitions, qualification (MEDDIC-adapted), email frameworks, objection handling (question-based, never aggressive), partnership frameworks |

### Bottom-of-Funnel — 3 Tools (FULLY IMPLEMENTED)

| Tool | What It Does |
|---|---|
| `bof_generate_proposal` | Generate buyer-persona-specific proposals and SOWs for qualified opportunities |
| `bof_track_pilot` | Track trial/pilot milestones, health scores, and success criteria |
| `bof_orchestrate_onboarding` | Generate 8-task onboarding checklist, route tasks, manage handoff |

### Customer Success — 3 Tools (FULLY IMPLEMENTED)

| Tool | What It Does |
|---|---|
| `cs_health_score` | Composite 0-100 account health score from usage, engagement, support, and NPS signals |
| `cs_generate_qbr` | Generate Quarterly Business Review with metrics, wins, risks, and recommendations |
| `cs_detect_upsell` | Identify expansion signals: usage growth, feature requests, team additions, contract timing |

### Analytics — 3 Tools (FULLY IMPLEMENTED)

| Tool | What It Does |
|---|---|
| `analytics_cross_funnel` | Full-funnel metrics across TOF→MOF→BOF→CS. Bottleneck identification and stage-over-stage conversion. |
| `analytics_enrich_data` | Batch contact enrichment via Clay + Exa. Cost-limited ($5/batch), throttled (Clay: 10/min, Exa: 100/day). |
| `analytics_run_pipeline` | Data validation, transformation, and pipeline execution for BMA internal + healthcare GTM data. |

### BigQuery Natural Language — 2 Tools

| Tool | What It Does |
|---|---|
| `query_contacts` | Natural language → BigQuery SQL → results. "Find all engineers at Google", "Show contacts added this week". Searches: linkedinUrl, fullName, firstName, lastName, workEmail, phone, currentTitle, currentCompany, companyDomain, createdAt. |
| `query_deals` | Same interface, different table. Only available if `BIGQUERY_DEALS_TABLE` env var is set. |

Infrastructure: `SqlGenerator` converts NL → SQL via Claude Sonnet 4. `BigQueryClient` executes read-only SELECT queries (blocks INSERT/UPDATE/DELETE/DROP/ALTER/CREATE). All queries parameterized with `client_id` for tenant isolation.

---

## Production Infrastructure (NEW)

### ToolProvider Abstraction Layer

Every external API is wrapped in a `ToolProvider` that provides:
- **Unified interface:** `execute<T>(operation, params)`, `healthCheck()`, `fallback<T>()`
- **Circuit breaker:** 5 failures in 60s → circuit opens for 5min → half-open probe
- **Retry with backoff:** 3 attempts, 1s → 2s → 4s delays, skips retry on 4xx
- **Health reporting:** Per-provider status exposed at `/health` endpoint

| Provider | Operations | Rate Limit |
|---|---|---|
| ExaProvider | search, findSimilar, getContents | 100 calls/day |
| ClayProvider | enrich_company, enrich_contact, find_companies | 10 calls/min |
| StructifyProvider | structure, apply_schema | — |
| GmailProvider | send, draft, schedule | OAuth token refresh |
| CalendarProvider | events, freebusy | OAuth token refresh |

### Direct-Mode REST API

JWT-protected REST routes that bypass Claude for core CRUD. Works even if Anthropic API is down.

| Method | Endpoint | What It Does |
|---|---|---|
| `GET` | `/api/deals` | List/search deals (query params: `q`, `pipeline`, `owner`) |
| `POST` | `/api/deals` | Create a deal (validates pipeline, stage, required fields) |
| `PATCH` | `/api/deals/:id` | Update a deal (partial update, publishes `deal_updated` event) |
| `GET` | `/api/contacts/search` | Search contacts in BigQuery |
| `GET` | `/api/pipeline/kanban` | Kanban board view grouped by stage |

### Cloud Pub/Sub Event System

Every mutation publishes a typed event to the `togari-events` topic. Fire-and-forget — never blocks tool execution.

| Event Type | Published By | Payload |
|---|---|---|
| `deal_created` | mof_deal_create, POST /api/deals | deal_id, deal_name, company, pipeline, stage, owner, value |
| `deal_updated` | mof_deal_update, PATCH /api/deals/:id | deal_id, fields_updated, changes |
| `deal_stage_changed` | mof_deal_update | deal_id, deal_name, previous_stage, new_stage, owner |
| `contact_enriched` | analytics_enrich_data | contact_id, company_domain, source_apis, status, cost_usd |
| `sequence_sent` | TOF channel tools | channel, recipient_id, sequence_step, total_steps |
| `pilot_updated` | bof_track_pilot | deal_id, pilot_stage, metrics, health_score |

### Sentry Error Tracking

- `initSentry()` at server startup (no-op if `SENTRY_DSN` not set)
- `captureException()` on unhandled rejections and uncaught exceptions
- `wrapToolHandler()` — MCP tool error boundary returning structured JSON errors
- `flushSentry()` on SIGTERM for graceful shutdown
- Soft dependency: `@sentry/node` loaded via dynamic `require()` — server works without it

### Structured Error Responses

No stack traces to Claude. Every tool error returns:

```json
{
  "error": true,
  "tool": "mof_deal_create",
  "message": "Deal not found: abc-123",
  "retry_possible": false,
  "provider": "bigquery",
  "status_code": 404
}
```

### GCP Cloud Monitoring (`infra/monitoring-setup.sh`)

One-time setup script creates:
- **Pub/Sub:** `togari-events` topic + `togari-events-dlq` dead-letter topic + debug subscription
- **Dashboard:** 6 widgets — request volume, error rate (5xx %), latency p50/p95/p99, instance count, Pub/Sub event volume, unacked messages
- **Alerts:** Error rate > 5% (5min window), latency p99 > 10s (5min window)
- **Notification:** Email alerts to configured address

```bash
GCP_PROJECT=midyear-glazing-485303-u3 ./infra/monitoring-setup.sh
```

---

## Security & Auth

| Layer | What It Does |
|---|---|
| JWT Validation | Auth0 RS256 validation via `requireJwt` middleware. JWKS auto-rotation. |
| Tenant Isolation | `client_id` from JWT stored in AsyncLocalStorage, injected into every BigQuery query as named parameter |
| Rate Limiting | Token bucket per `client_id` — 100 req/min default (Redis-ready interface) |
| Audit Logging | Every tool invocation logged to BigQuery: client_id, user_id, tool_name, duration_ms, success, cost_usd |
| SQL Sanitization | NL→SQL queries validated (SELECT-only), client_id always parameterized |
| Circuit Breakers | External API failures auto-demote to fallback/degraded mode |
| Structured Errors | No stack traces to Claude — JSON errors with `retry_possible` hint |

---

## Governance Test Suite (NEW)

`src/tests/governance.test.ts` — 131 assertions across 8 test suites:

| Suite | Tests | What's Verified |
|---|---|---|
| Channel Theology | 41 | `validateTheologyLine()` across all 5 frames and 15 channels |
| Email Blacklist | 14 | All 11 banned phrases caught, clean email passes |
| Volume Rules | 17 | 40/inbox/day, 200/domain/day, Tue-Thu, 8-11am, 4-week warmup |
| CAN-SPAM | 7 | Unsubscribe + physical address in footers |
| HIPAA | 10 | PHI detection (patient data, diagnosis, SSN, lab results) |
| Ethical Floor | 12 | No hatred, exploitation, fear-based copy, dehumanizing language |
| Six Dimensions | 11 | All 6 present, financial last, gap detection |
| Cross-system | 7 | Fear-based copy caught globally, config consistency |

```bash
npx tsx src/tests/governance.test.ts
```

---

## Email Blacklist (Hard Enforced)

These phrases are banned from all generated emails:

- "I hope this email finds you well"
- "synergy" / "synergies"
- "leverage"
- "ecosystem" (without specifics)
- "exciting" (describing own work)
- "We work with companies like yours"
- "I wanted to reach out"
- "Just following up"
- "Quick question"
- "Do you have 15 minutes"
- "I'd love to pick your brain"

---

## Schemas & Enums

All validated at runtime with Zod:

- **BuyerPersona:** A | B | C
- **Channel:** 15 channels (bma_linkedin, gartiwar, rytual, caleb_personal, kevin_linkedin, sagar_linkedin, cold_email, warm_email, linkedin_outbound, linkedin_dm, instagram_dm, imessage_dm, linkedin_posting, instagram_posting, x_posting)
- **TheologyFrame:** vedic_systems, jesus_service, nature_reverent, enterprise_credible, peer_warm
- **ContentType:** short_form_post, long_form_post, carousel, short_form_video, long_form_essay, podcast, data_visualization, case_study
- **PipelineType:** partnerships, inbound, outbound
- **PipelineStage:** 10 stages from researching → closed_won/closed_lost
- **ReplyClassification:** positive_interest, objection, wrong_person, not_now, unsubscribe
- **TeamMember:** 8 members
- **Product:** togari, bma_services, rytual_retreat, gartiwar_guide

---

## Environment Variables

```
Required:
  GCP_PROJECT_ID, BIGQUERY_DATASET, BIGQUERY_TABLE, ANTHROPIC_API_KEY
  GOOGLE_APPLICATION_CREDENTIALS or GCP_CREDENTIALS_BASE64

Optional:
  BIGQUERY_DEALS_TABLE          (enables query_deals tool)
  TOGARI_INTERNAL_KEYS, TOGARI_EXTERNAL_KEYS
  PORT                          (enables HTTP/SSE mode)
  SENTRY_DSN                    (enables Sentry error tracking)
  SENTRY_TRACES_SAMPLE_RATE     (default: 0.1)
  PUBSUB_TOPIC                  (default: togari-events)
  ALERT_EMAIL                   (for GCP monitoring alerts)
```

---

## Dependencies

**Production:**
- `@anthropic-ai/sdk` — Claude API for NL→SQL, content generation
- `@google-cloud/bigquery` — Data warehousing
- `@google-cloud/pubsub` — Event streaming (NEW)
- `@google-cloud/secret-manager` — Credential management
- `@modelcontextprotocol/sdk` — MCP server implementation
- `@sentry/node` — Error tracking (NEW)
- `express` — HTTP server for Cloud Run
- `jsonwebtoken` + `jwks-rsa` — JWT validation
- `zod` — Runtime schema validation

---

## Key Design Decisions

1. **Prompt Delegation Model** — TOF agents don't execute actions directly; they return prompts for Claude to execute
2. **BigQuery as Single Source of Truth** — All deals in BigQuery with parameterized queries and tenant isolation via `client_id`
3. **Three Pipelines, One Deal Model** — Partnerships / Inbound / Outbound unified under one schema
4. **Theology Line Enforcement** — Every channel's content checked against its theology frame before output
5. **Volume & Compliance as Config, Not Advisory** — Send limits, send windows, warmup cycles are hard rules in code
6. **Many-to-Many Coordination** — Multiple team members can touch one deal; Kevin is default closer
7. **ToolProvider Abstraction** — External APIs decoupled from tool logic via provider interface + circuit breaker + retry (NEW)
8. **Fire-and-Forget Events** — Every mutation publishes to Pub/Sub asynchronously, never blocks (NEW)
9. **Direct-Mode REST API** — Core CRUD works even if Anthropic API is down (NEW)
10. **Structured Errors, Not Stack Traces** — Claude gets JSON it can reason about, not raw exceptions (NEW)
11. **Soft Dependencies** — Sentry and Pub/Sub are optional; server runs fine without them (NEW)

---

## How to Run

```bash
npm run dev          # tsx watch mode (stdio transport)
npm run build        # ESBuild → dist/index.cjs
npm start            # node dist/index.cjs
npm run typecheck    # tsc --noEmit
npx tsx src/tests/governance.test.ts   # Run governance verification suite
```

Deploy to Cloud Run / Railway with `PORT` set, or add to Claude Desktop's MCP config pointing at the built `.cjs` file for stdio mode.

---

## Implementation Status

| Stage | Tools | Status |
|---|---|---|
| TOF | 34 | 3 real channels + 5 stub channels + 2 shared tools |
| MOF | 13 | Fully implemented |
| BOF | 3 | **Fully implemented** (was stubbed) |
| CS | 3 | **Fully implemented** (was stubbed) |
| Analytics | 3 | **Fully implemented** (was stubbed) |
| BigQuery | 2 | Fully implemented |
| Opportunity Engine V2 | 8 | **Signal Subscriptions (5) + Data Pulls (3)** (NEW) |
| Direct REST API | — | 8 endpoints (was 5) (UPDATED) |
| **Total** | **67** | **55 implemented, 20 stub tools (5 stub channels), 8 REST endpoints** |

### What's New Since v1

| Addition | Description |
|---|---|
| ToolProvider abstraction | 5 providers (Exa, Clay, Structify, Gmail, Calendar) with unified interface |
| Circuit breaker | Per-provider fault tolerance: 5 failures/60s → 5min open |
| Retry with backoff | 3 attempts, exponential 1s→2s→4s, skip 4xx |
| Structured errors | JSON error responses to Claude with `retry_possible` hint |
| Direct REST API | 5 JWT-protected endpoints bypassing Claude for CRUD |
| Pub/Sub events | 6 typed events published on every mutation |
| Sentry integration | Error tracking + MCP tool error boundaries |
| GCP monitoring | Dashboard + alert policies via setup script |
| JWT auth middleware | Auth0 RS256 + AsyncLocalStorage tenant context |
| Rate limiting | Token bucket per tenant (100 req/min) |
| BOF implementation | Proposal generator, pilot tracker, onboarding orchestrator |
| CS implementation | Health score, QBR generator, upsell detector |
| Analytics implementation | Cross-funnel, data enrichment, data pipeline |
| Governance test suite | 131 assertions across 8 test suites |
| **Opportunity Engine V2** | **Refactored into 2 products: Signal Subscriptions + One-Time Data Pulls** |

---

## Opportunity Engine V2

*Last updated: April 10, 2026*

The original Opportunity Notification Engine has been refactored into two distinct products:

### Product 1: Signal Subscriptions (Continuous Monitoring)

Clients describe what they want to monitor in natural language (e.g. "VP of Sales at Series B healthtech companies in NYC"). The system runs on a schedule (daily/weekly/biweekly), discovers matching contacts, deduplicates against the existing datalake, enriches net-new contacts, and sends notifications.

**MCP Tools (5):**
| Tool | Description |
|---|---|
| `signal_create_subscription` | Create subscription with NL signal query or legacy structured filters |
| `signal_list_subscriptions` | List subscriptions, filter by status/email |
| `signal_update_subscription` | Update signal query, frequency, criteria, channels, or status |
| `signal_trigger_scan` | Manual trigger for testing (auto-detects V2 vs legacy mode) |
| `signal_get_results` | Query signal_results + notification_history tables |

**Pipeline (enrichment-pipeline.ts → `runSignalQuery()`):**
1. Parse `signal_query` → structured params via Claude (job titles, industries, locations, companies, keywords, seniority)
2. Exa search with structured params (max 50 calls/cron run)
3. Extract contacts from Exa results
4. Dedup against `togari_structured_contacts` by email
5. Clay enrichment for net-new contacts (10/min rate limit)
6. Store new contacts in `togari_structured_contacts`
7. Write `SignalResult` to `signal_results` BigQuery table
8. Return `SignalResult` with `matched_contacts` and `new_since_last_run`

**Cron (daily-notifications.ts):**
- Queries all active subscriptions
- Checks `monitor_frequency` + `last_run_at` to determine which are due
- Routes V2 (has `signal_query`) → `runSignalQuery()` → notification
- Routes legacy (no `signal_query`) → `runEnrichmentForSubscriber()` → outreach draft → notification
- Updates `last_run_at` and `total_matches_found`

**Stripe:** 4 metered subscription products:
| Plan | Companies | Price |
|---|---|---|
| Signal Monitor 50 (Starter) | 50 | $40/mo |
| Signal Monitor 100 (Standard) | 100 | $60/mo |
| Signal Monitor 200 (Professional) | 200 | $80/mo |
| Signal Monitor 500 (Enterprise) | 500 | $150/mo |

Metered billing via `usage_record` per notification batch. Products created idempotently via Stripe Products API. Webhook routing by `metadata.product_type: 'signal'`.

### Product 2: One-Time Data Pulls (Ad Hoc)

Clients request a contact list via natural language query and a desired count. The system queries the datalake, enriches any shortfall, generates a CSV, uploads to GCS, and emails a download link.

**MCP Tools (3):**
| Tool | Description |
|---|---|
| `create_data_pull` | Request contact list export with NL query + count + client_id |
| `get_data_pull_status` | Check pull status (pending/processing/ready/delivered) |
| `list_data_pulls` | List all pulls for a client |

**REST Endpoints (3 new):**
| Method | Path | Description |
|---|---|---|
| POST | `/webhooks/data-pull` | Framer form webhook → create pull + Stripe checkout |
| POST | `/api/data-pulls` | JWT-protected create (direct API) |
| GET | `/api/data-pulls/:pull_id` | Get pull status |
| GET | `/api/data-pulls` | List pulls for authenticated tenant |

**Pipeline (data-pull-pipeline.ts → `processDataPull()`):**
1. Claude translates `natural_language_query` → BigQuery SQL
2. Query `togari_structured_contacts` with generated SQL
3. If datalake has enough → skip to step 6
4. If shortfall: Exa discovery for companies/people matching the NL query
5. Clay enrichment for each discovered contact → store in BigQuery
6. Compile final contact list (datalake + newly enriched)
7. Generate CSV (columns: name, email, title, company, linkedin, phone, city, industry, company_size, source)
8. Upload CSV to GCS (`tenants/{client_id}/data-pulls/{pull_id}.csv`)
9. Update `DataPullRequest` status → `ready`, set `csv_url`
10. Send email notification with download link

**Stripe:** One-time `payment` mode checkout session with tiered pricing:
| Tier | Range | Price |
|---|---|---|
| Tier 1 | First 250 contacts | $0.50/contact |
| Tier 2 | 251–1,000 contacts | $0.30/contact |
| Tier 3 | 1,001+ contacts | $0.20/contact |

Example: 500 contacts = (250 × $0.50) + (250 × $0.30) = $200. Checkout created via `/webhooks/data-pull` or MCP tool. `payment_intent.payment_failed` webhook updates status and notifies user. Webhook routing by `metadata.product_type: 'data_pull'`.

### BigQuery Tables (V2)

| Table | Description |
|---|---|
| `opportunity_subscriptions` | Original table + 5 new columns (signal_query, monitor_frequency, companies_limit, last_run_at, total_matches_found) |
| `signal_subscriptions` | VIEW aliasing opportunity_subscriptions (new name) |
| `signal_results` | Per-run results: matched_contacts (JSON), exa_results (JSON), new_since_last_run |
| `data_pull_requests` | One-time pull requests: NL query, status, costs, CSV URL |
| `notification_history` | Existing delivery records (unchanged) |

Migration: `sql/migrations/004_opportunity_engine_v2.sql`

### Type System

All types in `src/agents/opportunity-notifications/types.ts`:
- `Subscription` — extended with signal_query, monitor_frequency, companies_limit, last_run_at, total_matches_found
- `ContactMatch`, `ExaResult`, `SignalResult` — signal subscription output types
- `StructuredContact`, `DataPullRequest`, `DataPullResult` — data pull types
- `MonitorFrequency`, `DataPullStatus`, `ContactSource` — new enums
- Zod schemas for all new types (also re-exported from `src/schemas/opportunity-engine.ts`)

### How to Test

**Signal Subscriptions:**
```bash
# 1. Create a signal subscription via MCP
# In Claude Desktop, call: signal_create_subscription
#   signal_query: "hiring engineers at digital health startups in San Francisco"
#   subscriber_email: "test@example.com"
#   plan: "starter"
#   monitor_frequency: "daily"
#   notification_channels: ["email"]

# 2. Trigger a manual scan
# Call: signal_trigger_scan
#   subscription_id: "<id from step 1>"
#   dry_run: true

# 3. Check results
# Call: signal_get_results
#   subscription_id: "<id from step 1>"

# 4. Test cron (local)
npx tsx src/cron/daily-notifications.ts
```

**One-Time Data Pulls:**
```bash
# 1. Via MCP tool
# Call: create_data_pull
#   query: "50 VP of Sales at Series B healthcare companies"
#   count: 50
#   client_id: "test@example.com"
#   skip_payment: true

# 2. Via REST API (requires JWT)
curl -X POST http://localhost:3000/api/data-pulls \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"query":"VP Sales at healthtech","count":50,"skip_payment":true}'

# 3. Via Framer webhook (creates Stripe checkout)
curl -X POST http://localhost:3000/webhooks/data-pull \
  -H "x-framer-secret: $FRAMER_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email":"client@example.com","query":"DevOps engineers at fintech","count":100}'

# 4. Check status
curl http://localhost:3000/api/data-pulls/<pull_id> \
  -H "Authorization: Bearer $JWT"
```

**Environment Variables Required:**
- `ANTHROPIC_API_KEY` — Claude for NL parsing
- `EXA_API_KEY` — Exa web search
- `CLAY_API_KEY` — Clay contact enrichment
- `STRIPE_SECRET_KEY` — Checkout sessions + webhooks
- `GCP_CREDENTIALS_BASE64` — BigQuery + GCS access
- `GCS_DATA_PULL_BUCKET` — GCS bucket for CSV uploads (default: `togari-data-pulls`)
- `GMAIL_ACCESS_TOKEN` / `GMAIL_REFRESH_TOKEN` — Email notifications

### Stripe Webhook Events Handled

| Event | Product Type | Action |
|---|---|---|
| `checkout.session.completed` | signal | Activate subscription, link Stripe IDs |
| `checkout.session.completed` | data_pull | Trigger async `processDataPull()` |
| `customer.subscription.created` | signal | Sync BigQuery subscription with Stripe |
| `customer.subscription.updated` | signal | Update `payment_status` (active/past_due) |
| `customer.subscription.deleted` | signal | Cancel subscription + set status canceled |
| `invoice.payment_failed` | signal | Set `past_due`, email subscriber |
| `payment_intent.payment_failed` | data_pull | Reset pull status, email user |

All events write to `audit_log` with `product_type`, `amount_cents`, and `entity_id` for cost tracking.

---

## Comparative Rundown: The Two Togari Repos

### togari-healthcare (Amber)

**Objective:** The data backbone — ingest, clean, enrich, score, and manage healthcare leads and companies.

**What it does (13 tools):**
- Ingests messy data from CSV/XLSX/JSON files, auto-maps columns, validates, and AI-normalizes via Claude
- Enriches contacts and companies from Exa (web search) and Clay (LinkedIn/firmographic data)
- Scores leads on a 0-100 composite scale using channel source, company size, title authority, tech stack maturity, vertical fit, engagement recency, and timing signals — then routes to high_touch / standard / nurture / disqualify tiers
- CRUD on contact records via Structify, with full lifecycle status tracking
- Healthcare-specific: EHR systems, practice types, medical specialties, 6 healthcare verticals

### togari-gtm

**Objective:** The sales operations brain — orchestrate outbound/inbound prospecting, deal management, pipeline analytics, and team coordination with ethical guardrails.

**What it does (59 tools + 5 REST endpoints):**
- **TOF (34 tools):** Signal packages, prospect lists, persona-specific emails with word limits and blacklist, multi-step sequences with reply branching, LinkedIn content calendars, triage chain routing
- **MOF (13 tools):** Reply classification (10 categories, 3 response options), transcript/email/chat processing into deal intelligence, BigQuery deal CRUD with Pub/Sub events, Kanban views, pipeline and per-rep analytics with coaching
- **BOF (3 tools):** Proposals, pilot tracking, onboarding orchestration
- **CS (3 tools):** Account health scores, QBRs, upsell detection
- **Analytics (3 tools):** Cross-funnel metrics, batch enrichment, data pipeline
- **BigQuery (2 tools):** Natural language queries against contacts and deals
- **REST API (5 endpoints):** Direct CRUD bypassing Claude
- **Governance:** Theology enforcement, Six Dimensions, CAN-SPAM/HIPAA, volume/timing limits, ethical floor

### How They Relate

```
togari-healthcare (Amber)          togari-gtm
━━━━━━━━━━━━━━━━━━━━━━━━          ━━━━━━━━━━━━
Data ingestion & cleaning    →    Prospect list building
Contact/company enrichment   →    Signal package generation
Lead scoring & routing       →    Sequence creation & meeting booking
CRUD on contact records      →    Deal management & pipeline tracking
File processing pipeline     →    Analytics & coaching
                                  Theology & ethical governance
                                  Production resilience (circuit breakers, retry)
                                  Event streaming (Pub/Sub)
                                  Error tracking (Sentry)
                                  Direct REST API
```

Healthcare is the data foundation that feeds GTM with enriched, scored leads. GTM is the operational engine that acts on that data across the full sales funnel — with production-grade resilience, event streaming, and governance enforcement.
