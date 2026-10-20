# 🎯 Togari API-First Strategy

## Vision: Build the Clay-like Power Layer

You want to recreate Clay's power - letting end users build complex data enrichment workflows, API integrations, and AI-powered automation **from the frontend**.

**The Strategy:**
1. **Now**: Build a bulletproof API backend (Togari API)
2. **Next**: Build your dream frontend in Lovable (or any tool)
3. **Future**: Frontend consumes API, users build workflows visually

---

## 🏗️ What We're Building

### The API Layer (Focus Now):
```
Togari API = Data Engine + Workflow Orchestrator + Integration Hub
```

**Core Capabilities:**
1. **Data Management** - CRUD for all entities (people, companies, campaigns)
2. **Enrichment Engine** - Trigger Clay/Apollo/Clearbit/custom enrichments
3. **Workflow Builder Backend** - Execute multi-step automation
4. **AI Prompt Runner** - Run LLM prompts with variable substitution
5. **Webhook Hub** - Receive data from external services
6. **Integration Manager** - Connect to any API (Clay-style)

### The Frontend (Build Later in Lovable):
```
Lovable Frontend = Visual Workflow Builder + No-Code Interface
```

**User Experience:**
- Drag-and-drop workflow builder (like Clay tables)
- Visual API connector (like Make/Zapier)
- AI prompt interface with variable mapping
- Real-time data enrichment
- Campaign orchestration

---

## 📋 Phase 1: API Foundation (Current Priority)

### 1. Core API Endpoints (Already Built ✅)

**People/Leads:**
- `POST /api/trpc/people.create` ✅
- `GET /api/trpc/people.list` ✅
- `GET /api/trpc/people.get` ✅
- `PATCH /api/trpc/people.update` ✅
- `DELETE /api/trpc/people.delete` ✅

**Companies:**
- `POST /api/trpc/companies.create` ✅
- Similar CRUD operations ✅

**Campaigns:**
- `POST /api/trpc/campaigns.create` ✅
- Similar CRUD operations ✅

**AI Prompts:**
- `POST /api/trpc/ai.runPrompt` ✅ (Claygent-style)

### 2. Enrichment Engine (Build Next)

**Goal**: Let users trigger enrichment on any field, just like Clay

**Endpoints to Add:**
```typescript
// Trigger enrichment on a person
POST /api/trpc/enrichment.enrichPerson
{
  personId: string;
  enrichments: [
    { type: "linkedin", fields: ["headline", "summary", "experience"] },
    { type: "company", fields: ["revenue", "employees", "funding"] },
    { type: "email_finder", provider: "hunter" },
    { type: "ai_research", prompt: "Find this person's tech stack" }
  ]
}

// Get enrichment status
GET /api/trpc/enrichment.getStatus
{
  personId: string;
  enrichmentId: string;
}

// List available enrichment providers
GET /api/trpc/enrichment.providers
// Returns: [{ id: "linkedin", name: "LinkedIn Scraper", fields: [...] }, ...]
```

**Implementation Strategy:**
- Enrichment = Job in queue (use BullMQ or similar)
- Each enrichment type = Plugin/adapter pattern
- Results saved back to Structify
- Webhooks notify when complete

### 3. Workflow Engine (Build After Enrichment)

**Goal**: Execute multi-step workflows like n8n/Make

**Endpoints:**
```typescript
// Create workflow
POST /api/trpc/workflows.create
{
  name: string;
  trigger: { type: "webhook" | "schedule" | "manual" };
  steps: [
    { type: "enrichment", config: {...} },
    { type: "ai_prompt", config: {...} },
    { type: "condition", config: {...} },
    { type: "webhook", config: {...} }
  ]
}

// Execute workflow
POST /api/trpc/workflows.execute
{
  workflowId: string;
  input: { personId: string; ... }
}

// Get workflow runs
GET /api/trpc/workflows.runs
{
  workflowId: string;
  limit: number;
}
```

### 4. Integration Hub (Build After Workflows)

**Goal**: Connect to any API, like Clay's API connector

**Endpoints:**
```typescript
// Add integration
POST /api/trpc/integrations.add
{
  name: string;
  type: "rest" | "graphql" | "soap";
  auth: { type: "api_key" | "oauth" | "basic", credentials: {...} };
  baseUrl: string;
}

// Call integration
POST /api/trpc/integrations.call
{
  integrationId: string;
  endpoint: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  params: { ... };
  body: { ... };
}

// Test integration
POST /api/trpc/integrations.test
{
  integrationId: string;
}
```

---

## 🎨 Frontend Integration Pattern

### How Your Lovable Frontend Will Use the API:

#### 1. **Visual Workflow Builder**
```typescript
// User drags "Enrich LinkedIn" block in Lovable
// Frontend calls:
await trpc.enrichment.enrichPerson.mutate({
  personId: selectedPerson.id,
  enrichments: [{ type: "linkedin", fields: ["headline", "summary"] }]
});

// Poll for status
const status = await trpc.enrichment.getStatus.query({
  personId,
  enrichmentId
});
```

