> **medha-sandbox home:** `domains/clearout/` (restored from archive). Deploy: Vercel root `domains/clearout/web` — see `docs/DEPLOY.md`.

# ClearOut

> The AI-native communication command center. Clear the flood. Reclaim your mind.

ClearOut connects all your communication channels — Gmail, Slack, iMessage, and more — and uses AI to help you triage, draft, and resolve the overwhelming flood of messages from one intelligent control center.

## Tech Stack

- **Frontend**: Next.js 15 (App Router) + TypeScript + Tailwind CSS
- **Backend**: Next.js API Routes (serverless)
- **Database**: Supabase (PostgreSQL + Auth + RLS)
- **AI**: Anthropic Claude (Sonnet for drafting, Haiku for triage)
- **Email**: Gmail API (Google OAuth 2.0)
- **Slack**: Slack OAuth 2.0 + Web API
- **Voice**: Web Speech API + Anthropic for intent parsing
- **Deployment**: Vercel

## Features

- **Universal inbox**: Gmail, Slack, iMessage, more
- **AI triage engine**: urgency scoring, sentiment, action classification
- **Tone-aware drafting**: AI drafts that sound like *you*
- **Voice-first clearing**: talk through your inbox on the go
- **Relationship memory**: ClearOut learns who matters and how you speak to them
- **Action extraction**: messages → tasks, reminders, follow-ups
- **Approval-first**: you always approve before anything sends

## Project Structure

```
clearout/
├── web/                    # Next.js app
│   ├── src/
│   │   ├── app/            # App router (pages + API routes)
│   │   │   ├── (auth)/     # Login, callback
│   │   │   ├── (dashboard)/ # Inbox, Voice, Channels, Settings
│   │   │   └── api/        # API routes
│   │   ├── components/     # React components
│   │   │   ├── inbox/      # Inbox, ThreadView, MessageCard, DraftEditor
│   │   │   ├── voice/      # VoicePage
│   │   │   ├── channels/   # ChannelsView
│   │   │   ├── settings/   # SettingsView
│   │   │   ├── landing/    # Hero, Features, Pricing, Waitlist
│   │   │   ├── nav/        # Sidebar, TopBar
│   │   │   └── ui/         # Button, Badge
│   │   ├── lib/            # Client libraries
│   │   │   ├── supabase/   # Supabase client + server
│   │   │   ├── gmail/      # Gmail OAuth + sync
│   │   │   ├── slack/      # Slack OAuth + API
│   │   │   └── anthropic/  # Triage, drafting, voice AI
│   │   └── types/          # TypeScript types
│   └── package.json
├── supabase/
│   └── migrations/         # Database schema
├── vercel.json             # Vercel config + cron jobs
└── README.md
```

## Setup

### 1. Clone and install

```bash
cd web
npm install
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run migrations in `supabase/migrations/` via the SQL editor
3. Enable Google OAuth in Supabase Auth → Providers
4. Copy your project URL and anon key

### 3. Set up Google OAuth (Gmail)

1. Create a project in [Google Cloud Console](https://console.cloud.google.com)
2. Enable Gmail API and Google+ API
3. Create OAuth 2.0 credentials
4. Add redirect URI: `https://your-domain.com/api/channels/gmail/callback`

### 4. Set up Slack OAuth

1. Create a Slack App at [api.slack.com](https://api.slack.com/apps)
2. Enable OAuth & Permissions
3. Add redirect URI: `https://your-domain.com/api/channels/slack/callback`
4. Add required scopes (see `.env.example`)

### 5. Environment variables

Copy `.env.example` to `.env.local` and fill in all values:

```bash
cp web/.env.example web/.env.local
```

### 6. Run locally

```bash
cd web
npm run dev
```

## Deploy to Vercel

1. Push to GitHub under `photon-hq/clearout`
2. Import the project in Vercel
3. Set root directory to `web/`
4. Add all environment variables
5. Deploy

The cron job at `/api/cron/sync` runs every 15 minutes to sync channels.

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/channels/gmail` | Get Gmail OAuth URL |
| GET | `/api/channels/gmail/callback` | Gmail OAuth callback |
| GET | `/api/channels/slack` | Get Slack OAuth URL |
| GET | `/api/channels/slack/callback` | Slack OAuth callback |
| POST | `/api/messages/sync` | Sync a channel |
| GET | `/api/messages` | Get messages for a thread |
| POST | `/api/triage` | Triage a single thread |
| PUT | `/api/triage` | Batch triage threads |
| POST | `/api/drafts` | Generate AI draft |
| PATCH | `/api/drafts` | Update draft status |
| POST | `/api/actions` | Perform thread action |
| PUT | `/api/actions` | Bulk thread actions |
| POST | `/api/voice` | Parse voice command / generate readout |
| POST | `/api/waitlist` | Join waitlist |
| GET | `/api/cron/sync` | Scheduled sync (Vercel cron) |
| GET | `/api/auth/callback` | Supabase auth callback |

## Contributing

This project is in early development. Please open issues for bugs and feature requests.

## License

MIT
