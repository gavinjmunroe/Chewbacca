# Togari MCP - Healthcare Data Integration Platform

## Executive Summary

**Togari MCP** is a Model Context Protocol (MCP) server architecture that integrates multiple healthcare data APIs (Exa, Structify, Happenstance, Serif Health) with a BigQuery data warehouse for healthcare procurement and operations.

**Key Components:**
- **MCP Servers**: Pluggable API integrations (Exa, Structify, Happenstance, Serif Health, etc.)
- **Data Warehouse**: Google BigQuery (primary storage)
- **Pipeline**: Structify (data transformation and enrichment pipeline only)
- **API Layer**: tRPC-based API for frontend consumption
- **Orchestration**: Background jobs for data sync and enrichment

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND LAYER                           │
│              (Lovable / Custom React / Mobile)              │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP/tRPC
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   TOGARI API SERVER                         │
│              (Express + tRPC + Auth)                        │
└────────────┬────────────────────────────────┬───────────────┘
             │                                 │
             │                                 │
    ┌────────▼────────┐              ┌────────▼────────┐
    │  MCP SERVERS    │              │  BIGQUERY       │
    │                 │              │  DATA WAREHOUSE │
    │  • Exa          │◄─────────────┤                 │
    │  • Structify    │              │  • raw_data     │
    │  • Happenstance │              │  • enriched     │
    │  • Serif Health │              │  • analytics    │
    │  • Custom APIs  │              │  • procurement  │
    └─────────────────┘              └─────────────────┘
             │
             │ Pipeline
             ▼
    ┌─────────────────┐
    │   STRUCTIFY     │
    │  (Transform &   │
    │   Enrich Only)  │
    └─────────────────┘
```

### Data Flow

1. **Ingestion**: MCP servers pull data from external APIs
2. **Raw Storage**: Data lands in BigQuery `raw_data` dataset
3. **Enrichment**: Structify pipeline enriches and transforms data
4. **Analytics Storage**: Enriched data stored in BigQuery `enriched` dataset
5. **API Consumption**: tRPC API serves data to frontends

---

## Project Structure

```
togari-mcp/
├── packages/
│   ├── core/                    # Shared types and utilities
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── healthcare.ts    # Healthcare-specific types
│   │   │   │   ├── procurement.ts   # Procurement types
│   │   │   │   └── bigquery.ts      # BigQuery schema types
│   │   │   └── schemas/             # Zod validation schemas
│   │   └── package.json
│   │
│   ├── mcp-exa/                 # Exa MCP server
│   │   ├── src/
│   │   │   ├── server.ts        # MCP server implementation
│   │   │   ├── client.ts        # Exa API client
│   │   │   └── schemas.ts       # Exa data schemas
│   │   └── package.json
│   │
│   ├── mcp-structify/           # Structify MCP server
│   │   ├── src/
│   │   │   ├── server.ts        # MCP server implementation
│   │   │   ├── pipeline.ts      # Data transformation pipeline
│   │   │   └── enrichment.ts    # Enrichment logic
│   │   └── package.json
│   │
│   ├── mcp-happenstance/        # Happenstance MCP server
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   └── client.ts
│   │   └── package.json
│   │
│   ├── mcp-serif/               # Serif Health MCP server
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   └── client.ts
│   │   └── package.json
│   │
│   ├── bigquery/                # BigQuery data warehouse
│   │   ├── src/
│   │   │   ├── client.ts        # BigQuery client wrapper
│   │   │   ├── schemas/         # Table schemas
│   │   │   │   ├── raw_data.ts
│   │   │   │   ├── enriched.ts
│   │   │   │   ├── analytics.ts
│   │   │   │   └── procurement.ts
│   │   │   ├── migrations/      # Schema migrations
│   │   │   └── queries/         # Common queries
│   │   └── package.json
│   │
│   ├── api/                     # Main API server
│   │   ├── src/
│   │   │   ├── server.ts        # Express + tRPC server
│   │   │   ├── router/
│   │   │   │   ├── healthcare.ts
│   │   │   │   ├── procurement.ts
│   │   │   │   ├── enrichment.ts
│   │   │   │   └── analytics.ts
│   │   │   ├── mcp/             # MCP server registry
│   │   │   │   └── registry.ts  # Load and manage MCP servers
│   │   │   └── jobs/            # Background jobs
│   │   └── package.json
│   │
│   └── workers/                 # Background job processors
│       ├── src/
│       │   ├── sync-worker.ts   # Sync data from MCP to BigQuery
│       │   ├── enrich-worker.ts # Enrichment pipeline
│       │   └── queue.ts         # Job queue management
│       └── package.json
│
├── infrastructure/
│   ├── gcp/
│   │   ├── bigquery/
│   │   │   ├── datasets.sql     # Dataset creation scripts
│   │   │   ├── tables/          # Table DDL
│   │   │   └── views/           # Analytical views
│   │   ├── iam/
│   │   │   └── service-accounts.tf
│   │   └── terraform/           # Infrastructure as code
│   │       ├── main.tf
│   │       ├── bigquery.tf
│   │       └── variables.tf
│   │
│   └── docker/
│       ├── Dockerfile.api
│       ├── Dockerfile.workers
│       └── docker-compose.yml
│
├── docs/
│   ├── MCP_ARCHITECTURE.md      # MCP server design
│   ├── BIGQUERY_SCHEMA.md       # Data warehouse schema
│   ├── DATA_PIPELINE.md         # Pipeline documentation
│   └── API_REFERENCE.md         # API documentation
│
├── .env.example
├── README.md
└── README_HEAD_OF_DATA.md       # This file
```

---

## BigQuery Data Warehouse Schema

### Datasets

#### 1. **`raw_data`** - Raw ingestion from MCP servers
```sql
-- People/contacts from various sources
raw_data.people
  - person_id STRING
  - source_system STRING  -- 'exa', 'happenstance', 'serif', etc.
  - source_id STRING
  - data JSON            -- Raw JSON from source
  - ingested_at TIMESTAMP
  - organization_id STRING

