# Togari

**AI-native enterprise operating system for health & wellness practitioners**

Togari replaces Salesforce for practitioner-led organizations, handling all revenue-generating activities across six core pillars: Marketing, Sales, Client Success, Partner Network, Workflows, and Assets & Data.

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                           AMBER LAYER                              │
│              Mobile-first Relationship Assistant                   │
│    Capture → Nurture → Act (iOS-style, consumer-grade UX)         │
└────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                          TOGARI CORE                               │
│                                                                    │
│  ┌──────────┬─────────┬──────────┬──────────┬──────────┬────────┐ │
│  │Marketing │  Sales  │  Client  │ Partner  │Workflows │ Assets │ │
│  │          │         │ Success  │ Network  │          │ & Data │ │
│  └──────────┴─────────┴──────────┴──────────┴──────────┴────────┘ │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    ABSTRACTION LAYER                        │  │
│  │   Structify • Clay • n8n • Claude • Gemini                  │  │
│  └─────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

## 📦 Monorepo Structure

This is a [Turborepo](https://turbo.build/repo) monorepo containing:

- `packages/core` - Shared types, schemas, and utilities
- `packages/structify` - Structify integration layer
- `packages/api` - Backend API with tRPC
- `packages/web` - Next.js web application
- `packages/workers` - Background job processors

## 🚀 Quick Start

**Want to start developing immediately?** See **[QUICKSTART.md](./QUICKSTART.md)** to get running in under 5 minutes with mock data!

You only need:
- ✅ Node.js 18+
- ✅ pnpm installed
- ✅ Clerk account (free - takes 2 minutes to set up)

No need to wait for Structify access - use the built-in mock client to start building right away!

---

### Full Setup (with Structify)

Prerequisites:
- Node.js 20+
- pnpm 9+
- Structify account (see [STRUCTIFY_SETUP.md](./docs/STRUCTIFY_SETUP.md))
- Clerk account (see [CLERK_SETUP.md](./docs/CLERK_SETUP.md))

Installation:

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env

# Fill in your Structify and Clerk credentials in .env
```

Development:

```bash
# Start all services (API + Web)
pnpm dev

# This starts:
# - API: http://localhost:4000
# - Web: http://localhost:3000
```

First Run:

1. Navigate to http://localhost:3000
2. Sign up and create an organization
3. Test the Amber endpoint:

```bash
curl -X POST http://localhost:4000/api/v1/amber/submit \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_api_key" \
  -d '{
    "linkedinUrl": "https://linkedin.com/in/test",
    "submittedName": "Test User",
    "sourceChannel": "warm_referral",
    "submittedBy": "you@example.com",
    "organizationId": "your_org_id"
  }'
```

4. View the lead at http://localhost:3000/dashboard/sales

See [GETTING_STARTED.md](./docs/GETTING_STARTED.md) for detailed setup instructions.

## 📚 Documentation

### Getting Started
- **[QUICKSTART.md](./QUICKSTART.md)** - 5-minute setup with mock data (start here!)
- [Getting Started Guide](./docs/GETTING_STARTED.md) - Comprehensive onboarding
- [Clerk Setup](./docs/CLERK_SETUP.md) - Authentication setup guide
- [Structify Setup](./docs/STRUCTIFY_SETUP.md) - Data store configuration

### Technical Docs
- [Architecture Guide](./docs/ARCHITECTURE.md) - System design and philosophy
- [Setup Instructions](./docs/SETUP.md) - Detailed setup guide
- [Amber Integration](./docs/AMBER_INTEGRATION.md) - External app API contract

## 🔐 Environment Variables

See `.env.example` for required environment variables. Key services:

- **Structify** - Primary data store
- **Clerk** - Authentication and organizations
- **Clay** - Data enrichment
- **n8n** - Workflow automation

## 🏥 Health Market Focus

Togari is built specifically for health & wellness practitioners:

- Clinical practices
- Mental health providers
- Wellness & integrative medicine
- Fitness centers
- Health hospitality
- Digital health platforms
- Emerging modalities
- Medical supply providers

## 📄 License

Proprietary - All rights reserved

## 🤝 Contributing

This is a private project. Please contact the maintainers for contribution guidelines.
