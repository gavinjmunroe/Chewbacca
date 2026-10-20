# Togari MCP - Handoff Summary

## What Changed

### 1. **Project Renamed**
- `togari-api` → `togari-mcp`
- Reflects MCP (Model Context Protocol) architecture

### 2. **Architecture Shift**
- **Old**: Structify as primary data store
- **New**: BigQuery as data warehouse, Structify as enrichment pipeline only

### 3. **MCP Server Design**
- Pluggable integrations for: Exa, Structify, Happenstance, Serif Health
- Each MCP server is independent and composable
- Easy to add new data sources

---

## Key Files for Your Head of Data

### 📘 **README_HEAD_OF_DATA.md** (MOST IMPORTANT)
**60+ pages of complete technical documentation:**

#### What's Inside:
1. **Executive Summary** - High-level overview
2. **Architecture Diagram** - Visual system design
3. **Project Structure** - Complete codebase organization
4. **BigQuery Schema** - All datasets and tables with DDL
5. **MCP Server Architecture** - How to build/extend integrations
6. **Data Pipeline Flow** - End-to-end data journey
7. **Setup Instructions** - Step-by-step GCP/BigQuery setup
8. **MCP Development Guide** - How to add new servers
9. **Data Access Patterns** - Read/write examples
10. **Monitoring & Operations** - Health checks, queries
11. **Cost Estimation** - BigQuery pricing breakdown
12. **Security** - IAM, encryption, row-level security
13. **Backup & DR** - Disaster recovery procedures
14. **Roadmap** - Phase-by-phase implementation plan
15. **Quick Reference** - Common commands and queries

### 📄 **README.md**
Quick start guide with architecture overview and basic commands.

### ⚙️ **.env.example**
Environment variables template with:
- GCP/BigQuery configuration
- MCP API keys for all services
- Worker/queue settings

---

## BigQuery Data Warehouse

### Datasets (4 Total)

#### 1. `raw_data` - Raw API ingestion
```
Tables:
- people (from all MCP sources)
- companies
- providers (healthcare providers with NPI)
- procurement_transactions
```

#### 2. `enriched` - Standardized cleaned data
```
Tables:
- people (enriched with Structify)
- companies (firmographic data)
- providers (full provider directory)
```

#### 3. `analytics` - Aggregated metrics
```
Tables:
- lead_scores
- procurement_metrics
- daily_summaries
```

#### 4. `procurement` - Healthcare procurement
```
Tables:
- equipment
- vendors
- purchase_orders
```

---

## MCP Servers (4 Planned)

| Server | Purpose | Data Type |
|--------|---------|-----------|
| **mcp-exa** | AI search, research | Web content, competitive intel |
| **mcp-structify** | Enrichment pipeline | Enriched person/company data |
| **mcp-happenstance** | Healthcare data | Provider info, claims data |
| **mcp-serif** | Provider directory | NPI data, credentialing |

Each MCP server:
- Fetches from external API
- Transforms to standard format
- Writes to BigQuery `raw_data`
- Triggers enrichment pipeline

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────┐
│  STEP 1: INGESTION (MCP Servers)                        │
│  - Exa fetches research data                            │
│  - Happenstance fetches provider data                   │
│  - Serif fetches NPI directory                          │
│  → ALL write to BigQuery raw_data.*                     │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 2: RAW STORAGE (BigQuery raw_data)                │
│  - raw_data.people                                       │
│  - raw_data.providers                                    │
│  - raw_data.companies                                    │
│  → Indexed by source_system + source_id                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 3: ENRICHMENT (Structify Pipeline)                │
│  - Reads from raw_data.*                                 │
│  - Enriches with LinkedIn, email, company data          │
│  - Standardizes fields                                   │
│  → Writes to BigQuery enriched.*                        │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 4: ANALYTICS (BigQuery Materialized Views)        │
│  - Aggregates enriched data                             │
│  - Creates metrics and KPIs                              │
│  → Stored in analytics.*                                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 5: API ACCESS (tRPC API)                          │
│  - Queries BigQuery on demand                           │
│  - Serves data to Lovable/React frontends               │
│  → Type-safe API responses                              │
└─────────────────────────────────────────────────────────┘
```

---

## What's Built vs. To Build

### ✅ Built (Foundation)
- Monorepo structure (Turborepo)
- Core types and schemas (TypeScript)
- API server structure (Express + tRPC)
- Documentation (60+ pages)
- Architecture design
- BigQuery schema design
- Environment configuration

### 🔲 To Build (Implementation)
1. **BigQuery Client** (`packages/bigquery`)
   - Client wrapper
   - Table schemas as code
   - Query builders
   - Migrations

2. **MCP Servers** (`packages/mcp-*`)
   - Exa integration
   - Structify pipeline
   - Happenstance integration
   - Serif Health integration

3. **Workers** (`packages/workers`)
   - Sync worker (MCP → BigQuery)
   - Enrichment worker (raw → enriched)
   - Job queue (BullMQ)

4. **API Routers** (`packages/api/src/router`)
   - Healthcare data endpoints
   - Procurement endpoints
   - Analytics endpoints

---

## GCP Setup Required

### 1. Create GCP Project
```bash
gcloud projects create togari-prod
gcloud config set project togari-prod
```

### 2. Enable BigQuery
```bash
gcloud services enable bigquery.googleapis.com
gcloud services enable bigquerystorage.googleapis.com
```

### 3. Create Service Account
```bash
gcloud iam service-accounts create togari-service
gcloud projects add-iam-policy-binding togari-prod \
  --member="serviceAccount:togari-service@togari-prod.iam.gserviceaccount.com" \
  --role="roles/bigquery.admin"
