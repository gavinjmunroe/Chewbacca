# Getting Started with Togari

This guide will help you get Togari up and running in development mode.

## Prerequisites

Ensure you have:
- Node.js 20+ (`node --version`)
- pnpm 9+ (`pnpm --version`)
- Git

## Step 1: Installation

```bash
# Install dependencies
pnpm install
```

This will install all dependencies for all packages in the monorepo.

## Step 2: Environment Setup

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Fill in the required environment variables:

```env
# Structify (Required)
STRUCTIFY_API_KEY=your_structify_api_key
STRUCTIFY_DATASET_ID=your_dataset_id

# Clerk (Required)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
CLERK_SECRET_KEY=sk_test_xxx
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

# API URLs
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Amber API Key (for external Amber app)
AMBER_API_KEY=your_secure_api_key

# Optional: Clay, n8n, LLMs (for enrichment and AI features)
CLAY_API_KEY=your_clay_api_key
N8N_BASE_URL=https://your-n8n-instance.com
ANTHROPIC_API_KEY=your_anthropic_key
OPENAI_API_KEY=your_openai_key
```

## Step 3: Get Structify Credentials

1. Go to [https://structify.ai](https://structify.ai)
2. Sign up for an account
3. Create a new dataset called "togari_dev"
4. Copy your API key and dataset ID to `.env`

## Step 4: Get Clerk Credentials

1. Go to [https://clerk.com](https://clerk.com)
2. Sign up and create a new application
3. Enable the "Organizations" feature
4. Copy your publishable key and secret key to `.env`
5. In Clerk dashboard, set:
   - Sign-in URL: `/sign-in`
   - Sign-up URL: `/sign-up`
   - After sign-in URL: `/dashboard`

## Step 5: Start Development Servers

```bash
# Start all services (API + Web)
pnpm dev
```

This will start:
- **API Server**: http://localhost:4000
- **Web App**: http://localhost:3000

Or start them individually:

```bash
# API only
pnpm --filter @togari/api dev

# Web only
pnpm --filter @togari/web dev
```

## Step 6: Sign Up and Test

1. Navigate to http://localhost:3000
2. Click "Get Started" to sign up
3. Create an account
4. Create an organization (e.g., "My Health Practice")
5. You'll be redirected to the dashboard

## Step 7: Test the System

### Test 1: API Health Check

```bash
curl http://localhost:4000/health
```

Expected response:
```json
{"status":"ok","timestamp":"2026-01-19T..."}
```

### Test 2: Submit a Lead via Amber Endpoint

```bash
curl -X POST http://localhost:4000/api/v1/amber/submit \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_secure_api_key" \
  -d '{
    "linkedinUrl": "https://linkedin.com/in/johndoe",
    "submittedName": "John Doe",
    "submittedCompany": "Acme Health",
    "submittedTitle": "Chief Medical Officer",
    "sourceChannel": "warm_referral",
    "sourceCampaign": "Q1-2026",
    "notes": "Met at healthcare conference",
    "submittedBy": "your-email@example.com",
    "organizationId": "your_clerk_org_id"
  }'
```

Expected response:
```json
{
  "success": true,
  "personId": "per_xxx",
  "message": "Lead submitted successfully"
}
```

### Test 3: View in Dashboard

1. Go to http://localhost:3000/dashboard/sales
2. You should see the lead you just created
3. Navigate through statuses to see the pipeline

### Test 4: AI Prompt Runner

1. Go to http://localhost:3000/dashboard/ai
2. Click "Generate Email Subject" example
3. Click "Run Prompt"
4. See the AI-generated output

**Note**: For AI features to work, you need either `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in your `.env`.

## Common Issues

### Issue: "Cannot find module '@togari/core'"

**Solution**: Run `pnpm install` again to ensure workspace links are set up.

### Issue: "Clerk authentication not working"

**Solution**:
1. Check that `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` starts with `pk_`
2. Make sure you're on http://localhost:3000 (Clerk checks the domain)
3. Clear cookies and try again

### Issue: "Structify API error"

**Solution**:
1. Verify your API key is correct
2. Make sure the dataset exists in your Structify account
3. Check that the dataset ID matches

### Issue: Port already in use

**Solution**:
```bash
# Kill process on port 4000
lsof -ti:4000 | xargs kill -9

# Kill process on port 3000
lsof -ti:3000 | xargs kill -9
```

## Next Steps

### 1. Set Up Clay Enrichment

1. Create a Clay account at https://clay.com
2. Create a "People Intake" table
3. Add enrichment waterfall for LinkedIn
4. Configure webhook to call: `POST http://localhost:4000/api/v1/webhooks/clay/enrichment`
5. Add `CLAY_API_KEY` and `CLAY_TABLE_PEOPLE_INTAKE` to `.env`

### 2. Set Up n8n Workflows

1. Deploy n8n (or use cloud version)
2. Import workflows from `infrastructure/n8n/workflows/`
3. Configure webhooks to point to your API
4. Add `N8N_BASE_URL` and `N8N_API_KEY` to `.env`

### 3. Connect External Amber App

1. Generate a secure API key
2. Add it to `.env` as `AMBER_API_KEY`
3. Configure Amber app to call: `POST http://your-api.com/api/v1/amber/submit`
4. See `docs/AMBER_INTEGRATION.md` for full API spec

### 4. Invite Team Members

1. In the web app, go to organization settings
2. Invite team members via email
3. They'll receive an invitation from Clerk

## Development Workflow

### Adding a New Feature

1. **Core Types**: Add types to `packages/core/src/types/`
2. **Validation**: Add Zod schemas to `packages/core/src/schemas/`
3. **API**: Add tRPC router to `packages/api/src/router/`
4. **UI**: Add page/component to `packages/web/src/`

### Building for Production

```bash
pnpm build
```

### Type Checking

```bash
pnpm type-check
```

### Linting

```bash
pnpm lint
```

## Architecture Overview

```
Amber (External) → API (/amber/submit) → Structify
                                         ↓
                                      n8n → Clay → Enrichment
                                         ↓
                                   Webhook (/clay/enrichment)
                                         ↓
                                   Update Structify
                                         ↓
                                   Web App (Display)
```

## Learn More

- [Architecture Guide](./ARCHITECTURE.md) - System design and data flows
- [API Documentation](./API.md) - Complete API reference
- [Amber Integration](./AMBER_INTEGRATION.md) - External app integration
- [Setup Guide](./SETUP.md) - Detailed setup instructions

## Support

- Issues: GitHub Issues
- Email: dev@togari.com
- Documentation: https://docs.togari.com
