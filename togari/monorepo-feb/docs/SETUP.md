# Togari Setup Guide

## Prerequisites

Before you begin, ensure you have:

- Node.js 20+ installed
- pnpm 9+ installed (`npm install -g pnpm`)
- A Structify account and API key
- A Clerk account for authentication
- Clay account (for data enrichment)
- n8n instance (for workflow automation)

## Initial Setup

### 1. Clone and Install

```bash
git clone <repository-url>
cd togari-api
pnpm install
```

### 2. Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Fill in the required environment variables in `.env`:

```env
# Structify - Get from https://structify.ai
STRUCTIFY_API_KEY=your_structify_api_key
STRUCTIFY_DATASET_ID=your_dataset_id

# Clerk - Get from https://clerk.com
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Clay - Get from https://clay.com
CLAY_API_KEY=your_clay_api_key
CLAY_TABLE_PEOPLE_INTAKE=your_table_id

# n8n - Your n8n instance
N8N_BASE_URL=https://your-n8n-instance.com
N8N_API_KEY=your_n8n_api_key

# App URLs
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Structify Setup

1. Log in to your Structify account
2. Create a new dataset called "togari_prod"
3. Define the following entity types:
   - **People**: Primary entity for leads/contacts
   - **Companies**: Company information
   - **Campaigns**: Marketing campaigns
   - **Touchpoints**: Activity log
   - **Relationships**: Partner network

See `infrastructure/structify/schemas/` for field definitions.

### 4. Clerk Setup

1. Go to [Clerk Dashboard](https://dashboard.clerk.com)
2. Create a new application
3. Enable organizations feature
4. Copy your publishable and secret keys to `.env`
5. Configure sign-in/sign-up URLs:
   - Sign-in URL: `/sign-in`
   - Sign-up URL: `/sign-up`

### 5. Clay Setup

1. Create Clay tables for enrichment:
   - **People Intake**: Receives new leads from Togari
   - **Activation**: Enriched leads ready for campaigns

2. Configure Clay workflows:
   - LinkedIn profile enrichment
   - Company data enrichment
   - Email verification

3. Copy table IDs to your `.env` file

### 6. n8n Setup

1. Deploy or access your n8n instance
2. Import workflows from `infrastructure/n8n/workflows/`:
   - Lead enrichment workflow
   - Scoring workflow
   - Campaign activation workflow

3. Configure webhooks to point to your Togari API
4. Update `.env` with your n8n base URL and API key

## Development

### Start All Services

```bash
pnpm dev
```

This starts:
- API server on `http://localhost:4000`
- Web app on `http://localhost:3000`
- Workers (background jobs)

### Start Individual Services

```bash
# API only
pnpm --filter @togari/api dev

# Web app only
pnpm --filter @togari/web dev

# Workers only
pnpm --filter @togari/workers dev
```

### Build for Production

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

## Deployment

### API Deployment (Google Cloud Run)

1. Build Docker image:
```bash
docker build -f infrastructure/docker/Dockerfile.api -t togari-api .
```

2. Push to Google Container Registry:
```bash
docker tag togari-api gcr.io/your-project/togari-api
docker push gcr.io/your-project/togari-api
```

3. Deploy to Cloud Run:
```bash
gcloud run deploy togari-api \
  --image gcr.io/your-project/togari-api \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

### Web App Deployment (Vercel)

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
cd packages/web
vercel --prod
```

### Environment Variables in Production

Set the following in your deployment platform:

- All variables from `.env.example`
- Update URLs to production values
- Use production API keys (not test keys)

## Testing the Setup

### 1. Test Structify Connection

```bash
# Run a test script (create this)
pnpm --filter @togari/api test:structify
```

### 2. Test Clerk Authentication

1. Navigate to `http://localhost:3000`
2. Sign up for a new account
3. Verify email
4. Create an organization

### 3. Test Amber Integration

```bash
curl -X POST http://localhost:4000/api/v1/amber/submit \
  -H "Content-Type: application/json" \
  -H "X-API-Key: test_api_key" \
  -d '{
    "linkedinUrl": "https://linkedin.com/in/test",
    "submittedName": "Test User",
    "sourceChannel": "warm_referral",
    "submittedBy": "test@example.com",
    "organizationId": "org_test123"
  }'
```

### 4. Test Clay Enrichment

1. Submit a lead via Amber endpoint
2. Check Clay People Intake table for new row
3. Verify enrichment workflow triggers
4. Check Structify for updated data

## Troubleshooting

### Common Issues

**Issue**: `pnpm install` fails
- **Solution**: Ensure Node.js 20+ is installed: `node --version`

**Issue**: Clerk authentication not working
- **Solution**: Check that `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is set and starts with `pk_`

**Issue**: Structify API errors
- **Solution**: Verify your API key is valid and dataset exists

**Issue**: Clay enrichment not triggering
- **Solution**: Check webhook URLs in Clay workflows point to correct API endpoint

**Issue**: Build fails with type errors
- **Solution**: Run `pnpm type-check` to see specific errors

### Getting Help

- Check the [Architecture Guide](./ARCHITECTURE.md)
- Review [API Documentation](./API.md)
- Check [Amber Integration](./AMBER_INTEGRATION.md)
- Open an issue in the repository

## Next Steps

After setup is complete:

1. Create your first organization in Clerk
2. Generate an API key for Amber integration
3. Submit a test lead via the Amber endpoint
4. Verify the lead appears in the Togari dashboard
5. Configure your Clay enrichment workflows
6. Set up n8n automation workflows

## Maintenance

### Regular Tasks

- **Weekly**: Review error logs and fix issues
- **Monthly**: Rotate API keys
- **Quarterly**: Update dependencies: `pnpm update --latest`

### Monitoring

Set up monitoring for:
- API uptime and response times
- Clerk authentication success rate
- Structify query performance
- Clay enrichment completion rate
- n8n workflow execution status

### Backups

- Structify handles data backups automatically
- Export critical data regularly for redundancy
- Keep configuration files in version control