#### 2. **AI Prompt Runner UI**
```typescript
// User creates prompt with {{variables}} in Lovable
// Frontend calls:
await trpc.ai.runPrompt.mutate({
  prompt: "Research {{companyName}} and find their tech stack",
  variables: { companyName: person.currentCompany },
  model: "claude-3-5-sonnet",
  outputFormat: "json"
});
```

#### 3. **Data Table with Enrichment**
```typescript
// User clicks "Enrich" on a column in Lovable table
// Frontend calls:
const people = await trpc.people.list.query({ limit: 100 });

// Batch enrich all people
for (const person of people) {
  await trpc.enrichment.enrichPerson.mutate({
    personId: person.personId,
    enrichments: [{ type: "email_finder" }]
  });
}
```

---

## 📚 API Documentation Strategy

### 1. **OpenAPI/Swagger Spec**
tRPC can generate OpenAPI automatically:

```typescript
// In packages/api/src/server.ts
import { generateOpenApiDocument } from 'trpc-openapi';

const openApiDocument = generateOpenApiDocument(appRouter, {
  title: 'Togari API',
  version: '1.0.0',
  baseUrl: 'http://localhost:4000/api',
});

// Serve at /api/docs
app.get('/api/openapi.json', (req, res) => {
  res.json(openApiDocument);
});
```

### 2. **Interactive API Docs**
Add Scalar or Swagger UI:
```bash
pnpm add @scalar/api-reference
```

### 3. **API Client SDK**
Auto-generate TypeScript SDK for Lovable:
```typescript
// Your Lovable app can import:
import { togariApi } from '@togari/api-client';

const people = await togariApi.people.list({ limit: 10 });
```

---

## 🔧 Technical Improvements Needed

### 1. **Better Error Handling**
```typescript
// Current: Basic errors
// Needed: Structured error codes

export const API_ERRORS = {
  PERSON_NOT_FOUND: 'PERSON_NOT_FOUND',
  ENRICHMENT_FAILED: 'ENRICHMENT_FAILED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INVALID_LINKEDIN_URL: 'INVALID_LINKEDIN_URL',
} as const;

throw new TRPCError({
  code: 'NOT_FOUND',
  message: 'Person not found',
  cause: { errorCode: API_ERRORS.PERSON_NOT_FOUND }
});
```

### 2. **Rate Limiting**
```typescript
// Add rate limiting middleware
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);
```

### 3. **Caching Layer**
```typescript
// Add Redis for caching enrichments
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

// Cache enrichment results
await redis.set(`enrichment:${personId}:linkedin`, JSON.stringify(data), 'EX', 3600);
```

### 4. **Job Queue for Async Operations**
```typescript
// Use BullMQ for background jobs
import { Queue, Worker } from 'bullmq';

const enrichmentQueue = new Queue('enrichment', {
  connection: redis
});

// Add job
await enrichmentQueue.add('enrich-person', {
  personId,
  enrichments
});

// Process job
const worker = new Worker('enrichment', async (job) => {
  const { personId, enrichments } = job.data;
  // Do enrichment
  await enrichPerson(personId, enrichments);
});
```

### 5. **Webhooks for Real-time Updates**
```typescript
// Notify frontend when enrichment completes
POST /api/webhooks/enrichment-complete
{
  personId: string;
  enrichmentId: string;
  status: "complete" | "failed";
  data: { ... }
}

// Lovable frontend subscribes to webhooks
// Or use WebSockets/SSE for real-time updates
```

---

## 🚀 Immediate Action Plan

### Week 1: API Hardening
1. ✅ Remove frontend (already done)
2. ✅ Core CRUD working (already done)
3. 🔲 Add OpenAPI documentation
4. 🔲 Add comprehensive error codes
5. 🔲 Add rate limiting
6. 🔲 Add API health check endpoint
7. 🔲 Add CORS configuration for Lovable

### Week 2: Enrichment Engine
1. 🔲 Design enrichment plugin architecture
2. 🔲 Build LinkedIn enrichment adapter
3. 🔲 Build email finder adapter (Hunter/Apollo)
4. 🔲 Build company data adapter (Clearbit/similar)
5. 🔲 Add job queue (BullMQ)
6. 🔲 Add enrichment status tracking

### Week 3: AI & Automation
1. 🔲 Enhance AI prompt runner
2. 🔲 Add batch prompt execution
3. 🔲 Add prompt templates
4. 🔲 Build simple workflow engine
5. 🔲 Add webhook triggers

### Week 4: Integration & Testing
1. 🔲 Build REST API integration adapter
2. 🔲 Add integration testing
3. 🔲 Create Postman collection
4. 🔲 Write API usage examples
5. 🔲 Deploy to staging

