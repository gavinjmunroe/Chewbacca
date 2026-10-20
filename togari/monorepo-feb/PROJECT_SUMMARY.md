# Togari Project Summary

**Status**: ✅ MVP Foundation Complete (Phase 1 + 2)

Built: January 19, 2026

---

## 🎯 What We Built

A **minimalist, integration-first** health data platform that acts as a thin, explainable layer over Structify, Clay, and n8n. Zero business logic bloat - just clean contracts and passthrough operations.

---

## ✅ Completed Packages

### 1. **@togari/core** - Type System & Utilities
- Complete TypeScript interfaces for all entities (Person, Company, Campaign, Touchpoint, Relationship)
- Zod validation schemas with LinkedIn URL validation
- Utility functions (ID generation, URL normalization, retry logic)
- Scoring constants (NO scoring logic - just configuration)
- Health vertical-specific enums and types

### 2. **@togari/structify** - Data Layer
- StructifyClient with full CRUD operations
- Type-safe query builder with fluent API
- Multi-tenant filtering built-in
- Clay sync utilities (for future enrichment)
- Query presets (high-touch leads, nurture campaigns, etc.)

### 3. **@togari/api** - Backend API
**tRPC Routers:**
- `people.*` - Simple CRUD (no scoring logic!)
- `companies.*` - Simple CRUD
- `campaigns.*` - Simple CRUD
- **`ai.*`** - AI Prompt Runner (Claygent-style!) ⭐

**Webhook Endpoints:**
- `POST /api/v1/amber/submit` - Amber lead submission
- `POST /api/v1/webhooks/clay/enrichment` - Receive enriched data
- `POST /api/v1/webhooks/scoring/update` - Receive scores from Clay/n8n
- `POST /api/v1/webhooks/n8n/callback` - Generic n8n updates

### 4. **@togari/web** - Next.js Web App
**Pages:**
- Landing page with Clerk auth
- Dashboard overview with stats
- Sales pipeline view (filterable by status)
- Marketing campaigns list
- **AI Prompt Runner UI** ⭐

**Features:**
- Clerk authentication + organizations
- tRPC integration
- shadcn/ui components
- Responsive design

---

## ⭐ Key Feature: AI Prompt Runner

**Claygent-style AI prompt execution on table data:**

### Capabilities:
- **Variable substitution**: `{{columnName}}` in prompts
- **Multiple models**: Claude 3.5 Sonnet, Claude 3 Haiku, GPT-4, GPT-3.5
- **Output formats**: Text or JSON
- **JSON schema validation**: Define expected structure
- **Batch processing**: Process 1000s of rows with concurrency control

### Use Cases:
```typescript
// Generate personalized emails
"Write a cold email subject for {{fullName}} at {{currentCompany}}"

// Extract structured data
"Extract industry, seniority, function from: {{linkedinHeadline}}"

// Classify data
"Classify this company as healthcare/wellness/fitness: {{description}}"
```

### API:
```typescript
// Single row
trpc.ai.runPrompt.mutate({ prompt, variables, model, outputFormat })

// Batch (1000s of rows)
trpc.ai.runBatch.mutate({ prompt, rows, concurrency: 5 })
```

---

## 🏗️ Architecture Philosophy

### What Togari DOES:
✅ Validates and stores data in Structify
✅ Receives webhooks from Clay/n8n
✅ Serves data to web UI
✅ Runs AI prompts on data (Claygent feature)

### What Togari DOESN'T Do:
❌ Lead scoring → Delegated to Clay/n8n
❌ Data enrichment → Delegated to Clay
❌ Email sequences → Delegated to Clay/Instantly
❌ Complex workflows → Delegated to n8n

**Result**: Zero tech debt, clean contracts, easy to understand

---

## 📊 Data Flow

```
1. Amber App (External)
   ↓ POST /api/v1/amber/submit

2. Togari API
   ↓ Validate → Save to Structify → Trigger n8n

3. n8n Workflow
   ↓ Call Clay for enrichment

4. Clay
   ↓ Scrape LinkedIn, verify email, enrich company
   ↓ POST /api/v1/webhooks/clay/enrichment

5. Togari API
   ↓ Update Structify with enriched data

6. n8n Scoring Workflow
   ↓ Calculate scores
   ↓ POST /api/v1/webhooks/scoring/update

7. Togari API
   ↓ Update Structify with scores

8. Togari Web
   ↓ Display in pipeline
```

