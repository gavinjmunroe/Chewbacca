# Amber Backend Service

Fastify API service for Amber - Family Relationship Intelligence Platform.

## Quick Start

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your Privy credentials and database URL
   ```

3. **Start development server:**
   ```bash
   pnpm dev
   ```

## Environment Variables

Required:
- `PRIVY_APP_ID` - Your Privy application ID
- `PRIVY_APP_SECRET` - Your Privy application secret

Optional:
- `DATABASE_URL` - PostgreSQL connection string (falls back to local file storage)
- `STORAGE_BUCKET` - GCS bucket name (falls back to local file storage)
- `PORT` - Server port (default: 8080)
- `HOST` - Server host (default: 0.0.0.0)

## API Endpoints

### Public
- `GET /health` - Health check

### Authentication
- `POST /auth/verify` - Verify Privy token
- `GET /auth/me` - Get current user

### Protected (require `Authorization: Bearer <token>`)
- `GET /persons` - List persons
- `POST /persons` - Create person
- `GET /persons/:id` - Get person
- `PUT /persons/:id` - Update person
- `DELETE /persons/:id` - Delete person
- `GET /relationships` - List relationships
- `POST /relationships` - Create relationship
- `GET /insights` - List insights
- `POST /insights` - Create insight
- `POST /insights/generate` - Generate AI insights
- `POST /pipelines/run` - Run pipeline
- `GET /pipelines/run/:id` - Get pipeline run status
- `POST /anchor/create` - Create blockchain anchor
- `GET /anchor/list` - List anchors
- `POST /identity/vc/issue` - Issue verifiable credential
- `GET /identity/vc` - List VCs

## Database Migrations

```bash
# Generate migrations
DATABASE_URL="your-connection-string" pnpm db:generate

# Apply migrations
DATABASE_URL="your-connection-string" pnpm db:push

# Or use migration script
DATABASE_URL="your-connection-string" pnpm db:migrate
```

## Building

```bash
pnpm build
```

Outputs to `dist/` directory.

## Deployment

See `infra/terraform/README.md` for GCP deployment instructions.


