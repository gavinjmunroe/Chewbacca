# Togari Frontend

Sourcing dashboard for [Togari](https://github.com/amber-organization/togari-platform), the data-warehouse-meets-AI-agent platform replacing DealCloud + Nooks + the Colombia research team for 48 North.

This is the not-headless half of Togari. Engagements, theses, enrichment, dialer, digests. Dark-first, Next.js 16, designed for Sagar's Friday dry run before the 48N kickoff session on Monday 2026-05-11.

## Stack

- **Next.js 16** + App Router + Turbopack
- **TypeScript 5** strict
- **Tailwind 4** + `@tailwindcss/postcss`
- **shadcn-style** primitives over Radix UI
- **TanStack Query** for fetching + cache
- **Lucide** icons
- **Inter** + JetBrains Mono via `next/font`
- **Auth0** redirect flow (placeholder route while Karthik provisions the real tenant)
- **Express + SSE** mock backend on `:4001`

## Routes

| Path                         | Page                                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| `/login`                     | Auth0 redirect splash                                                |
| `/`                          | Dashboard: stats, engagements, today's queue                         |
| `/engagements`               | Engagement list                                                      |
| `/engagements/:id`           | Engagement detail with theses table                                  |
| `/theses/:id`                | Tier rail + 6-column milestone Kanban with tier and coverage filters |
| `/theses/:id/companies/:cid` | Company detail with primary-contact override dropdown                |
| `/dialer`                    | Active session: queue, live SSE transcript, AI co-pilot pane         |
| `/tasks`                     | Today's task queue with type and search filters                      |
| `/admin`                     | Tenant info, integration health, user management                     |

All routes call the same `/api/v1/sourcing/*` and `/api/v1/dialer/*` surface defined in `togari-platform`. Pointing at the real backend is one env var flip.

## Local development

```bash
# 1. install
npm install

# 2. seed JSON fixtures from the Springdale XLSX (idempotent)
npm run seed

# 3. boot Next + mock backend together (Next on :3000, mock on :4001)
npm run dev
```

Open `http://localhost:3000`. Click "Continue with Auth0" — the demo cookie auth stamps a session and redirects you back to `/`.

To switch to the real backend:

```bash
NEXT_PUBLIC_API_BASE=https://togari-platform.run.app npm run dev:web
```

## Project layout

```
src/
  app/                  Next.js App Router pages
  components/
    ui/                 base primitives (Card, Button, Badge, Skeleton, EmptyState)
    layout/             Navbar (scroll-aware) + AppShell
    sourcing/           PrimaryContactOverride, DialerSession (SSE)
  hooks/                useScrollNav
  lib/                  api-client, utils, formatters
  types/                shared TS types matching the spec's BigQuery shape
mocks/
  server.ts             Express mock with SSE transcript stream
  fixtures/             9 JSON files mirroring the togari_sourcing dataset
scripts/
  seed-fixtures.ts      Springdale XLSX -> 9 JSON fixtures
```

## Design system

- Background `bg-zinc-950` with mesh-gradient hero overlay
- Accent `indigo-500/600`
- Cards `bg-zinc-900 border border-zinc-800 rounded-2xl`
- Glassmorphism panels `bg-white/5 backdrop-blur-md border border-white/10`
- Scroll-aware navbar (mandatory pattern: hidden at top, slides in after 80px, hides 200px from bottom)
- Inter for UI, JetBrains Mono for IDs and tabular numbers
- No emojis, no em dashes anywhere

## Hand-off note

Once Karthik's `/api/v1/sourcing/*` endpoints are live in `togari-platform`, flip `NEXT_PUBLIC_API_BASE` from `http://localhost:4001` to the Cloud Run URL. Same UI, real data. No frontend rewrite required.

The Auth0 stub at `src/app/api/auth/[...slug]/route.ts` is a placeholder. Replace with `@auth0/nextjs-auth0`'s `handleAuth()` once the dev tenant is provisioned.

All glory to God! ✝️❤️
