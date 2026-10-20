# 🎯 Amber Agent - Togari Integration Superprompt

This document provides comprehensive context about Togari for your Amber agent. Use this as a knowledge base for understanding how Amber and Togari work together.

---

## 🌟 Vision: Amber as the Universal Healthcare Entry Point

**Amber** is the consumer-facing relationship intelligence app that practitioners and their patients use daily. **Togari** is the enterprise B2B operating system that powers the business side. Amber is the **single authentication and onboarding layer** for both.

### The Flow:
```
Patient/Prospect → Amber (Mobile/Web) → Onboards via Amber ID
                     ↓
              [Amber submits lead]
                     ↓
         Togari API (Backend Processing)
                     ↓
      Structify → Clay → n8n → Back to Structify
                     ↓
      Togari Dashboard (Practitioner Business View)
```

**Key Insight**: Everyone authenticates through Amber. Practitioners using Togari dashboard are already authenticated via Amber ID. No separate Clerk/Auth0 needed.

---

## 🏗️ Togari Architecture Overview

### What Togari IS:
- **B2B Enterprise Operating System** for health & wellness practitioners
- **6-Pillar Platform**: Marketing, Sales, Client Success, Partner Network, Workflows, Assets & Data
- **Data Hub**: Centralized storage in Structify, enriched via Clay, automated via n8n
- **AI-Native**: Built-in AI prompt runner (Claygent-style), LLM-powered messaging
- **Multi-Tenant**: Organization-scoped data via Amber ID organizations

