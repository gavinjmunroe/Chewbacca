# Togari Architecture

## Design Philosophy

Togari follows a **minimalist, integration-first** architecture:

1. **Don't Reinvent the Wheel**: Use Clay for enrichment, n8n for workflows, Structify for data
2. **Clean Contracts**: Well-defined APIs for external systems to integrate
3. **Zero Tech Debt**: Simple passthrough logic, no complex business rules in code
4. **Explainable**: Every component has a single, clear purpose

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        AMBER (External)                     │
│                    Mobile Lead Capture                      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ POST /api/v1/amber/submit
┌─────────────────────────────────────────────────────────────┐
│                      TOGARI API                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Amber Webhook: Validate → Save to Structify          │  │
│  └───────────────────────────────────────────────────────┘  │
│                            │                                 │
│                            ▼ Trigger n8n                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Webhook Receivers: Clay enrichment, Scoring updates  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │                                    ▲
         ▼ Save person                        │ Webhook callback
┌──────────────────┐              ┌─────────────────────────┐
│   STRUCTIFY      │              │   CLAY + n8n            │
│   Data Store     │──────────────▶   Enrichment Engine    │
└──────────────────┘   Trigger    └─────────────────────────┘
                      enrichment
         │
         ▼ Read data
┌─────────────────────────────────────────────────────────────┐
│                      TOGARI WEB                             │
│  ┌──────────────┬──────────────┬─────────────────────────┐ │
│  │  Pipeline    │  Campaigns   │  AI Prompt Runner       │ │
│  │  View        │  List        │  (Claygent-style)       │ │
│  └──────────────┴──────────────┴─────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### Togari API (This Codebase)

**What it DOES:**
- ✅ Authenticate users via Clerk
- ✅ CRUD operations on Structify (simple passthrough)
- ✅ Receive leads from Amber
- ✅ Receive enriched data from Clay/n8n webhooks
- ✅ Run AI prompts on table data (Claygent feature)
- ✅ Serve data to web UI

**What it DOESN'T do:**
- ❌ Lead scoring (done in Clay/n8n)
- ❌ Email sequencing (done in Clay/Instantly)
- ❌ Data enrichment (done in Clay)
- ❌ Complex workflows (done in n8n)

### Clay

**Responsibilities:**
- LinkedIn profile scraping
- Company data enrichment
- Email verification
- Waterfall enrichment logic
- Initial scoring calculations
- Push to Structify via webhook

### n8n

**Responsibilities:**
- Orchestrate multi-step workflows
- Trigger Clay enrichment
- Calculate composite scores
- Route leads to campaigns
- Trigger email sequences
- Update Structify via webhook

### Structify

**Responsibilities:**
- Primary data store for all entities
- Query interface for web UI
- Multi-tenant data isolation
- Audit trail

## Data Flow: Amber → Togari → Clay → Structify

### 1. Lead Submission (Amber → Togari)

```
POST /api/v1/amber/submit
{
  "linkedinUrl": "https://linkedin.com/in/johndoe",
  "submittedName": "John Doe",
  "sourceChannel": "warm_referral",
  "organizationId": "org_123",
  "submittedBy": "user@example.com"
}
```

**Togari API does:**
1. Validate API key
2. Validate payload
3. Check for duplicate in Structify by LinkedIn URL
4. Create person in Structify (with defaults: score=0, tier=nurture)
5. Trigger n8n workflow: `lead-enrichment`
6. Return success to Amber

### 2. Enrichment (n8n → Clay → Togari)

**n8n workflow:**
1. Receives trigger from Togari
2. Calls Clay API to enrich person
3. Clay scrapes LinkedIn, verifies email, enriches company
4. Clay calls Togari webhook: `POST /api/v1/webhooks/clay/enrichment`

**Togari webhook does:**
1. Validate payload
2. Update person in Structify with enriched data
3. Return success

### 3. Scoring (n8n → Togari)

**n8n workflow:**
1. After enrichment completes
2. Calculate internal score (channel, budget, authority, GTM maturity)
3. Calculate external score (vertical-specific logic)
4. Calculate composite score
5. Determine routing tier
6. Call Togari webhook: `POST /api/v1/webhooks/scoring/update`

**Togari webhook does:**
1. Validate payload
2. Update person in Structify with scores
3. Return success

### 4. Display (Togari Web)

**Web app:**
1. User navigates to Sales pipeline
2. tRPC call: `people.list({ status: 'new' })`
3. Togari API queries Structify
4. Returns enriched, scored leads
5. UI displays in Kanban board

## API Endpoints

### tRPC Routes (Authenticated)

**People:**
- `people.list` - List people with filters
- `people.get` - Get single person
- `people.create` - Create person (triggers enrichment)
- `people.update` - Update person
- `people.delete` - Delete person
- `people.touchpoints` - Get person's touchpoints

**Companies:**
- `companies.list` - List companies
- `companies.get` - Get single company
- `companies.create` - Create company