---

## 📦 Package Structure (API-Focused)

```
togari-api/
├── packages/
│   ├── core/                    # Shared types
│   ├── structify/               # Structify client
│   ├── api/                     # Main API server
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── router/
│   │   │   │   ├── people.ts
│   │   │   │   ├── companies.ts
│   │   │   │   ├── enrichment.ts    # NEW
│   │   │   │   ├── workflows.ts     # NEW
│   │   │   │   ├── integrations.ts  # NEW
│   │   │   │   └── ai.ts
│   │   │   ├── services/
│   │   │   │   ├── enrichment/      # NEW
│   │   │   │   ├── workflows/       # NEW
│   │   │   │   └── integrations/    # NEW
│   │   │   ├── jobs/                # NEW - Background jobs
│   │   │   ├── adapters/            # NEW - External API adapters
│   │   │   └── middleware/
│   │   └── package.json
│   │
│   ├── sdk/                     # NEW - API Client SDK
│   │   ├── src/
│   │   │   ├── client.ts        # Generated tRPC client
│   │   │   └── types.ts         # Exported types
│   │   └── package.json
│   │
│   └── workers/                 # Background job processors
│       ├── src/
│       │   ├── enrichment-worker.ts
│       │   ├── workflow-worker.ts
│       │   └── queue.ts
│       └── package.json
│
├── docs/
│   ├── API.md                   # API reference
│   ├── ENRICHMENT.md            # Enrichment guide
│   ├── WORKFLOWS.md             # Workflow guide
│   └── INTEGRATIONS.md          # Integration guide
│
├── examples/                    # API usage examples
│   ├── node/
│   ├── python/
│   └── curl/
│
└── .env
```

---

## 🎯 Success Criteria

### When API is "MVP Ready" for Lovable:

1. **Core Functionality**
   - ✅ CRUD for all entities
   - ✅ AI prompt runner
   - 🔲 Enrichment engine working
   - 🔲 Basic workflow execution

2. **Documentation**
   - 🔲 OpenAPI spec published
   - 🔲 Interactive API docs
   - 🔲 Usage examples for each endpoint
   - 🔲 Error code reference

3. **Reliability**
   - 🔲 Rate limiting
   - 🔲 Error handling
   - 🔲 Health checks
   - 🔲 Logging & monitoring

4. **Integration Ready**
   - 🔲 CORS configured for Lovable
   - 🔲 Webhook endpoints
   - 🔲 API client SDK published
   - 🔲 Real-time updates (WebSockets or SSE)

---

## 🔗 How You'll Integrate Lovable Frontend

### Option 1: Direct API Calls
```typescript
// In your Lovable app
const response = await fetch('http://localhost:4000/api/trpc/people.list', {
  method: 'GET',
  headers: { 'Content-Type': 'application/json' }
});
const people = await response.json();
```

### Option 2: tRPC Client (Recommended)
```typescript
// Install in Lovable
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@togari/api';

const client = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: 'http://localhost:4000/api/trpc',
    }),
  ],
});

// Fully type-safe!
const people = await client.people.list.query({ limit: 10 });
```

### Option 3: SDK Package
```typescript
// Install in Lovable
import { TogariClient } from '@togari/sdk';

const togari = new TogariClient({
  apiUrl: 'http://localhost:4000',
  apiKey: 'your-api-key',
});

const people = await togari.people.list({ limit: 10 });
```

---

## 💡 Next Steps for You

### 1. **Today: Focus on API**
- Remove the web package entirely (we don't need it)
- Focus on hardening the API
- Add OpenAPI docs
- Test all endpoints with Postman

### 2. **This Week: Build Enrichment**
- Design the enrichment plugin architecture
- Build 1-2 enrichment adapters
- Test enrichment flow end-to-end

### 3. **Next Week: Start Lovable**
- Build your dream UI in Lovable
- Connect to Togari API
- Test core workflows (create person, enrich, view)

### 4. **Later: Bring Back Workflow Builder**
Once Lovable UI is working:
- Add visual workflow builder
- Add API integration builder
- Add advanced AI features

---

## 🎨 The Vision

**You're building the Clay of healthcare** - but better:
- ✅ Healthcare-specific (not generic B2B)
- ✅ Amber-integrated (consumer + B2B in one)
- ✅ AI-native (not bolted on)
- ✅ Open architecture (any frontend, any integration)

**API First = Flexibility Forever**

Your Lovable frontend today. A mobile app tomorrow. Voice interface next year. **The API stays the same.**

---

## 📞 When You're Ready to Integrate

Come back with:
1. Your Lovable frontend URL
2. What endpoints you need first
3. Any specific enrichment providers you want

And we'll:
- Configure CORS
- Set up webhooks
- Create API client SDK
- Build exactly what you need

**Let's make the API bulletproof first.** 🚀