-- Companies/organizations
raw_data.companies
  - company_id STRING
  - source_system STRING
  - source_id STRING
  - data JSON
  - ingested_at TIMESTAMP

-- Healthcare providers
raw_data.providers
  - provider_id STRING
  - npi STRING           -- National Provider Identifier
  - source_system STRING
  - data JSON
  - ingested_at TIMESTAMP

-- Procurement data
raw_data.procurement_transactions
  - transaction_id STRING
  - source_system STRING
  - data JSON
  - ingested_at TIMESTAMP
```

#### 2. **`enriched`** - Enriched and transformed data
```sql
-- Enriched people with standardized fields
enriched.people
  - person_id STRING
  - full_name STRING
  - email STRING
  - phone STRING
  - linkedin_url STRING
  - current_title STRING
  - current_company STRING
  - healthcare_vertical STRING
  - enrichment_sources ARRAY<STRING>
  - enriched_at TIMESTAMP
  - organization_id STRING

-- Enriched companies
enriched.companies
  - company_id STRING
  - name STRING
  - domain STRING
  - industry STRING
  - employee_count INT64
  - revenue_range STRING
  - healthcare_focus BOOLEAN
  - enrichment_complete BOOLEAN
  - enriched_at TIMESTAMP

-- Healthcare provider directory
enriched.providers
  - provider_id STRING
  - npi STRING
  - full_name STRING
  - specialty ARRAY<STRING>
  - practice_type STRING
  - location GEOGRAPHY
  - accepting_patients BOOLEAN
  - enriched_at TIMESTAMP
```

#### 3. **`analytics`** - Aggregated analytics tables
```sql
-- Lead scoring and analytics
analytics.lead_scores
  - person_id STRING
  - internal_score FLOAT64
  - external_score FLOAT64
  - composite_score FLOAT64
  - routing_tier STRING
  - calculated_at TIMESTAMP

-- Procurement analytics
analytics.procurement_metrics
  - date DATE
  - product_category STRING
  - total_transactions INT64
  - total_value FLOAT64
  - average_transaction_value FLOAT64
  - top_vendors ARRAY<STRUCT<vendor STRING, transaction_count INT64>>
```

#### 4. **`procurement`** - Healthcare procurement specific
```sql
-- Medical equipment and supplies
procurement.equipment
  - equipment_id STRING
  - product_name STRING
  - manufacturer STRING
  - category STRING
  - unit_cost FLOAT64
  - last_updated TIMESTAMP

-- Vendors
procurement.vendors
  - vendor_id STRING
  - name STRING
  - categories ARRAY<STRING>
  - rating FLOAT64
  - certification_level STRING

-- Purchase orders
procurement.purchase_orders
  - po_id STRING
  - vendor_id STRING
  - items ARRAY<STRUCT<...>>
  - total_amount FLOAT64
  - status STRING
  - created_at TIMESTAMP