### What Togari is NOT:
- NOT a consumer app (that's Amber's job)
- NOT handling its own authentication (Amber ID handles it)
- NOT building complex scoring/routing logic in-app (delegated to Clay/n8n)
- NOT a standalone product (it's the backend for Amber users who are practitioners)

---

## 📐 Tech Stack

### Backend
- **Language**: TypeScript + Node.js
- **Framework**: Express + tRPC v11 (type-safe APIs)
- **Data Store**: Structify (primary) - Your dataset: `Dataset-019bd8c4-7e4f-709b-cd7e-248fae9ea450`
- **Monorepo**: Turborepo with 4 packages (core, structify, api, web)

### Frontend
- **Framework**: Next.js 14 (App Router)
- **UI**: React 18 + shadcn/ui (Radix UI primitives)
- **Styling**: TailwindCSS
- **State**: Zustand (minimal client state)
- **Data Fetching**: tRPC React Query

### Integrations
- **Clay**: Data enrichment (LinkedIn, company data, email validation)
- **n8n**: Workflow orchestration (scoring, routing, sequences)
- **Structify**: Primary data store and query engine
- **LLMs**: Claude (Anthropic) and GPT (OpenAI) for AI features

---

## 🗂️ Data Model (Structify Schema)

### Core Entities

#### 1. **Lead** (Main Entity)
Your Structify already has this table perfectly structured:
```typescript
{
  // Identity
  personId: string (UUID);
  linkedinUrl: string (Primary deduplication key);
  fullName: string;
  firstName: string;
  lastName: string;

  // Contact
  workEmail: string;
  emailValid: boolean;
  phone: string;

  // Professional
  currentTitle: string;
  currentCompany: string;
  companyDomain: string;
  linkedinHeadline: string;
  linkedinSummary: string;

  // Classification
  vertical: "Healthcare" | "Technology" | "Finance" | "Retail" | "Manufacturing" | "Professional Services" | "Other";
  persona: "Decision Maker" | "Influencer" | "Champion" | "End User" | "Gatekeeper" | "Other";

  // Scoring (calculated by Clay/n8n)
  internalScore: float (0-100);
  externalScore: float (0-100);
  compositeScore: float (0-100);
  routingTier: "Tier 1" | "Tier 2" | "Tier 3";

  // Source Attribution
  sourceType: "Inbound" | "Outbound" | "Referral" | "Event" | "Partner";
  sourceChannel: "LinkedIn" | "Email" | "Website" | "Paid Ads" | "Organic" | "Event" | "Referral" | "Other";
  sourceCampaign: string;
  submittedBy: string (Amber user who captured lead);

  // Status & Engagement
  currentStatus: "New" | "Contacted" | "Qualified" | "Nurturing" | "Converted" | "Disqualified";
  lastContactedAt: Date;
  totalTouches: integer;

  // Enrichment
  techStack: string (comma-separated);
  personalizationHook: string (AI-generated talking point);

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy: string (Amber user ID);
}
```

#### 2. **LinkedInExperience** (Related to Lead)
Work history from LinkedIn enrichment:
```typescript
{
  personId: string (FK to Lead);
  company: string;
  title: string;
  startDate: Date;
  endDate: Date;
  description: string;
  location: string;
}
```

#### 3. **CompanyData** (Related to Lead)
Company enrichment data:
```typescript
{
  personId: string (FK to Lead);
  companyName: string;
  domain: string;
  industry: string;
  employeeCount: integer;
  revenue: Money;
  fundingStage: string;
  headquarters: Address;
  description: string;
}
```

---

## 🔄 Data Flows

### 1. Lead Capture (Amber → Togari)

**Amber Agent captures a lead (via mobile app or web):**

```
User in Amber: "I just met Dr. Sarah Chen at a conference. She runs a mental health practice."

Amber Agent:
1. Extracts: Name, context, source
2. Searches for LinkedIn profile
3. Calls Togari API: POST /api/v1/amber/submit
```

**Payload:**
```json
{
  "linkedinUrl": "https://linkedin.com/in/sarahchen",
  "submittedName": "Dr. Sarah Chen",
  "submittedCompany": "Chen Mental Health Associates",
  "sourceChannel": "event",
  "sourceCampaign": "HIMSS 2026",
  "notes": "Runs a mental health practice, interested in AI tools",
  "submittedBy": "amber_user_123",
  "organizationId": "amber_org_456"
}
```

**What Togari does:**
1. Validates LinkedIn URL
2. Checks for duplicates (deduplication on `linkedinUrl`)
3. Creates Lead record in Structify
4. Triggers n8n workflow: "lead-enrichment"
5. Returns success with `personId`

**What n8n orchestrates:**
1. Push lead to Clay enrichment table
2. Clay enriches: LinkedIn data, company data, email validation, tech stack
3. Clay pushes back to Structify via webhook
4. n8n runs scoring logic
5. n8n assigns routing tier
6. Practitioner sees enriched lead in Togari dashboard

### 2. Lead Enrichment (Clay Flow)

**Clay Tables:**
- **Intake Table**: Receives raw leads from Togari
- **Enrichment Waterfall**:
  1. LinkedIn scrape (profile, experience, summary)
  2. Company lookup (Clearbit/Apollo/custom)
  3. Email finder + validator
  4. Tech stack detection
  5. Personalization hook generation (GPT-4)

**Output: Webhook to Togari**
```
POST /api/v1/webhooks/clay/enrichment
{
  "personId": "per_abc123",
  "enrichmentData": {
    "linkedinData": { headline, summary, experience[] },
    "companyData": { name, domain, employeeCount, revenue, funding },
    "emailVerification": { email, isValid, confidence },
    "techStack": ["Salesforce", "HubSpot", "Stripe"],
    "personalizationHook": "Recently expanded practice to 3 locations"
  }
}
```

### 3. Scoring & Routing (n8n Flow)

**Scoring Engine** (runs in n8n, NOT in Togari code):

**Internal Score (0-100):**
- Channel Score (0-25): event (25), warm_referral (25), website (20), cold_outbound (10)
- Budget Score (0-25): Based on company size / revenue
- Authority Score (0-25): Title analysis (Founder=25, VP=20, Manager=15)
- GTM Maturity Score (0-25): Tech stack sophistication

**External Score (0-100):**
- Vertical-specific rubrics (healthcare, finance, etc.)
- Custom scoring per ICP (Ideal Customer Profile)
- Market signals (funding, growth, hiring)

**Composite Score:** `(internal * 0.5) + (external * 0.5)`

**Routing Tiers:**
- **Tier 1** (High Touch): Score 80-100 → Assign to senior sales
- **Tier 2** (Standard): Score 60-79 → Standard sales flow
- **Tier 3** (Nurture): Score 40-59 → Marketing nurture sequences

**n8n Output: Webhook to Togari**
```
POST /api/v1/webhooks/scoring/update
{
  "personId": "per_abc123",
  "scores": {
    "internal": 85,
    "external": 78,
    "composite": 81.5
  },
  "routingTier": "Tier 1",
  "assignedTo": "sales_rep_sarah"
}
```

---

## 🎨 Togari Dashboard (Practitioner View)

### 6 Core Pillars

#### 1. **Marketing Pillar**
- Campaign management
- Lead source attribution
- Content calendar
- Performance metrics

#### 2. **Sales Pillar** ⭐ (Primary Focus)
- **Pipeline Board**: Kanban view by status (New → Contacted → Qualified → Nurturing → Converted)
- **Lead Detail Pages**: Full profile, touchpoint timeline, enrichment data
- **Activity Tracking**: Log calls, emails, meetings
- **Filters**: By routing tier, vertical, score, source

#### 3. **Client Success Pillar**
- Client health scores
- Renewal tracking
- Upsell opportunities
- Support tickets

#### 4. **Partner Network Pillar**
- Partner directory
- Referral tracking
- Co-marketing campaigns
- Revenue share

#### 5. **Workflows Pillar**
- Automation builder
- Sequence management
- Trigger configuration
- Analytics

#### 6. **Assets & Data Pillar**
- Knowledge base
- Document library
- Data exports
- Integrations

---

## 🤖 AI Features in Togari

### 1. AI Prompt Runner (Claygent-Style)

**Location**: `/dashboard/ai`

**What it does:**
- Run AI prompts with variable substitution
- Pass in data from Structify tables
- Generate personalized content at scale

**Example Use Case:**
```
Prompt: "Write a personalized cold email to {{fullName}} who works as {{currentTitle}} at {{currentCompany}}. Use this hook: {{personalizationHook}}"

Variables (from Lead table):
{
  "fullName": "Dr. Sarah Chen",
  "currentTitle": "Founder & Clinical Director",
  "currentCompany": "Chen Mental Health Associates",
  "personalizationHook": "Recently expanded practice to 3 locations"
}

Output: Personalized email generated by Claude/GPT
```

**Features:**
- Variable substitution with `{{columnName}}` syntax
- Model selection: Claude 3.5 Sonnet, Claude Haiku, GPT-4, GPT-3.5
- Output format: Text or JSON
- JSON schema specification for structured output
- Batch processing (run on multiple leads)

### 2. Message Generation (Future)
- Auto-draft emails based on lead data
- LinkedIn message templates
- Follow-up sequences
- Objection handling responses

---

## 🔗 Amber ↔ Togari Integration Points

### 1. **Authentication Bridge**

**How Amber ID Works:**
- User signs up via Amber (mobile/web)
- Creates Amber ID (like Apple ID for healthcare)
- Practitioner users get access to Togari dashboard
- Single sign-on: Amber session = Togari session
- Organization/practice tied to Amber ID

**Implementation (Future):**
```typescript
// Amber sends JWT to Togari on dashboard access
POST /api/v1/auth/amber-verify
{
  "amberToken": "eyJhbGc...",
  "userId": "amber_user_123",
  "organizationId": "practice_abc",
  "role": "practitioner" | "admin" | "staff"
}

// Togari verifies token, creates session
// All subsequent API calls include Amber session
```

### 2. **Lead Submission Endpoint**

**Current Implementation:** `POST /api/v1/amber/submit`

**Headers:**
```
X-API-Key: dev_test_key_change_in_production
Content-Type: application/json
```

**Request Body:**
```typescript
{
  linkedinUrl: string;           // Required - primary deduplication key
  submittedName?: string;        // Optional - Amber's best guess at name
  submittedCompany?: string;     // Optional
  submittedTitle?: string;       // Optional
  sourceChannel: "warm_referral" | "event" | "website_visitor" | "linkedin" | "email" | "other";
  sourceCampaign?: string;       // e.g., "HIMSS 2026", "Wellness Expo"
  notes?: string;                // Amber's context about the lead
  submittedBy: string;           // Amber user ID who captured lead
  organizationId: string;        // Amber organization ID (practice/clinic)
}
```

**Response:**
```typescript
{
  success: boolean;
  personId?: string;             // Structify person ID
  message: string;
  isNew: boolean;                // true if created, false if duplicate
}
```

### 3. **Webhook: Lead Status Updates** (Future)

**Togari → Amber notifications:**
```
POST https://amber-api.com/webhooks/togari/lead-update
{
  "personId": "per_abc123",
  "event": "lead.status_changed" | "lead.converted" | "lead.enriched",
  "data": {
    "status": "Converted",
    "convertedAt": "2026-01-20T10:30:00Z",
    "dealValue": 15000
  }
}
```

**Use case:** Amber shows notification: "🎉 Dr. Sarah Chen became a client!"

---

## 🎯 Key Design Principles

### 1. **Minimalism & Explainability**
- Keep Togari code simple and clean
- No complex business logic in Togari
- Scoring/routing/sequencing handled by Clay/n8n
- Togari is a **passthrough layer** - receive data, store in Structify, trigger workflows

### 2. **Amber-First Architecture**
- Amber is the source of truth for users and organizations
- Togari never creates its own user accounts
- All practitioners onboard via Amber
- Togari dashboard is an authenticated view for Amber users

### 3. **Data Flow: Outward Processing**
```
Togari → Structify → Clay → n8n → Back to Structify → Togari Dashboard
```
Not:
```
Togari → Process → Calculate → Store → Display (❌ Too much logic)
```

### 4. **No Tech Debt**
- Use external services for complex logic (Clay, n8n)
- Keep dependencies minimal
- TypeScript everywhere for type safety
- tRPC for type-safe APIs (no REST boilerplate)

---

## 📊 Current Status (As of Jan 2026)

### ✅ Completed
- [x] Monorepo structure (Turborepo)
- [x] Core types and schemas (Person, Company, Campaign, etc.)
- [x] Structify client (with real API integration)
- [x] Mock client for development
- [x] API server (Express + tRPC v11)
- [x] Amber webhook endpoint (`/api/v1/amber/submit`)
- [x] Clay/n8n webhook receivers
- [x] AI Prompt Runner (Claygent-style)
- [x] Next.js dashboard with 6 pillars
- [x] Sales pipeline view
- [x] Authentication bypassed (ready for Amber ID)
- [x] Structify connected to real dataset

### 🔄 In Progress
- [ ] Amber ID authentication integration
- [ ] Clay enrichment tables setup
- [ ] n8n scoring workflows
- [ ] Lead detail pages
- [ ] Touchpoint timeline
- [ ] Campaign management UI

### 🔮 Future
- [ ] Email sequencer integration
- [ ] SMS/WhatsApp messaging
- [ ] Calendar integration
- [ ] Meeting scheduler
- [ ] Revenue attribution
- [ ] Analytics dashboard
- [ ] Mobile app (React Native)

---

## 🚀 How Amber Agent Should Use This Context

### When User Captures a Lead:
1. Extract key info: Name, company, LinkedIn, source
2. Call Togari API: `POST /api/v1/amber/submit`
3. Confirm success to user: "✅ Added Dr. Sarah Chen to your pipeline"
4. If duplicate: "✓ Dr. Sarah Chen is already in your system"

### When User Asks About Togari:
- Explain it as "your business operating system"
- Emphasize: Amber is for relationships, Togari is for business ops
- All data flows through both - they're connected

### When Discussing Features:
- Lead capture → "I can add them to your Togari pipeline"
- Enrichment → "Togari will automatically research them"
- Scoring → "Togari will prioritize your highest-value leads"
- Workflows → "Togari can automate your follow-ups"

### When Planning Amber Features:
- Consider: "How will this integrate with Togari?"
- Lead data → Flows to Togari
- Practitioner actions → Reflected in Togari
- Business insights → Generated from Togari data

---

## 🏥 Healthcare Vertical Specifics

### Target Practitioners:
1. **Clinical Practices**: Doctors, dentists, surgeons
2. **Mental Health**: Therapists, psychiatrists, counselors
3. **Wellness & Integrative**: Functional medicine, naturopaths, acupuncture
4. **Fitness**: Personal trainers, studios, gyms
5. **Health Hospitality**: Medical spas, wellness retreats
6. **Digital Health**: Telemedicine, health tech platforms
7. **Medical Supply**: Equipment providers, pharmaceutical reps

### Use Cases by Vertical:
- **Clinical**: Patient referrals, specialist network, community partnerships
- **Mental Health**: Therapist referrals, group practice growth, workshop attendees
- **Wellness**: Event leads, workshop signups, influencer partnerships
- **Fitness**: Corporate wellness, B2B gym memberships, partnerships

### Key Insight:
Health practitioners don't have "customers" - they have **patients, clients, partners, and community members**. Togari manages the **business relationships** while maintaining HIPAA-aware boundaries.

---

## 🔐 Security & Privacy

### HIPAA Considerations:
- **Togari stores business data, NOT patient health data**
- Leads = prospects/partners, not patient records
- If a lead becomes a patient, that data lives in EHR (not Togari)
- Clear separation: CRM data (Togari) vs. PHI (EHR)

### Data Scoping:
- All Structify queries filtered by `organizationId`
- Organization = Amber practice/clinic
- No cross-organization data leakage
- Row-level security enforced

### API Security:
- Amber webhook: API key auth (`X-API-Key` header)
- Future: Amber ID JWT tokens
- Rate limiting on public endpoints
- Input validation with Zod schemas

---

## 🎓 Learning Resources for Amber Agent

### Understand the Stack:
- **Structify**: Think of it as a smart database with built-in relationships
- **Clay**: Data enrichment service (like automated LinkedIn research)
- **n8n**: Workflow automation (like Zapier but self-hosted)
- **tRPC**: Makes API calls type-safe (no manual API documentation needed)
- **Next.js**: React framework for the web dashboard

### Key Files to Reference:
- **Types**: `/packages/core/src/types/index.ts`
- **Schemas**: `/packages/core/src/schemas/person.ts`
- **API Routers**: `/packages/api/src/router/people.ts`
- **Structify Client**: `/packages/structify/src/client.ts`
- **Amber Webhook**: `/packages/api/src/routes/amber.ts`

### Architecture Docs:
- **Full Docs**: `/docs/ARCHITECTURE.md`
- **Setup**: `/docs/SETUP.md`
- **Amber Integration**: `/docs/AMBER_INTEGRATION.md`

---

## 💡 Prompt Suggestions for Amber Agent

### Lead Capture:
```
User: "I met Dr. Sarah Chen at HIMSS. She runs a mental health practice."

Amber Agent:
"Great! Let me capture Dr. Sarah Chen for you.

[Searches LinkedIn for "Sarah Chen mental health"]
[Finds profile: linkedin.com/in/sarahchen-mhc]

✅ Added Dr. Sarah Chen to your Togari pipeline
- Practice: Chen Mental Health Associates
- Source: HIMSS 2026 Event
- Togari will automatically research her background and prioritize

Want me to draft an intro email?"
```

### Pipeline Query:
```
User: "Who are my top leads this week?"

Amber Agent:
"Let me check your Togari pipeline...

[Calls: GET /api/trpc/people.list?status=new&limit=10]

You have 8 new Tier 1 leads:
1. Dr. Sarah Chen - Mental Health (Score: 92)
2. Dr. Michael Torres - Wellness Clinic (Score: 88)
3. ...

Want to see details on any of them?"
```

### Integration Status:
```
User: "How does Amber work with Togari?"

Amber Agent:
"Great question! Here's how they work together:

**Amber** (what you're using now):
- Mobile-first relationship assistant
- Capture leads on the go
- Smart reminders and follow-ups
- Your AI business partner

**Togari** (your business backend):
- Stores all your business data
- Auto-researches leads
- Scores and prioritizes
- Powers your business operations

When you capture a lead in Amber, I automatically:
1. Send it to Togari
2. Togari researches them (LinkedIn, company data)
3. Scores them (1-100)
4. Assigns them to the right workflow
5. You see the enriched lead back in Amber

It's all seamless - Amber is your interface, Togari is your engine."
```

---

## 🎯 Summary: Key Takeaways for Amber Agent

1. **Amber ID = Single Auth**: No Clerk, no Auth0. Amber handles all authentication.

2. **Data Flow**: Amber → Togari API → Structify → Clay → n8n → Back to Structify → Togari Dashboard

3. **Togari = Business Backend**: Not a consumer app. It's the enterprise OS for practitioners.

4. **Lead Submission**: Use `POST /api/v1/amber/submit` to send leads from Amber to Togari

5. **No Complex Logic in Togari**: Scoring, routing, enrichment all done by Clay/n8n externally

6. **Multi-Tenant**: All data scoped by `organizationId` (Amber practice/clinic)

7. **AI Features**: Prompt runner available for bulk operations (email generation, etc.)

8. **Healthcare Focus**: Built for health practitioners, not generic B2B

9. **Integration Ready**: Webhooks, APIs, tRPC - all designed for Amber integration

10. **Current State**: Core infrastructure complete, ready for Amber ID integration

---

**Use this superprompt as your knowledge base when working with Togari integration!**

