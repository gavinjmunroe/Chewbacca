# Togari MCP

A **Model Context Protocol (MCP) server and API platform** for querying, enriching, and scoring lead data using natural language. Togari connects your BigQuery data warehouse to Claude Desktop (or any MCP-compatible client) so you can ask questions about contacts and deals in plain English.

Built as a TypeScript monorepo with four packages: a core library, an MCP server, a full-featured REST API, and a lightweight tool-oriented REST API.

---

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
  - [MCP Server (Claude Desktop)](#mcp-server-claude-desktop)
  - [MCP Server (HTTP/SSE Mode)](#mcp-server-httpsse-mode)
  - [API Server](#api-server)
  - [REST API Server](#rest-api-server)
- [Docker Deployment](#docker-deployment)
- [API Reference](#api-reference)
- [Lead Scoring System](#lead-scoring-system)
- [Project Structure](#project-structure)
- [Development](#development)
- [License](#license)

---

## Architecture

```
packages/
  core/                  Shared library: types, scoring, normalization, enrichment, pipeline
  final_mcp_server/      MCP server: natural-language BigQuery queries via Claude Desktop or HTTP/SSE
  api-server/            Full REST API: CRUD for people, companies, campaigns, enrichment, webhooks
  rest-api-server/       Lightweight REST API: tool-oriented endpoints for file processing and search
```

**Data flow (MCP Server):**

```
User question (natural language)
  -> Claude generates BigQuery SQL (read-only, SELECT only)
  -> BigQuery executes query
  -> Results returned as markdown tables
```

**Data flow (API Server):**

```
File upload / API call
  -> Parse & normalize (AI-powered via Claude)
  -> Extract entities (Structify)
  -> Enrich data (Exa / Clay)
  -> Score leads (internal + external factors)
  -> Store in GCP Cloud Storage
```

---

## Prerequisites

- **Node.js** >= 18
- **pnpm** >= 9.15.0 (`npm install -g pnpm`)
- **Google Cloud Platform** account with:
  - A GCP project
  - BigQuery dataset with your contacts/deals data
  - Cloud Storage bucket (for file uploads and data persistence)
  - Service account credentials (JSON key file)
- **Anthropic API key** (for Claude-powered SQL generation and data normalization)
- **Optional:** Exa API key (web search/enrichment), Clay API key (data enrichment), Structify API key (structured extraction)

---

## Installation

```bash
# Clone the repository
git clone https://github.com/karthikBMA/TogariMCP.git
cd TogariMCP

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

---

## Configuration

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

### Required Environment Variables

| Variable | Description |
|---|---|
| `GCP_PROJECT_ID` | Your Google Cloud project ID |
| `BIGQUERY_DATASET` | BigQuery dataset name (e.g. `togari_data`) |
| `BIGQUERY_TABLE` | BigQuery table name (e.g. `contacts`) |
| `ANTHROPIC_API_KEY` | Your Anthropic API key for Claude |
| `GCP_BUCKET_NAME` | GCS bucket for file storage |

### Optional Environment Variables

| Variable | Description |
|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to GCP service account JSON key file |
| `BIGQUERY_LOCATION` | BigQuery dataset location (default: `US`) |
| `EXA_API_KEY` | Exa API key for web search and enrichment |
| `CLAY_API_KEY` | Clay API key for data enrichment |
| `STRUCTIFY_API_KEY` | Structify API key for structured extraction |
| `PORT` | Server port (default: `3000`) |
| `LOG_LEVEL` | Logging level: `debug`, `info`, `warn`, `error` |
| `AUTH0_DOMAIN` | Auth0 domain for OAuth 2.1 (if using OAuth) |
| `AUTH0_AUDIENCE` | Auth0 audience identifier |
| `INTERNAL_API_KEY` | API key for internal-tier access (contacts + deals) |
| `EXTERNAL_API_KEY` | API key for external-tier access (contacts only) |
| `REDIS_URL` | Redis connection URL (for caching) |

---

## Usage

### MCP Server (Claude Desktop)

The MCP server exposes two tools to Claude Desktop:

- **`query_contacts`** - Query contact data using natural language
- **`query_deals`** - Query deal/pipeline data using natural language

#### Setup with Claude Desktop

1. Build the MCP server:

```bash
cd packages/final_mcp_server
pnpm build
```

2. Add the server to your Claude Desktop configuration file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "togari": {
      "command": "node",
      "args": ["/absolute/path/to/TogariMCP/packages/final_mcp_server/dist/index.js"],
      "env": {
        "GCP_PROJECT_ID": "your-project-id",
        "BIGQUERY_DATASET": "your-dataset",
        "BIGQUERY_TABLE": "your-table",
        "ANTHROPIC_API_KEY": "your-api-key",
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/service-account.json"
      }
    }
  }
}
```

3. Restart Claude Desktop. You should see the Togari tools available in the tools menu.

#### Example Queries

Once connected, you can ask Claude questions like:

- "Show me all contacts from California"
- "Find decision makers at companies with more than 500 employees"
- "What deals are in the pipeline stage?"
- "List contacts who were added in the last 30 days"

The MCP server translates these into BigQuery SQL, executes the query, and returns formatted results.

### MCP Server (HTTP/SSE Mode)

For web clients or non-Claude-Desktop integrations, run the server in HTTP mode:

```bash
cd packages/final_mcp_server
pnpm build

# Set transport mode
export MCP_TRANSPORT=sse
export PORT=3000

node dist/index.js
```

This exposes:
- `GET /sse` - Server-Sent Events endpoint for real-time communication
- `POST /messages` - Send messages to the MCP server
- `GET /health` - Health check

#### Authentication (HTTP Mode)

HTTP mode supports two auth methods:

1. **API Key** - Pass via `x-api-key` header:
   - Internal key: access to contacts + deals
   - External key: access to contacts only

2. **OAuth 2.1** - JWT tokens validated against Auth0 JWKS endpoint (requires `AUTH0_DOMAIN` and `AUTH0_AUDIENCE` configuration)

### API Server

The full-featured REST API provides CRUD operations for all entities:

```bash
cd packages/api-server
pnpm build
pnpm start
```

The server starts on the configured port (default `3000`). See [API Reference](#api-reference) for endpoints.

### REST API Server

The lightweight, tool-oriented REST API is designed for file processing and search workflows:

```bash
cd packages/rest-api-server
pnpm build
pnpm start
```

---

## Docker Deployment

A Dockerfile is provided for the MCP server:

```bash
cd packages/final_mcp_server

# Build the image
docker build -t togari-mcp .

# Run the container
docker run -p 3000:3000 \
  -e GCP_PROJECT_ID=your-project-id \
  -e BIGQUERY_DATASET=your-dataset \
  -e BIGQUERY_TABLE=your-table \
  -e ANTHROPIC_API_KEY=your-api-key \
  -e MCP_TRANSPORT=sse \
  -v /path/to/service-account.json:/app/credentials.json \
  -e GOOGLE_APPLICATION_CREDENTIALS=/app/credentials.json \
  togari-mcp
```

---

## API Reference

### API Server Endpoints (`api-server`)

**Base path:** `/api/v1`

| Method | Path | Description |
|---|---|---|
| GET | `/people` | List people (with pagination, sorting, filters) |
| GET | `/people/:id` | Get person by ID |
| POST | `/people` | Create person (auto-scores, checks duplicates) |
| PUT | `/people/:id` | Update person (recalculates score) |
| DELETE | `/people/:id` | Delete person |
| GET | `/people/:id/touchpoints` | Get touchpoints for a person |
| POST | `/people/:id/score` | Recalculate person's lead score |
| GET | `/companies` | List companies |
| POST | `/companies` | Create company |
| POST | `/enrichment/person` | Enrich a person via Exa or Clay |
| POST | `/enrichment/company` | Enrich a company via Exa or Clay |
| POST | `/enrichment/search` | Neural search via Exa |
| POST | `/enrichment/batch` | Batch enrichment (concurrency: 5) |
| GET | `/campaigns` | List campaigns |
| POST | `/campaigns` | Create campaign |
| GET | `/webhooks` | List webhooks |
| POST | `/files` | Upload and process files |

### REST API Server Endpoints (`rest-api-server`)

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/tools` | List available tool endpoints |
| POST | `/tools/process-file` | Upload and process a file for entity extraction |
| POST | `/tools/search` | Search entities using natural language |
| POST | `/tools/enrich` | Enrich a single entity |
| POST | `/tools/job-status` | Check processing job status |
| POST | `/tools/preview` | Preview file parsing without processing |

---

## Lead Scoring System

Togari includes a built-in lead scoring engine that calculates composite scores for routing leads.

### Internal Score (0-100)

Four factors, each scored 0-25:

| Factor | Description | Max Score |
|---|---|---|
| **Channel** | Source channel quality (warm referral = 25, cold outbound = 10) | 25 |
| **Budget** | Company size by employee count (501+ = 25, 1-10 = 5) | 25 |
| **Authority** | Title-based role detection (decision maker = 25, influencer = 18) | 25 |
| **GTM Maturity** | Tech stack sophistication (Salesforce/HubSpot = 25, spreadsheets = 10) | 25 |

### External Score (0-100)

Three factors:

| Factor | Description | Max Score |
|---|---|---|
| **Vertical Fit** | Industry keyword matching against healthcare verticals | 50 |
| **Engagement Signals** | Touch count and recency of contact | 30 |
| **Timing Indicators** | Positive signals (hiring, funding) vs negative (layoffs) | 20 |

### Composite Score & Routing

The composite score is a 50/50 weighted average of internal and external scores:

| Tier | Score Range | Action |
|---|---|---|
| **High Touch** | 80 - 100 | Priority outreach |
| **Standard** | 60 - 79 | Normal sales flow |
| **Nurture** | 40 - 59 | Marketing nurture sequence |
| **Disqualify** | 0 - 39 | Not a fit |

---

## Project Structure

```
TogariMCP/
  package.json              Root monorepo config (pnpm workspaces + Turborepo)
  pnpm-workspace.yaml       Workspace definition
  turbo.json                Turborepo task configuration
  tsconfig.base.json        Shared TypeScript config (ES2022, strict)
  .env.example              Environment variable reference

  packages/
    core/                   @togari/core - Shared library
      src/
        types/              Entity types (Person, Company, Campaign, etc.)
        constants/          Business rules, scoring thresholds, vertical keywords
        errors/             Custom error classes
        utils/              Validation, retry logic, hashing, logging
        services/
          scoring/          Lead scoring engine
          normalizer/       AI-powered data normalization (Claude)
          enrichment/       Exa, Clay, Structify clients
          pipeline/         File processing orchestration
          storage/          GCP Cloud Storage client

    final_mcp_server/       @togari/mcp-server - MCP Server
      src/
        index.ts            Server entry (stdio + SSE transports)
        config.ts           Configuration loader
        oauth.ts            Auth0 OAuth 2.1 implementation
        services/
          sql-generator.ts  Natural language -> BigQuery SQL (Claude)
          bigquery-client.ts BigQuery query execution
        tools/
          query-contacts.ts Contact query tool handler
      Dockerfile            Multi-stage Docker build

    api-server/             @togari/api-server - Full REST API
      src/
        index.ts            Entry point
        app.ts              Express app with all route mounts
        middleware.ts        Auth, validation, error handling
        services.ts         Service initialization
        routes/             Route handlers for each entity

    rest-api-server/        @togari/rest-api-server - Tool REST API
      src/
        index.ts            Entry point
        api/routes.ts       Tool-oriented API routes
        tools/
          schemas.ts        Zod input validation schemas
          handlers.ts       Tool handler implementations
```

---

## Development

```bash
# Start all packages in dev mode (with hot reload)
pnpm dev

# Build all packages
pnpm build

# Run linting
pnpm lint

# Run a specific package
pnpm --filter @togari/mcp-server dev
pnpm --filter @togari/api-server dev
pnpm --filter @togari/rest-api-server dev
```

### Adding a New Package

1. Create a directory under `packages/`
2. Add a `package.json` with the `@togari/` namespace
3. Reference `@togari/core` as a workspace dependency if needed
4. The package will be auto-detected by pnpm workspaces

---

## License

See [LICENSE](./LICENSE) for details.
