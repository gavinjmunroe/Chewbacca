# Marrow

> **The recruiting operating system for competitive student organizations.**

Marrow replaces the broken stack of Google Forms, Sheets, email threads, and DMs that most selective student organizations use to run admissions. It gives organizations a structured, repeatable system for running entire recruiting cycles — and gives applicants a single place to manage everything.

---

## What It Does

**For organizations (admins):**
- Build custom multi-stage recruiting cycles with configurable questions and rubrics
- Manage applicants through a visual pipeline (list + kanban)
- Assign reviewers and track scoring against rubric criteria
- Send targeted messages to applicants by stage, status, or individually
- Export clean CSV rosters and applicant data
- Analyze cycle performance with funnel charts and reviewer variance stats
- Manage post-acceptance onboarding tasks

**For applicants:**
- One reusable profile with an artifact vault (resume, transcript, portfolio)
- Apply to multiple organizations without re-entering the same info
- Track application status and stage in real time
- Receive structured updates instead of silence

**For reviewers:**
- Structured review queue with rubric scoring
- Notes and recommendation (advance / hold / reject / undecided)
- Blind review mode support
- Keyboard navigation between candidates

---

## Architecture

```
marrow/
└── web/                    # Next.js 14 App Router application
    ├── src/
    │   ├── app/
    │   │   ├── page.tsx                    # Landing page
    │   │   ├── (auth)/                     # Login / Signup
    │   │   ├── (app)/                      # Authenticated applicant views
    │   │   │   ├── dashboard/              # Application status overview
    │   │   │   ├── profile/                # Edit profile
    │   │   │   ├── vault/                  # Artifact management
    │   │   │   ├── explore/                # Browse orgs and cycles
    │   │   │   ├── apply/[org]/[cycle]/    # Multi-stage apply flow
    │   │   │   └── onboarding/[cycle]/     # Post-acceptance tasks
    │   │   ├── admin/                      # Org admin views
    │   │   │   ├── setup/                  # Create organization
    │   │   │   └── [orgSlug]/
    │   │   │       ├── page.tsx            # Org dashboard
    │   │   │       ├── settings/           # Org settings + team management
    │   │   │       └── cycles/[cycleId]/
    │   │   │           ├── stages/         # Stage / question / rubric builder
    │   │   │           ├── applicants/     # Pipeline (list + kanban)
    │   │   │           ├── messages/       # Compose and send messages
    │   │   │           └── analytics/      # Funnel, timeline, reviewer stats
    │   │   ├── review/[org]/[cycle]/       # Reviewer queue + review page
    │   │   ├── org/[orgSlug]/              # Public org page
    │   │   └── api/
    │   │       ├── auth/callback/          # Supabase OAuth callback
    │   │       ├── upload/                 # File upload to Supabase Storage
    │   │       ├── export/[cycleId]/       # CSV / JSON export
    │   │       ├── messages/               # Send bulk email
    │   │       └── applications/[id]/stage/ # Stage transition + email
    │   ├── components/
    │   │   ├── ui/                         # Base component library
    │   │   ├── nav/                        # Navbar + admin sidebar
    │   │   ├── admin/                      # Admin-specific components
    │   │   └── reviewer/                   # Reviewer-specific components
    │   ├── lib/
    │   │   ├── supabase/                   # Client + server Supabase instances
    │   │   ├── email/                      # Resend templates + send helpers
    │   │   ├── utils.ts                    # Shared utilities
    │   │   └── validations.ts              # Zod schemas
    │   └── types/
    │       └── database.ts                 # Full Supabase database types
    └── supabase/
        └── migrations/
            └── 001_initial_schema.sql      # Complete DB schema + RLS policies
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| UI Components | Radix UI primitives |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Storage | Supabase Storage |
| Email | Resend |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
| Deployment | Vercel |

---

## Database Schema

16 tables covering the full recruiting lifecycle:

- **profiles** — User accounts (extends Supabase auth)
- **organizations** — Student orgs
- **org_members** — Role-based org membership (owner / admin / reviewer)
- **cycles** — Recruiting cycles per org
- **stages** — Stages within a cycle (application, event, interview, decision)
- **stage_questions** — Questions per stage (7 question types)
- **rubric_criteria** — Scoring criteria per stage
- **applications** — Applicant submissions per cycle
- **application_responses** — Answers to each question
- **artifacts** — User file vault (resume, transcript, portfolio, etc.)
- **reviews** — Reviewer scores + notes per application per stage
- **review_scores** — Individual criterion scores per review
- **application_stage_history** — Full audit trail of stage movements
- **messages** — Sent bulk communications
- **events** — Info sessions, coffee chats, etc.
- **event_rsvps** — RSVP tracking
- **onboarding_tasks** — Post-acceptance task list
- **onboarding_completions** — Task completion tracking
- **audit_log** — Complete org-level audit trail

All tables have Row Level Security (RLS) policies enforced at the database level.

---

## Local Development Setup

### 1. Clone and install

```bash
git clone https://github.com/calebnewtonusc/marrow.git
cd marrow/web
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Run the migration: paste `supabase/migrations/001_initial_schema.sql` in the SQL editor
3. Create storage buckets:
   - `avatars` (public)
   - `artifacts` (private)
   - `org-assets` (public)
   - `responses` (private)
4. Enable email auth in Authentication settings

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in your `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
RESEND_API_KEY=re_your_resend_key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Set up Resend

1. Create an account at [resend.com](https://resend.com)
2. Add and verify your sending domain
3. Update the `FROM` address in `src/lib/email/send.ts` to match your verified domain
4. Add `RESEND_API_KEY` to your env

### 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deploying to Vercel

### 1. Push to GitHub

```bash
git add .
git commit -m "Initial Marrow build"
git push origin main
```

### 2. Import to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import the `marrow` GitHub repository
3. Set root directory to `web`
4. Add all environment variables from `.env.example`
5. Deploy

### 3. Configure Supabase auth callback

In your Supabase project → Authentication → URL Configuration:
- Site URL: `https://your-marrow-app.vercel.app`
- Redirect URLs: `https://your-marrow-app.vercel.app/api/auth/callback`

---

## Key Design Decisions

**Why Supabase?**
RLS at the database level means authorization logic lives in one place and can't be accidentally bypassed. Every table has carefully designed policies that allow org-scoped data access without server-side enforcement gaps.

**Why multi-stage instead of single-application?**
Real club recruiting is multi-round. A single form doesn't capture the operational reality of coffee chats → written apps → interviews → team matching. The stage system models this exactly.

**Why a configuration engine instead of fixed templates?**
Every org has different process requirements. The stage + question + rubric system lets any org model their exact workflow without Marrow becoming a services business.

**Why not AI-first?**
AI features can help (writing assistance, reviewer variance detection, summary) but the core moat is the workflow layer and trust layer. AI sits on top of that, not as the foundation.

---

## Roadmap

- [ ] Email domain verification per org (send from `recruiting@[org-domain].org`)
- [ ] Calendar integration for interview scheduling
- [ ] AI writing assistant for applicants (completeness + clarity hints)
- [ ] Reviewer assignment automation (round-robin, workload balancing)
- [ ] Public applicant API for cross-platform profile portability
- [ ] University-level admin dashboard (multi-org oversight)
- [ ] Mobile-optimized applicant experience
- [ ] Webhook support for external integrations

---

## License

MIT — built by Caleb Newton.
