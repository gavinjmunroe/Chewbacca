# Amber Dashboard

Personal command center for the Amber ecosystem. 10 pages connected to Supabase, Google Calendar, Gmail, Todoist, and GitHub.

Live at [dashboard-sigma-nine-55.vercel.app](https://dashboard-sigma-nine-55.vercel.app)

## Pages

| Page     | Data Source                         | Description                                                      |
| -------- | ----------------------------------- | ---------------------------------------------------------------- |
| Home     | Health + Calendar + Tasks + Email   | Daily command center with 6 health gauges and check-in           |
| Chat     | Anthropic API (Sonnet)              | Full conversation with Amber, same context as iMessage           |
| Health   | Supabase health_profiles + checkins | 6 dimension scores, trends, check-in history                     |
| Calendar | Google Calendar via Composio        | Today's events (fast), week ahead (lazy loaded)                  |
| Tasks    | Todoist Sync API                    | Overdue, today, upcoming. Complete and add tasks inline          |
| Email    | Gmail via Composio                  | Inbox with lazy loading, unread count, detail panel              |
| People   | Supabase contacts + health_profiles | All contacts with Apple names, health dots, conversation history |
| Projects | GitHub REST API                     | All repos with pagination, language badges, stats                |
| Feed     | Supabase interactions               | Activity stream with Apple contact name resolution               |
| Context  | Supabase + GitHub                   | Rendered markdown viewer with edit mode                          |

## Stack

- Next.js 16 (Turbopack)
- Tailwind CSS + shadcn/ui
- Framer Motion animations
- Composio SDK (Calendar, Email)
- Supabase (contacts, health, interactions, context)
- Anthropic API (Chat with Amber)
- react-markdown (Context rendering)

## Environment variables

```
PASSWORD_HASH=          # bcrypt hash of login password
SESSION_SECRET=         # random string for cookie signing
SUPABASE_URL=           # Supabase project URL
SUPABASE_SERVICE_KEY=   # Supabase service role key
CALEB_PHONE=            # Owner phone (+1XXXXXXXXXX)
GITHUB_TOKEN=           # GitHub PAT (context editor, projects)
ANTHROPIC_API_KEY=      # Claude API key (chat)
COMPOSIO_API_KEY=       # Composio (calendar, email)
TODOIST_API_KEY=        # Todoist (tasks)
PERPLEXITY_API_KEY=     # Perplexity (search in chat)
AMBER_AGENT_URL=        # Railway URL of iMessage agent
```

## Development

```bash
npm install
npm run dev
```

## Deploy

Auto-deploys from GitHub via Vercel. Root directory: `dashboard`.

All glory to God!
