# EGATS Platform

Elite Global Arts & Talent System — dancer verification and booking platform.

## Prerequisites

- Node.js 18+
- pnpm or npm
- Supabase CLI (for local development)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in your Supabase credentials:

```bash
cp .env.example .env.local
```

Required variables:
- `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — your anon/public key
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (keep secret)
- `ANTHROPIC_API_KEY` — for AI features
- `NEXT_PUBLIC_APP_URL` — base URL (e.g., `http://localhost:3000`)

### 3. Run migrations

Using Supabase CLI:

```bash
supabase db push
```

Or manually run each file in `supabase/migrations/` in order.

### 4. Start development server

```bash
npm run dev
```

Open http://localhost:3000.

## Architecture

- **Framework**: Next.js 15 App Router
- **Database**: Supabase (PostgreSQL + Auth + Storage + Realtime)
- **Styling**: Tailwind CSS
- **Hosting**: Vercel

## User Roles

| Role | Description |
|------|-------------|
| `dancer` | Performers seeking bookings |
| `recruiter` | Companies/choreographers hiring dancers |
| `verifier` | Vetted professionals who evaluate dancers at camps |
| `admin` | EGATS staff with full platform access |

## Verification Tiers

| Tier | Name | How to earn |
|------|------|-------------|
| 0 | Unverified | Default |
| 1 | Verified Human | Attend any EGATS camp |
| 2 | Verified Talent | Receive evaluations at camps |
