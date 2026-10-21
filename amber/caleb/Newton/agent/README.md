# Amber

An always-on personal AI agent that lives in iMessage, SMS, and a web dashboard. Built around the 6 dimensions of health: Social, Financial, Intellectual, Spiritual, Physical, Emotional.

Built by [Caleb Newton](https://github.com/calebnewtonusc) with [Sagar Tiwari](https://github.com/karthikBMA) at Blue Modern Advisory.

## What it does

- Responds to messages in real time (DMs and group chats)
- Tracks 6 dimensions of health for every person who texts
- Searches the web with Perplexity Search API, Agent API, and Embeddings
- Manages Todoist tasks, Google Calendar, Gmail, GitHub, LinkedIn, YouTube, Vercel
- Builds per-person profiles with confidence-scored notes and health dimension tags
- Uses AI search brain (Haiku plans queries, Perplexity executes)
- Routes simple messages through Groq (free) to save API costs
- Sends daily health check-ins and proactive messages
- Detects emotional distress in group chats and responds
- Never reveals it's an AI (20+ phrase patterns blocked)

## Architecture

```
iMessage/SMS
    |
    v
Transport (Loop Message or Twilio)          [lib/transport.js]
    |
    v  POST /webhook
agent.js (orchestrator) on Railway
    |
    +-- Safety filter + pre-filters            [lib/safety.js]
    +-- Permission check (owner/trusted/basic) [lib/permissions.js]
    +-- Group router (health-aware)            [lib/groups.js]
    +-- Context scan (proper noun matching)
    +-- AI search brain (Haiku plans)          [lib/search.js]
    |     Perplexity Search -> Sonar -> Anthropic -> DuckDuckGo
    +-- Model router                           [lib/router.js]
    |     Caleb: Sonnet | Contacts: Groq (free) | Complex: Haiku
    +-- AI call chain                          [lib/ai.js]
    |     Anthropic -> Groq -> Ollama fallback
    +-- Health inference (background)          [lib/health.js]
    +-- Contact profile extraction             [lib/contacts.js]
    v
Transport (send reply) + Supabase log
```

## Module structure

```
amber-caleb/
  agent.js                    orchestrator (1,728 lines)
  lib/
    ai.js                     AI fallback chain (Anthropic -> Groq -> Ollama)
    router.js                 Smart model selection with Groq-direct routing
    prompts.js                All 3 system prompts (Caleb DM, group, contact)
    sessions.js               User sessions, intent parsing
    groups.js                 Group router (health-aware), memory bridge
    constants.js              Config, env vars, health dimensions
    errors.js                 AmberError, retry, structured logging, tokens
    data.js                   Firestore CRUD (via amber-id)
    safety.js                 Leak filter, crisis, pre-filters, iMessage rendering
    permissions.js            Owner/trusted/basic tiers
    transport.js              Loop Message + Twilio
    health.js                 6 dimensions, inference, profiles, guidance
    contacts.js               Contact CRUD, conversation history, extraction
    context.js                Context loading (Supabase-first, GitHub fallback)
    search.js                 Perplexity (Search + Agent + Embeddings), AI brain
    memory.js                 Semantic memory save/search
    tools/
      index.js                Tool aggregator
      github.js               GitHub CRUD
      todoist.js              Todoist REST API
      composio.js             Composio (Gmail, Calendar, Drive, etc.)
  dashboard/                  Next.js 16 web dashboard (10 pages)
  supabase/migrations/        SQL migrations
```

## Dashboard

10-page command center at [dashboard-sigma-nine-55.vercel.app](https://dashboard-sigma-nine-55.vercel.app)

| Page     | Source                              | What it shows                            |
| -------- | ----------------------------------- | ---------------------------------------- |
| Home     | Health + Calendar + Tasks + Email   | Daily command center                     |
| Chat     | Anthropic API + full context        | Talk to Amber (same as iMessage)         |
| Health   | Supabase health profiles + checkins | 6 dimension deep dive                    |
| Calendar | Google Calendar via Composio        | Today's events, health dimension coded   |
| Tasks    | Todoist Sync API                    | Overdue, today, upcoming with priorities |
| Email    | Gmail via Composio                  | Inbox with lazy loading, unread count    |
| People   | Supabase contacts + health profiles | All contacts with Apple names            |
| Projects | GitHub REST API                     | All repos with pagination                |
| Feed     | Supabase interactions               | Activity stream with resolved names      |
| Context  | Supabase + GitHub                   | Rendered markdown editor                 |

## Connected systems

| System         | Repo                                | Purpose                                       |
| -------------- | ----------------------------------- | --------------------------------------------- |
| Amber iMessage | this repo                           | Always-on AI agent via Loop Message           |
| Amber iOS      | amber-organization/amber-ios-prod   | SwiftUI app, same 6 health dimensions         |
| TogariMCP      | karthikBMA/TogariMCP                | BMA lead pipeline, BigQuery, Clay             |
| Knowledge Base | calebnewtonusc/amber-knowledge-base | LLM-maintained wiki for BMA + Rytual          |
| Context Files  | calebnewtonusc/claude-context       | Caleb's personal context (synced to Supabase) |

## Stack

- **Runtime**: Node.js 20+ (ESM), 20 modular lib files
- **AI**: Anthropic Claude Sonnet (owner), Groq llama-3.3-70b (contacts, free), Haiku (complex)
- **Search**: Perplexity Search API + Agent API + Embeddings, Anthropic web search, DuckDuckGo
- **Health**: 6 dimensions (Social, Financial, Intellectual, Spiritual, Physical, Emotional)
- **Storage**: Supabase (primary), GitHub (context fallback)
- **Transport**: Loop Message (iMessage) or Twilio (SMS)
- **Dashboard**: Next.js 16, Tailwind, shadcn/ui, Vercel
- **Tools**: Todoist, Gmail, Calendar, Drive, Docs, Sheets, LinkedIn, YouTube, Vercel (via Composio)
- **Deploy**: Railway (agent), Vercel (dashboard)

## Deploy

```bash
# Agent (Railway service is named `amber-agent`; see railway.toml)
railway up --service amber-agent --detach

# Dashboard (auto-deploys from GitHub to Vercel)
git push origin main
```

## Personal repo mapping

Caleb builds on his personal GitHub (`calebnewtonusc/*`). These repos feed into the amber-organization:

| Personal Repo                             | What It Does                                                 |
| ----------------------------------------- | ------------------------------------------------------------ |
| `calebnewtonusc/amber-caleb`              | This repo (deployed iMessage agent)                          |
| `calebnewtonusc/D1-Networking-Automation` | LinkedIn/iMessage/Contacts to Clay CRM sync                  |
| `calebnewtonusc/Loopmessage-SDK`          | TypeScript SDK for Loop Message iMessage API (npm published) |
| `calebnewtonusc/Tools`                    | 80 standalone AI micro-tools on Vercel                       |
| `calebnewtonusc/amber-knowledge-base`     | LLM-maintained wiki (BMA, Rytual, Amber context)             |
| `calebnewtonusc/perplexity-code`          | Perplexity-powered local coding agent                        |
| `calebnewtonusc/D1-Vibe-Coding`           | Claude Code infrastructure (36 slash commands, 18 rules)     |
| `calebnewtonusc/OpenVision`               | Spatial computing in browser                                 |

### Consumed by

```
amber-caleb (this repo)
    |
    |  Reviewed and consumed by:
    |
    +-- rytual-sagar-mcp  (Sagar's orchestration layer)
    +-- amber-shirley-id  (identity infra pulls from knowledge base)
    +-- amber-ios-prod    (iOS app calls agent APIs)
    +-- bma-sagar-mcp     (BMA MCP pulls Clay/networking patterns)
    +-- medha-sagar-mcp   (Medha pulls agent engine + tools)
```

All glory to God!
