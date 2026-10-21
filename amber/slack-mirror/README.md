# Medha Channel Mirror

A live, copyable mirror of a Slack channel. It pulls the channel's full history
plus every thread, renders it as a clean dark feed, and makes it trivial to copy
any message, any thread, or the whole channel at once. Files and images shared in
Slack are mirrored too: images render inline, files download through the app.

Built for capturing the use cases flowing through the Medha channel so nothing
gets lost.

## What it does

- **Mirrors the channel** server-side via the Slack Web API (history + replies).
- **Collapsible threads** — expand/collapse any thread, or all at once.
- **Copy anything** — per message, per thread (replies indented), or copy all
  (respects the current search filter).
- **Files + images** — images shown inline with download; other files download
  through an authenticated proxy (the bot token never reaches the browser).
- **Stays fresh** — a Vercel cron revalidates hourly, and the page polls every
  30 seconds so new messages appear on their own. A pulse marks new arrivals.
- **Search** across message text, authors, and file names.

## How it stays updated

Two layers, no database required:

1. **Hourly cron** (`vercel.json` → `/api/revalidate`) re-renders the static page
   from Slack even when no one is visiting.
2. **30-second client polling** (`/api/slack/messages`) layers near-real-time
   updates on top while the page is open.

## Setup

### 1. Create a Slack app and get a bot token

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**.
2. Name it (e.g. "Channel Mirror"), pick the Medha workspace.
3. **OAuth & Permissions** → **Bot Token Scopes**, add:
   - `channels:history`, `channels:read` (public channels)
   - `groups:history`, `groups:read` (private channels)
   - `users:read` (resolve display names)
   - `files:read` (mirror files/images)
4. **Install to Workspace**, then copy the **Bot User OAuth Token** (`xoxb-...`).
5. In Slack, open the channel and **invite the bot**: `/invite @Channel Mirror`.

### 2. Get the channel ID

In Slack, open the channel → click its name → scroll to the bottom of the
details panel → copy the **Channel ID** (looks like `C0123ABCD`). This is the ID,
not the name.

### 3. Configure environment variables

Copy `.env.example` to `.env.local` for local dev, or set these in the Vercel
dashboard for production:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=C0123ABCD
SLACK_CHANNEL_NAME=medha   # optional, just the header label
```

### 4. Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

### 5. Deploy to Vercel

Push to GitHub, import the repo in Vercel, add the three env vars, deploy. The
hourly cron is picked up automatically from `vercel.json`.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · Lucide icons. No database.

All glory to God! ✝️❤️