```

### 4. Generate Key
```bash
gcloud iam service-accounts keys create ./gcp-key.json \
  --iam-account=togari-service@togari-prod.iam.gserviceaccount.com
```

### 5. Create BigQuery Datasets
```bash
bq mk --dataset --location=US togari-prod:raw_data
bq mk --dataset --location=US togari-prod:enriched
bq mk --dataset --location=US togari-prod:analytics
bq mk --dataset --location=US togari-prod:procurement
```

**All details in README_HEAD_OF_DATA.md → "Setup Instructions"**

---

## Cost Estimation

### BigQuery (For 1M Records)
- **Storage**: 50GB @ $0.02/GB = $1/month
- **Queries**: 100GB processed @ $5/TB = $0.50/month
- **Streaming**: 10GB @ $0.01/200MB = $0.50/month
- **Total**: ~$2/month

### MCP APIs
- Exa: Pay per search (~$50-200/month)
- Structify: Pipeline usage (~$100-300/month)
- Happenstance: API calls (pricing varies)
- Serif Health: Contract-based

**Estimated Total: $200-500/month for full system**

---

## Development Workflow

### For Data Team

1. **Build MCP Server**
   ```bash
   cd packages/mcp-<name>
   # Implement MCPServer interface
   # Add to registry in packages/api/src/mcp/registry.ts
   ```

2. **Define BigQuery Schema**
   ```bash
   cd packages/bigquery/src/schemas
   # Add TypeScript schema definition
   # Generate DDL
   ```

3. **Build Worker**
   ```bash
   cd packages/workers/src
   # Implement sync logic: MCP → BigQuery
   # Add enrichment: raw → enriched
   ```

4. **Test Pipeline**
   ```bash
   pnpm --filter @togari/workers sync
   # Verify data in BigQuery console
   ```

5. **Add API Endpoint**
   ```bash
   cd packages/api/src/router
   # Add tRPC procedure
   # Query BigQuery
   # Return to frontend
   ```

---

## Monitoring

### Health Checks
```bash
# API health
curl http://localhost:4000/health

# MCP servers status
curl http://localhost:4000/health/mcp

# BigQuery connectivity
curl http://localhost:4000/health/bigquery
```

### BigQuery Queries
```sql
-- Data freshness
SELECT source_system, MAX(ingested_at)
FROM raw_data.people
GROUP BY 1;

-- Enrichment status
SELECT
  COUNT(*) as raw_count,
  SUM(CASE WHEN e.person_id IS NOT NULL THEN 1 ELSE 0 END) as enriched_count
FROM raw_data.people r
LEFT JOIN enriched.people e USING(person_id);

-- Procurement metrics
SELECT
  DATE(created_at) as date,
  COUNT(*) as transactions,
  SUM(total_amount) as total_value
FROM procurement.purchase_orders
GROUP BY 1
ORDER BY 1 DESC;
```

---

## Security Considerations

### Data Access
- Row-level security by `organization_id`
- IAM roles for least privilege
- Service account key rotation (90 days)

### PII/PHI
- **No PHI stored** - this is CRM/procurement data, not patient records
- PII (names, emails) encrypted at rest (Google-managed keys)
- TLS 1.3 for data in transit

### API Security
- API key authentication
- Rate limiting (100 req/15min)
- CORS configuration for approved origins

---

## Next Steps for Head of Data

1. **Read README_HEAD_OF_DATA.md** (60 pages - covers everything)

2. **Set up GCP**
   - Create project
   - Enable BigQuery
   - Create service account
   - Generate key

3. **Build BigQuery Client** (`packages/bigquery`)
   - Start here - foundation for everything
   - Schemas, client, migrations

4. **Build One MCP Server** (recommend Exa first)
   - Proves the pattern
   - End-to-end data flow
   - Reference for others

5. **Build Sync Worker**
   - MCP → BigQuery pipeline
   - Scheduled jobs

6. **Add Enrichment**
   - Structify pipeline
   - raw → enriched flow

---

## Questions to Clarify

For your head of data to answer:

1. **GCP Account**: Do we have a GCP account? Need to create project?
2. **BigQuery Region**: US (multi-region) or specific region (e.g., us-central1)?
3. **Data Retention**: How long to keep raw_data before archiving?
4. **API Prioritization**: Which MCP server to build first?
5. **Budget**: Monthly budget for BigQuery + MCP APIs?
6. **Compliance**: Any HIPAA/SOC2 requirements? (affects architecture)

---

## Support Resources

- **Full Documentation**: `README_HEAD_OF_DATA.md`
- **Architecture**: Diagrams and data flows included
- **GCP Setup**: Step-by-step commands
- **Code Examples**: TypeScript snippets throughout
- **Monitoring**: Queries and health checks
- **Cost Info**: Detailed pricing breakdown

---

**Everything your head of data needs is in README_HEAD_OF_DATA.md**

This handoff doc is just a summary. The full doc has:
- Complete BigQuery DDL
- Full MCP server interface definitions
- Step-by-step implementation guides
- Monitoring and operations playbooks
- Security and compliance details
- Disaster recovery procedures

---

**Last Updated**: January 2026
**Status**: Architecture complete, ready for implementation
**Next**: Hand off to data team for GCP setup and development