```

---

## MCP Server Architecture

### What is MCP?

**Model Context Protocol (MCP)** is a standard for building composable, pluggable data integrations. Each MCP server is a self-contained module that:
1. Connects to an external API
2. Exposes standardized methods
3. Can be loaded/unloaded dynamically
4. Runs independently

### MCP Server Interface

Each MCP server implements:

```typescript
interface MCPServer {
  // Metadata
  name: string;
  version: string;
  description: string;

  // Methods
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // Data operations
  fetch(params: FetchParams): Promise<Data[]>;
  transform(data: any): Promise<TransformedData>;

  // Health check
  healthCheck(): Promise<HealthStatus>;
}
```

### Example: Exa MCP Server

```typescript
// packages/mcp-exa/src/server.ts
export class ExaMCPServer implements MCPServer {
  name = 'exa';
  version = '1.0.0';

  async fetch(params: { query: string }): Promise<ExaResult[]> {
    // Call Exa API
    const results = await this.client.search(params.query);
    return results;
  }

  async transform(data: ExaResult): Promise<EnrichedData> {
    // Transform Exa result to standard format
    return {
      source: 'exa',
      data: {
        // Standardized fields
      }
    };
  }
}
```

---

## Data Pipeline Flow

### 1. Ingestion (MCP → BigQuery Raw)

```typescript
// Background worker syncs data from MCP servers to BigQuery
async function syncMCPToBigQuery(mcpServer: MCPServer) {
  // Fetch from MCP
  const data = await mcpServer.fetch({ since: lastSync });

  // Insert into BigQuery raw_data
  await bigquery
    .dataset('raw_data')
    .table('people')
    .insert(data.map(d => ({
      person_id: generateId(),
      source_system: mcpServer.name,
      source_id: d.id,
      data: JSON.stringify(d),
      ingested_at: new Date(),
      organization_id: d.orgId
    })));
}
```

### 2. Enrichment (Structify Pipeline)

```typescript
// Structify reads from raw_data, enriches, writes to enriched
async function runEnrichmentPipeline() {
  // Read raw data
  const rawPeople = await bigquery.query(`
    SELECT * FROM raw_data.people
    WHERE ingested_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
  `);

  // Send to Structify for enrichment
  for (const person of rawPeople) {
    const enriched = await structify.enrich(person.data);

    // Write back to BigQuery enriched dataset
    await bigquery
      .dataset('enriched')
      .table('people')
      .insert({
        person_id: person.person_id,
        full_name: enriched.fullName,
        email: enriched.email,
        // ... standardized fields
        enriched_at: new Date()
      });
  }
}
```

### 3. Analytics (BigQuery → Materialized Views)

```sql
-- Create materialized view for analytics
CREATE MATERIALIZED VIEW analytics.daily_procurement_summary AS
SELECT
  DATE(created_at) as date,
  vendor_id,
  COUNT(*) as transaction_count,
  SUM(total_amount) as total_value,
  AVG(total_amount) as avg_transaction_value
FROM procurement.purchase_orders
GROUP BY date, vendor_id;
```

---

## Setup Instructions

### Prerequisites

1. **Google Cloud Platform Account**
   - Project with billing enabled
   - BigQuery API enabled
   - Service account with BigQuery Admin role

2. **Node.js & pnpm**
   ```bash
   node --version  # >= 20.0.0
   pnpm --version  # >= 9.0.0
   ```

3. **API Keys**
   - Exa API key
   - Structify API key
   - Happenstance API key
   - Serif Health API credentials

### Step 1: GCP Setup

```bash
# 1. Create GCP project
gcloud projects create togari-prod --name="Togari Production"
gcloud config set project togari-prod

# 2. Enable APIs
gcloud services enable bigquery.googleapis.com
gcloud services enable bigquerystorage.googleapis.com

# 3. Create service account
gcloud iam service-accounts create togari-service \
  --display-name="Togari Service Account"

# 4. Grant BigQuery permissions
gcloud projects add-iam-policy-binding togari-prod \
  --member="serviceAccount:togari-service@togari-prod.iam.gserviceaccount.com" \
  --role="roles/bigquery.admin"

# 5. Create and download key
gcloud iam service-accounts keys create ./gcp-key.json \
  --iam-account=togari-service@togari-prod.iam.gserviceaccount.com
```

### Step 2: BigQuery Schema Setup

```bash
# Create datasets
bq mk --dataset --location=US togari-prod:raw_data
bq mk --dataset --location=US togari-prod:enriched
bq mk --dataset --location=US togari-prod:analytics
bq mk --dataset --location=US togari-prod:procurement

