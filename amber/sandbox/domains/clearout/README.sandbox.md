# domains/clearout

AI-native communication command center — universal inbox, AI triage/drafting,
voice clearing. Restored into medha-sandbox from the pre-delete archive
(`social/clearout` @ `04d361b`).

There is **no** separate `amber-organization/ClearOut` GitHub repo; this domain
is the canonical source going forward.

## Stack

Next.js (App Router) + Supabase + Anthropic + Gmail/Slack OAuth → **Vercel**.

## Layout

```
domains/clearout/
├── supabase/migrations/   # profiles, channels, threads, drafts, …
└── web/                   # Next app (Vercel rootDirectory)
```

## Run

```bash
cd web
cp .env.example .env.local   # fill Supabase + Anthropic + OAuth
npm install
npm run dev
```

## iMessage

ClearOut’s schema lists `imessage` as a channel; UI is still “coming soon”.
The native provider lives in `domains/messaging/messages2kit` (`MessagesProvider`).
Wire that kit into a macOS host — do not vendor Kit inside this domain.

## Deploy

Vercel project root directory: `domains/clearout/web`  
See repo-root [`docs/DEPLOY.md`](../../docs/DEPLOY.md).
