# togari-clay

Clay platform MCP server — enrichment, prospecting, and GTM data automation tools.

## Architecture

- `src/tools/` — MCP tools (e.g., query-contacts)
- `src/agents/` — Agent pipelines organized by funnel stage:
  - `slack-sync/` — Slack integration (parser, responder, calendar-sync, deal-sync)
  - `middle-of-funnel/` — MOF pipeline (gmail-agent, deal-manager, fireflies-agent, reply-router, playbook-agent, meeting-router, pipeline-analytics, kanban-view)
  - `bottom-of-funnel/` — BOF pipeline (proposal-generator, pilot-tracker, onboarding-orchestrator)
- `src/config/` — Server config, channels, personas, guardrails, team
- `products/` — Product-specific configurations
- `sql/` — Database schemas
- `infra/` — Infrastructure configs

## Dev

- Build: `node build.mjs`
- Deploy: Railway (`railway.json`)
- TypeScript strict mode, Zod for validation

## Weekly Engineer Check-in

This repo has a weekly feedback loop with Maggie (maggie@bluemodernadvisory.com).
- **Workflow**: See `.claude/weekly-checkin.md`
- **Schedule**: Every Monday at 9:00 AM CT
- **Purpose**: Collect use case feedback, research latest Clay features, auto-build/refine agents
- **Email subject prefix**: [Togari Weekly]

### Agent Builder/Refiner Pipeline
When the engineer shares a use case:
1. Analyze the manual workflow they described
2. Research latest Clay features that could help
3. Check existing tools in this repo for gaps
4. Build new MCP tools or refine existing ones to automate the workflow
5. Test the new/updated tools
6. Summarize what was built in the next check-in email