# Create tables from schema files
cd infrastructure/gcp/bigquery
bq mk --table togari-prod:raw_data.people tables/raw_data_people.json
bq mk --table togari-prod:enriched.people tables/enriched_people.json
# ... repeat for all tables
```

### Step 3: Install Dependencies

```bash
# Install all packages
pnpm install

# Build packages
pnpm build
```

### Step 4: Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env
```

**Required Environment Variables:**
```env
# GCP / BigQuery
GCP_PROJECT_ID=togari-prod
GCP_KEY_FILE=./gcp-key.json
BIGQUERY_DATASET_RAW=raw_data
BIGQUERY_DATASET_ENRICHED=enriched
BIGQUERY_DATASET_ANALYTICS=analytics

# MCP API Keys
EXA_API_KEY=your_exa_key
STRUCTIFY_API_KEY=your_structify_key
HAPPENSTANCE_API_KEY=your_happenstance_key
SERIF_HEALTH_CLIENT_ID=your_serif_client_id
SERIF_HEALTH_CLIENT_SECRET=your_serif_secret

# API Server
PORT=4000
NODE_ENV=development

# Amber Integration
AMBER_API_KEY=dev_test_key
AMBER_WEBHOOK_SECRET=your_webhook_secret
```

### Step 5: Run the System

```bash
# Terminal 1: Start API server
pnpm --filter @togari/api dev

# Terminal 2: Start background workers
pnpm --filter @togari/workers dev

# Terminal 3: (Optional) Run one-time sync
pnpm --filter @togari/workers sync
```

---

## MCP Server Development

### Adding a New MCP Server

1. **Create package structure:**
```bash
mkdir -p packages/mcp-<name>/src
cd packages/mcp-<name>
```

2. **Implement MCP interface:**
```typescript
// packages/mcp-<name>/src/server.ts
import { MCPServer } from '@togari/core';

export class NewMCPServer implements MCPServer {
  name = 'new-api';
  version = '1.0.0';

  async initialize() {
    // Setup API client
  }

  async fetch(params: any) {
    // Fetch data from external API
  }

  async transform(data: any) {
    // Transform to standard format
  }

  async healthCheck() {
    // Check API connectivity
  }
}
```

3. **Register in MCP registry:**
```typescript
// packages/api/src/mcp/registry.ts
import { NewMCPServer } from '@togari/mcp-new';

export const mcpServers = {
  'new-api': new NewMCPServer(),
  'exa': new ExaMCPServer(),
  // ... other servers
};
```

4. **Add to sync worker:**
```typescript
// packages/workers/src/sync-worker.ts
await syncMCPToBigQuery(mcpServers['new-api']);
```

---

## Data Access Patterns

### Reading from BigQuery (API Layer)

```typescript
// packages/api/src/router/healthcare.ts
export const healthcareRouter = t.router({
  listProviders: publicProcedure
    .input(z.object({ specialty: z.string() }))
    .query(async ({ input }) => {
      const [rows] = await bigquery.query(`
        SELECT
          provider_id,
          full_name,
          specialty,
          location
        FROM enriched.providers
        WHERE specialty LIKE '%${input.specialty}%'
        LIMIT 100
      `);
      return rows;
    }),
});
```

### Writing to BigQuery (Worker)

```typescript
// packages/workers/src/enrich-worker.ts
async function enrichAndStore(personId: string) {
  // Fetch raw data
  const [rows] = await bigquery.query(`
    SELECT * FROM raw_data.people WHERE person_id = '${personId}'
  `);

  // Enrich via Structify
  const enriched = await structify.enrich(rows[0].data);

  // Write to enriched dataset
  await bigquery
    .dataset('enriched')
    .table('people')
    .insert({
      person_id: personId,
      ...enriched,
      enriched_at: new Date()
    });
}
```

---

## Monitoring & Operations

### Health Checks

```bash
# Check API health
curl http://localhost:4000/health

# Check MCP servers
curl http://localhost:4000/health/mcp

# Check BigQuery connectivity
curl http://localhost:4000/health/bigquery
```

### Monitoring Queries

```sql
-- Check ingestion lag
SELECT
  source_system,
  MAX(ingested_at) as last_ingestion,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(ingested_at), MINUTE) as lag_minutes
FROM raw_data.people
GROUP BY source_system;

-- Check enrichment status
SELECT
  COUNT(*) as total_raw,
  SUM(CASE WHEN e.person_id IS NOT NULL THEN 1 ELSE 0 END) as enriched_count,
  ROUND(SUM(CASE WHEN e.person_id IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) as enrichment_rate
FROM raw_data.people r
LEFT JOIN enriched.people e USING(person_id);
```

