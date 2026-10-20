# Togari - Healthcare Data Integration Platform
## MAIA Biotech Spring 2026 Project

> Adapted from original Togari project for USC MAIA Biotech coursework

MCP-based data integration platform with BigQuery data warehouse for healthcare procurement and operations analytics.

## Project Context

This project is part of the **USC MAIA (Multi-modal AI in Biotechnology) Spring 2026** program. We're adapting and extending the Togari platform to explore healthcare data integration, procurement analytics, and AI-powered healthcare insights.

**Original Repository:** [sagartiw/togari](https://github.com/sagartiw/togari)
**MAIA Organization:** [MAIA-Biotech-Spring-2026](https://github.com/MAIA-Biotech-Spring-2026)

## Team Members

*(Add your team members here)*
- Team Member 1 - [@github-username](https://github.com/username)
- Team Member 2 - [@github-username](https://github.com/username)
- Team Member 3 - [@github-username](https://github.com/username)

## Overview

**Togari** is the business platform for healthcare practitioners, integrating multiple healthcare data APIs into a unified BigQuery data warehouse.

This is paired with **Amber ID** (iOS app for consumers) - together they form the complete Amber ecosystem:
- **Amber ID**: Consumer-facing mobile app for personal health relationships
- **Togari**: Business platform for healthcare practitioners and data integration

For detailed setup and architecture information, see:
- [QUICKSTART.md](QUICKSTART.md) - Quick setup guide
- [README_HEAD_OF_DATA.md](README_HEAD_OF_DATA.md) - Technical architecture
- [START_HERE.md](START_HERE.md) - Development starting point

## MAIA Project Goals

### Research Questions
1. How can we integrate disparate healthcare data sources effectively?
2. What role can BigQuery play in healthcare analytics at scale?
3. How do we ensure data quality and consistency across multiple APIs?
4. What insights can be derived from healthcare procurement data?

### Deliverables

#### Phase 1: Platform Understanding (Weeks 1-4)
- [ ] Document current Togari architecture
- [ ] Set up GCP and BigQuery environment
- [ ] Deploy test instance
- [ ] Literature review on healthcare data integration

#### Phase 2: Feature Development (Weeks 5-10)
- [ ] Implement MCP servers for data sources
- [ ] Build BigQuery schema and pipelines
- [ ] Add data quality checks
- [ ] Develop enrichment workflows

#### Phase 3: Research & Analysis (Weeks 11-14)
- [ ] Conduct data quality analysis
- [ ] Develop procurement analytics dashboards
- [ ] Evaluate integration performance
- [ ] Privacy and compliance audit

#### Phase 4: Final Presentation (Weeks 15-16)
- [ ] Prepare demo and presentation
- [ ] Write final research paper
- [ ] Document findings
- [ ] Deploy production system

## Original Project Overview

Togari integrates multiple healthcare data APIs into a unified BigQuery data warehouse:

### Architecture

```
Frontend (React)
  ↓
API Server (tRPC)
  ↓
├─ MCP Servers (Exa, Structify, Happenstance, Serif)
└─ BigQuery Data Warehouse (raw → enriched → analytics)
```

### Data Sources
- **Exa**: AI-powered search and research
- **Structify**: Data enrichment pipeline
- **Happenstance**: Healthcare data provider
- **Serif Health**: Provider directory and data

### BigQuery Datasets
- `raw_data` - Raw API responses
- `enriched` - Standardized enriched data  
- `analytics` - Aggregated metrics
- `procurement` - Healthcare procurement data

## Technology Stack

### Backend
- Node.js + TypeScript
- tRPC (type-safe APIs)
- BullMQ (background jobs)

### Data Infrastructure
- Google BigQuery (data warehouse)
- Structify (enrichment pipeline)
- Google Cloud Platform

### MCP Architecture
- Modular MCP servers
- Pluggable API integrations
- Event-driven data sync

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm 9.0+
- Google Cloud Platform account
- BigQuery access
- API keys for data sources

### Installation

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Start API server
pnpm --filter @togari/api dev

# Start workers (in another terminal)
pnpm --filter @togari/workers dev
```

See [QUICKSTART.md](QUICKSTART.md) for detailed instructions.

## Project Structure

```
togari-maia/
├── packages/
│   ├── core/              # Shared types and utilities
│   ├── bigquery/          # BigQuery client and schemas
│   ├── mcp-exa/           # Exa MCP server
│   ├── mcp-structify/     # Structify MCP server
│   ├── mcp-happenstance/  # Happenstance MCP server
│   ├── mcp-serif/         # Serif Health MCP server
│   ├── api/               # Main API server (tRPC)
│   └── workers/           # Background sync jobs
└── docs/                  # Documentation
```

## Next Steps

**Current Status:** v2.0.0 - Production Ready (Phase 1 Complete)
**Next Priority:** Phase 2 - Authentication & User Management

### Immediate Tasks
- [ ] Implement Amber ID authentication in tRPC context
- [ ] Add token injection in tRPC provider
- [ ] Replace mock authentication with Privy OAuth
- [ ] Connect to backend API (replace mock data)

### Comprehensive Roadmap
See **[ROADMAP.md](../ROADMAP.md)** in the main workspace for:
- Complete Phase 2-6 planning
- All 7 intentional TODOs with locations and context
- Success metrics and timelines
- Production deployment strategy

### Quick Commands
```bash
# Development
pnpm --filter @togari/web dev          # Start web app (localhost:3000)
pnpm --filter @togari/api dev          # Start API server

# Testing
pnpm run type-check                    # TypeScript type checking
pnpm run lint                          # ESLint checks

# Build
pnpm run build                         # Production build
```

## License

This project is based on the original Togari platform (Proprietary).
**Academic Use Only** - For USC MAIA Biotech coursework.

## Acknowledgments

- **Original Togari Team** - For the base platform
- **USC MAIA Program** - For project guidance
- **Google Cloud Platform** - For BigQuery infrastructure
- **MCP Community** - For MCP architecture patterns

---

**Course:** Multi-modal AI in Biotechnology (Spring 2026)  
**Institution:** University of Southern California  
**Organization:** [MAIA-Biotech-Spring-2026](https://github.com/MAIA-Biotech-Spring-2026)

**Last Updated**: February 6, 2026