**Campaigns:**
- `campaigns.list` - List campaigns
- `campaigns.get` - Get campaign
- `campaigns.create` - Create campaign

**AI:**
- `ai.runPrompt` - Run AI prompt with variable substitution
- `ai.runBatch` - Run AI prompt on multiple rows

### Webhook Endpoints (API Key Auth)

**Amber:**
- `POST /api/v1/amber/submit` - Submit lead from Amber

**Clay/n8n:**
- `POST /api/v1/webhooks/clay/enrichment` - Receive enriched data
- `POST /api/v1/webhooks/scoring/update` - Receive scores
- `POST /api/v1/webhooks/n8n/callback` - Generic n8n callback

## AI Prompt Runner (Claygent-style)

### Feature: Run AI Prompts on Table Data

**Use Cases:**
- Generate personalized email subject lines
- Classify leads by vertical
- Extract key information from text
- Generate summaries
- Parse unstructured data

**Example:**

```typescript
// Single row
await trpc.ai.runPrompt.mutate({
  prompt: "Write a personalized cold email subject line for {{fullName}} who works at {{currentCompany}} as {{currentTitle}}",
  variables: {
    fullName: "John Doe",
    currentCompany: "Acme Health",
    currentTitle: "Chief Medical Officer"
  },
  model: "claude-3-5-sonnet",
  outputFormat: "text",
  maxTokens: 100
});

// Response
{
  output: "John, transforming patient care at Acme Health",
  tokensUsed: 45,
  model: "claude-3-5-sonnet"
}
```

**JSON Output Example:**

```typescript
await trpc.ai.runPrompt.mutate({
  prompt: "Analyze this LinkedIn headline and extract: industry, seniority, function",
  variables: {
    headline: "Chief Medical Officer at Acme Health | Digital Health Innovator"
  },
  model: "claude-3-haiku",
  outputFormat: "json",
  jsonSchema: {
    industry: "string",
    seniority: "string",
    function: "string"
  }
});

// Response
{
  output: {
    industry: "Healthcare",
    seniority: "C-Level",
    function: "Medical Operations"
  }
}
```

**Batch Processing:**

```typescript
await trpc.ai.runBatch.mutate({
  prompt: "Generate a personalized icebreaker for {{fullName}}",
  rows: [
    { fullName: "John Doe", currentCompany: "Acme" },
    { fullName: "Jane Smith", currentCompany: "Beta" },
    // ... 100 more rows
  ],
  model: "claude-3-haiku",
  concurrency: 5, // Process 5 at a time
});
```

## Integration Points for Future Work

### When You Bring Scoring Logic In-House

**Current State:**
- Scoring done in Clay/n8n
- Togari receives scores via webhook

**Future State:**
- Create `packages/api/src/services/scoring.service.ts`
- Implement scoring functions
- Call from `people.create` mutation
- Remove n8n scoring workflow
- **No breaking changes** - same data model, just different calculation location

### When You Bring Email Sequencing In-House

**Current State:**
- Sequences managed in Clay/Instantly
- Togari doesn't track sequence state

**Future State:**
- Create `packages/api/src/services/sequencer.service.ts`
- Add sequence state to Structify schema
- Build sequence UI in web app
- **No breaking changes** - additive only

### When You Build Custom Enrichment

**Current State:**
- Clay does all enrichment
- Togari receives data via webhook

**Future State:**
- Create `packages/api/src/services/enrichment.service.ts`
- Call APIs directly (Bright Data, Apollo, etc.)
- Store results in Structify
- **No breaking changes** - same webhook contract

## Security Model

### Authentication

- **Web App**: Clerk session tokens (JWT)
- **Amber**: API key in `X-API-Key` header
- **Clay/n8n Webhooks**: Shared secret (optional) or IP whitelist

### Multi-Tenancy

- Every Structify query filtered by `organizationId`
- Clerk provides organization context
- Row-level security enforced

### API Rate Limits

- Per organization: 1000 req/hour
- Per user: 100 req/hour
- Burst: 10 req/sec

## Monitoring & Observability

**Key Metrics:**
- Amber submission success rate
- Clay enrichment completion time
- n8n workflow execution status
- Structify query latency
- AI prompt token usage

**Logging:**
- All webhook payloads logged
- All API errors logged
- AI prompt usage tracked

## Deployment

**API:**
- Google Cloud Run (auto-scaling)
- Environment variables via Secret Manager

**Web:**
- Vercel (edge deployment)

**Workers (Future):**
- Cloud Run Jobs for background processing

## Next Steps

Current foundation supports:
1. ✅ Amber lead capture
2. ✅ Clay enrichment integration
3. ✅ n8n workflow orchestration
4. ✅ Web UI for viewing leads
5. ✅ AI prompt runner for data processing

Easy to add later:
- In-house scoring engine
- In-house email sequences
- Custom enrichment sources
- Advanced analytics
- Real-time notifications