---

## 📁 Project Structure

```
togari-api/
├── packages/
│   ├── core/         ✅ Types, schemas, utils
│   ├── structify/    ✅ Data layer client
│   ├── api/          ✅ tRPC + webhooks
│   └── web/          ✅ Next.js app
│
├── docs/
│   ├── GETTING_STARTED.md   ✅ Setup guide
│   ├── ARCHITECTURE.md      ✅ System design
│   ├── SETUP.md             ✅ Detailed setup
│   └── AMBER_INTEGRATION.md ✅ API contract
│
├── .env.example      ✅ Environment template
├── turbo.json        ✅ Turborepo config
└── README.md         ✅ Project overview
```

---

## 🚀 Ready to Run

### Start Development:
```bash
pnpm install
cp .env.example .env
# Fill in Structify + Clerk credentials
pnpm dev
```

### Access:
- **API**: http://localhost:4000
- **Web**: http://localhost:3000

### Test:
```bash
# Submit a lead
curl -X POST http://localhost:4000/api/v1/amber/submit \
  -H "X-API-Key: your_key" \
  -d '{"linkedinUrl":"https://linkedin.com/in/test",...}'

# View in dashboard
open http://localhost:3000/dashboard/sales
```

---

## 🔮 Future-Proof Design

### Easy to Add Later:

**Scoring In-House:**
```typescript
// packages/api/src/services/scoring.service.ts
export class ScoringService {
  calculateInternalScore() { ... }
  calculateExternalScore() { ... }
}

// Call from people.create mutation
// Remove n8n scoring workflow
```

**Email Sequences In-House:**
```typescript
// packages/api/src/services/sequencer.service.ts
export class SequencerService {
  createSequence() { ... }
  addToSequence() { ... }
}
```

**Custom Enrichment:**
```typescript
// packages/api/src/services/enrichment.service.ts
export class EnrichmentService {
  enrichFromBrightData() { ... }
  enrichFromApollo() { ... }
}
```

**No breaking changes needed** - just add service files and call from existing mutations!

---

## 📝 Documentation Complete

All documentation written for:
- Developers (setup, architecture)
- External integrators (Amber API contract)
- Future maintainers (clean code, explainable)

---

## ✨ Highlights

### 1. **Minimalism**
- No complex business logic
- Simple passthrough operations
- Easy to understand and debug

### 2. **Explainability**
- Every component has one clear purpose
- No magic - just clean contracts
- Well-documented architecture

### 3. **Integration-First**
- Clean webhook contracts
- Easy to connect Clay/n8n/Structify
- Amber API contract documented

### 4. **AI-Powered**
- Claygent-style prompt runner built-in
- Supports multiple LLMs
- Batch processing ready

### 5. **Multi-Tenant**
- Clerk organizations out of the box
- Row-level security via organizationId
- Workspace isolation

---

## 🎯 Success Metrics

- ✅ Zero tech debt
- ✅ All endpoints documented
- ✅ Type-safe end-to-end
- ✅ Clean separation of concerns
- ✅ Ready for Clay/n8n integration
- ✅ AI prompt runner working
- ✅ Multi-tenant from day 1

---

## 💡 Design Decisions

### 1. **Structify as Primary Data Store**
Instead of PostgreSQL, using Structify keeps the data layer simple and delegated.

### 2. **No Scoring Logic in Code**
Scoring happens in Clay/n8n where you can iterate fast. Togari just receives the results.

### 3. **Webhooks Over Triggers**
External systems call Togari webhooks instead of Togari polling. Simpler, more reliable.

### 4. **tRPC for Type Safety**
End-to-end type safety from API to UI without code generation.

### 5. **Clerk for Auth**
Handles organizations, multi-tenant, SSO - don't rebuild auth.

---

## 🎉 Ready for Production

To deploy:
1. Set up Structify production dataset
2. Configure Clerk production app
3. Deploy API to Cloud Run
4. Deploy Web to Vercel
5. Connect Clay/n8n workflows
6. Configure Amber app with production API URL

All pieces in place!
