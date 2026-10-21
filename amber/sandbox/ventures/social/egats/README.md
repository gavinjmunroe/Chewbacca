# EGATS — Every Great Artist Takes Space

> "Stage" spelled backwards. Because we're flipping the narrative for how creatives get onto the stage.

EGATS is the most trusted hiring pipeline for creative talent — combining in-person verification with modern discovery tools. Dancers, musicians, actors, models, photographers, videographers, stylists, directors, comedians, and more. This monorepo contains two products:

| App | Description | Deploy |
|-----|-------------|--------|
| [`apps/platform`](./apps/platform) | EGATS Recruiting Platform — the full hiring engine | Vercel |
| [`apps/culture`](./apps/culture) | EGATS Culture — creative-first social iOS demo | Vercel |

## Quick Start

```bash
# Platform
cd apps/platform
cp .env.example .env.local
npm install
npm run dev

# Culture
cd apps/culture
npm install
npm run dev
```

## Deploying to Vercel

### Platform
1. Import `apps/platform` as root directory in Vercel
2. Add all env variables from `.env.example`
3. Deploy

### Culture
1. Import `apps/culture` as root directory in Vercel
2. No env variables required (mock data + optional Supabase)
3. Deploy

## Documentation

See [`docs/`](./docs/) for complete documentation:

- [Architecture](./docs/ARCHITECTURE.md)
- [Product Vision](./docs/PRODUCT_VISION.md)
- [Recruiting Platform](./docs/RECRUITING_PLATFORM.md)
- [Culture Platform](./docs/CULTURE_PLATFORM.md)
- [Camp Operations Playbook](./docs/CAMP_OPERATIONS_PLAYBOOK.md)
- [Verification System](./docs/VERIFICATION_SYSTEM.md)
- [Business Model](./docs/BUSINESS_MODEL.md)
- [AI System](./docs/AI_SYSTEM.md)
- [Safety & Trust](./docs/SAFETY_AND_TRUST.md)
- [Go-To-Market](./docs/GO_TO_MARKET.md)
- [Legal & Compliance](./docs/LEGAL_COMPLIANCE.md)
- [Database Schema](./docs/DATABASE_SCHEMA.md)
- [API Reference](./docs/API_REFERENCE.md)
- [Deployment Guide](./docs/DEPLOYMENT.md)

## Tech Stack

- **Framework**: Next.js 15 + TypeScript
- **Database**: Supabase (PostgreSQL + Auth + Storage)
- **AI**: Anthropic Claude API
- **Styling**: Tailwind CSS
- **Deployment**: Vercel