### Logging

All logs go to Google Cloud Logging:
```bash
# View logs
gcloud logging read "resource.type=cloud_function" --limit 50

# Follow logs in real-time
gcloud logging tail "resource.type=cloud_function"
```

---

## Cost Estimation

### BigQuery Costs
- **Storage**: $0.02 per GB/month (first 10GB free)
- **Queries**: $5 per TB processed (first 1TB/month free)
- **Streaming inserts**: $0.01 per 200MB

**Estimated monthly cost for 1M records:**
- Storage: ~50GB = $1/month
- Queries: ~100GB processed = $0.50/month
- Streaming: ~10GB = $0.50/month
- **Total: ~$2/month**

### MCP API Costs
- Exa: Pay per search
- Structify: Pipeline usage-based
- Happenstance: API call-based
- Serif Health: Contract-based

---

## Security

### IAM Roles

```bash
# Grant least privilege access
gcloud projects add-iam-policy-binding togari-prod \
  --member="serviceAccount:togari-service@togari-prod.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataEditor" \
  --condition="expression=resource.name.startsWith('projects/togari-prod/datasets/raw_data'),title=raw_data_access"
```

### Data Encryption
- At rest: Google-managed encryption keys
- In transit: TLS 1.3
- API keys: Stored in Google Secret Manager

### Row-Level Security

```sql
-- Create row-level policy
CREATE ROW ACCESS POLICY org_filter
ON enriched.people
GRANT TO ('user:data-analyst@togari.com')
FILTER USING (organization_id = SESSION_USER());
```

---

## Backup & Disaster Recovery

### Automated Backups

```bash
# BigQuery automatically retains 7 days of snapshots
# Restore from snapshot:
bq cp togari-prod:enriched.people@-3600000 togari-prod:enriched.people_restored
```

### Export Strategy

```bash
# Daily exports to Cloud Storage
bq extract \
  --destination_format=AVRO \
  --compression=SNAPPY \
  togari-prod:enriched.people \
  gs://togari-backups/enriched.people/$(date +%Y%m%d)/*.avro
```

---

## Roadmap

### Phase 1: Foundation (Current)
- ✅ MCP server architecture
- ✅ BigQuery schema design
- 🔲 4 MCP servers (Exa, Structify, Happenstance, Serif)
- 🔲 Basic API with tRPC
- 🔲 Background sync workers

### Phase 2: Enrichment (Month 2)
- 🔲 Structify enrichment pipeline
- 🔲 AI-powered data enhancement
- 🔲 Deduplication logic
- 🔲 Data quality scoring

### Phase 3: Analytics (Month 3)
- 🔲 Materialized views
- 🔲 Procurement analytics
- 🔲 Healthcare provider insights
- 🔲 Looker Studio dashboards

### Phase 4: Scale (Month 4+)
- 🔲 Real-time streaming (Pub/Sub)
- 🔲 ML models in BigQuery ML
- 🔲 Advanced orchestration (Airflow)
- 🔲 Multi-region deployment

---

## Support & Contact

**Technical Lead**: [Your Name]
**Head of Data**: [Name to be filled in]
**Repository**: https://github.com/togari/togari-mcp
**Documentation**: https://docs.togari.com

---

## Quick Reference

### Common Commands

```bash
# Development
pnpm dev                          # Start all services
pnpm build                        # Build all packages
pnpm test                         # Run tests

# BigQuery
bq query --use_legacy_sql=false   # Run query
bq ls -d togari-prod              # List datasets
bq show togari-prod:raw_data.people  # Show table schema

# GCP
gcloud config set project togari-prod
gcloud auth application-default login

# MCP
pnpm --filter @togari/mcp-exa test       # Test Exa server
pnpm --filter @togari/workers sync       # Manual sync
```

### Useful BigQuery Queries

```sql
-- Check data freshness
SELECT source_system, MAX(ingested_at) FROM raw_data.people GROUP BY 1;

-- Count records by source
SELECT source_system, COUNT(*) FROM raw_data.people GROUP BY 1;

-- Check enrichment pipeline
SELECT COUNT(*) FROM raw_data.people r
LEFT JOIN enriched.people e USING(person_id)
WHERE e.person_id IS NULL;
```

---

**Last Updated**: January 2026
**Version**: 1.0.0
