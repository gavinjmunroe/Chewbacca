# Togari Dedup — Parallel Build Plan

**Goal:** Ship a Clay-callable dedupe + unification API for BMA team members, with a dashboard to connect platforms and generate API keys. Single-tenant per user. Apple Contacts is the source-of-truth integration (read + write back via CardDAV). Real-person classification via heuristics + Claude Haiku. WhatsApp deferred to Amber iOS.

**Repo:** `/Users/joelnewton/2026-code/togari/togari-bma-dvlp`
**Branch off:** `main` (currently `2b60526 fix(auth0): correct stale tenant reference`)
**Each workstream:** open in its own Claude tab, work on its own feature branch, file-scoped to avoid collision.

---

## Locked decisions (from product session)

1. **Apple Contacts integration:** CardDAV with iCloud app-specific password. Live sync via polling, plus write-back support (dual integration).
2. **WhatsApp:** Deferred. Not in MVP. Comes when Amber iOS exists.
3. **Realness classifier:** Cheap path. Name heuristics plus Claude Haiku classification. No CV model yet.
4. **API key auth:** Long-lived bearer tokens, prefix `tgi_live_`, hashed at rest in GCP Secret Manager, scoped to a single `owner_id` (Auth0 sub). Revocable from dashboard.
5. **Clay-callable surface:** Single-record matching, not batch. Endpoints:
   - `POST /api/v1/people/match`
   - `POST /api/v1/people` (create)
   - `PATCH /api/v1/people/:contact_id`
   - `POST /api/v1/people/:contact_id/push-to-apple`
6. **Dual Apple integration:** Read from CardDAV for source-of-truth and write back when Clay calls create/update.

---

## Already shipped (do not re-do)

- BigQuery migrations 002 + 003 applied. `togari_dnc.contacts` has all 21 engine-required columns. 2,135 legacy rows backfilled (`contact_id`, `full_name`, `current_title`, `current_company`, `sources`, `merge_count`). Backup at `togari_dnc.contacts_pre_migration_2026_05_20`.
- `social_connections` and `sync_log` tables exist (empty, partitioned).
- Views `v_contacts_enriched`, `v_dnc_only`, `v_dnc_unified` created.
- OAuth scaffold for 7 platforms in `src/dnc/auth/oauth-routes.ts`.
- Dedup engine at `src/dnc/dedup/engine.ts` (batch mode only, needs single-record sibling).
- Chrome extension code under `chrome-extension/` (unpublished).
- Orphan dashboard UI work preserved on remote branch `feat/dashboard-connect-ui` (commit `6ea964c`).

---

## Sequencing

```
WS-0 (Foundation)     ── must finish first, one tab, ~30 min
       ↓
   ┌───┴────────────────────────────────────────┐
   ↓                                            ↓
WS-1  WS-2  WS-3  WS-4  WS-5  WS-6  WS-7      ← all parallel, 7 tabs
   ↓                                            ↓
   └───────────────────┬────────────────────────┘
                       ↓
                WS-Final (Integration)         ← one tab, ~45 min
```

**Branch convention:** `feat/dedup-<workstream-number>-<short-name>` (example: `feat/dedup-1-match-api`).

---

## WS-0 — Foundation (run alone, FIRST)

**Why first:** Lays down shared types, schema columns, and route-registration stubs that every other workstream imports. Skipping this means WS-1 through WS-7 fight over the same files.

**Estimated time:** 30 minutes.

**Files owned (create or modify):**

- `src/dnc/types/index.ts` — add `MatchRequest`, `MatchResult`, `ApiKeyContext`, `RealnessVerdict`, extend `Platform` to include `'apple'`
- `src/dnc/api/index.ts` (NEW) — empty exports for `registerPeopleRoutes(app)` and `registerApiKeyRoutes(app)`
- `src/dnc/auth/api-key-middleware.ts` (NEW) — exports a no-op `validateApiKey` middleware stub that sets `res.locals.apiKey` to a placeholder
- `src/index.ts` — wire `registerPeopleRoutes` and `registerApiKeyRoutes` into the express app (stubs only, they will be filled by WS-1 and WS-2)
- `sql/migrations/004_dedup_v2_columns.sql` (NEW) — add `is_real_person BOOL`, `realness_score INT64`, `realness_reason STRING`, `apple_contact_id STRING`, `apple_etag STRING` to `togari_dnc.contacts`; create table `togari_dnc.api_keys`

**BQ schema additions (apply during WS-0):**

```sql
ALTER TABLE `midyear-glazing-485303-u3.togari_dnc.contacts`
  ADD COLUMN IF NOT EXISTS is_real_person   BOOL,
  ADD COLUMN IF NOT EXISTS realness_score   INT64,
  ADD COLUMN IF NOT EXISTS realness_reason  STRING,
  ADD COLUMN IF NOT EXISTS apple_contact_id STRING,
  ADD COLUMN IF NOT EXISTS apple_etag       STRING;

CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_dnc.api_keys` (
  key_id        STRING NOT NULL,           -- UUID
  owner_id      STRING NOT NULL,           -- Auth0 sub
  key_prefix    STRING NOT NULL,           -- first 12 chars of the key, for display
  key_hash      STRING NOT NULL,           -- SHA-256 of the full key
  name          STRING,                    -- user-facing label
  created_at    TIMESTAMP NOT NULL,
  last_used_at  TIMESTAMP,
  revoked_at    TIMESTAMP
)
CLUSTER BY owner_id;
```

**Shared TypeScript contracts (drop into `src/dnc/types/index.ts`):**

```ts
export type Platform =
  | "apple"
  | "linkedin"
  | "instagram"
  | "twitter"
  | "gmail"
  | "github"
  | "tiktok"
  | "snapchat";

export interface MatchRequest {
  name?: string;
  email?: string;
  linkedin?: string;
  phone?: string;
}

export interface MatchResult {
  matched: boolean;
  contact?: UnifiedContact;
  confidence: number;
  matched_on?: "email" | "linkedin" | "phone" | "name";
}

export interface ApiKeyContext {
  ownerId: string;
  keyId: string;
  keyPrefix: string;
}

export interface RealnessVerdict {
  is_real: boolean;
  score: number; // 0-100
  reason: string; // human-readable explanation
}
```

**Acceptance:**

- `npm run typecheck` passes.
- `bq ls togari_dnc` shows `api_keys` table.
- `bq query "SELECT column_name FROM togari_dnc.INFORMATION_SCHEMA.COLUMNS WHERE table_name='contacts' AND column_name LIKE 'apple_%'"` returns 2 rows.
- The new types are importable from `src/dnc/types/index.js` (compiled).
- `src/index.ts` registers both route groups (even if they are stubs).

**Paste prompt for the WS-0 tab:**

> You are running WS-0 of the Togari dedup parallel build. Read `docs/PARALLEL_BUILD_PLAN.md` sections "Locked decisions" and "WS-0 — Foundation" carefully. Your job is to lay foundation only. Do NOT implement any business logic. Create the shared types, the route-registration stubs, the API-key middleware stub, and apply the BigQuery migration 004. After you finish, run `npm run typecheck` and `bq ls togari_dnc`. Commit on branch `feat/dedup-0-foundation` and push. Tell me when it's green and I will fan out the 7 parallel tabs.

---

## WS-1 — Single-record matching API

**Why:** Clay needs sub-second per-cell lookups, the existing batch engine cannot serve that.

**Files owned (do not touch outside this list):**

- `src/dnc/api/people.routes.ts` (NEW) — implements `POST /api/v1/people/match`, `POST /api/v1/people`, `PATCH /api/v1/people/:contact_id`
- `src/dnc/dedup/matcher.ts` (NEW) — single-record lookup against BQ contacts, indexed via email → linkedin → phone → name
- `src/dnc/api/index.ts` — fill in `registerPeopleRoutes` (was stubbed by WS-0)

**Cannot touch:** `oauth-routes.ts`, `engine.ts` (batch), dashboard, anything under `src/dnc/workers/`, anything in WS-2 through WS-7.

**Behavior:**

- All routes are mounted behind `validateApiKey` middleware (WS-2 owns the real impl; until then the stub returns `ownerId = 'test-owner'`).
- All BQ queries MUST filter by `owner_id = ?` (use parameterized queries, no string interpolation).
- Matching priority: email → linkedin slug → phone E.164 → name. Reuse normalization helpers from `engine.ts:69-105`.
- On `POST /people/match` with no match, return `{ matched: false }` (do NOT auto-create).
- On `POST /people` (create), generate a `contact_id`, persist, run realness classification (call out to WS-4's `classifyRealness()` — for now stub it as `{ is_real: true, score: 100, reason: 'unclassified' }`).
- On `PATCH /people/:contact_id`, only update fields the caller sends. Do NOT clobber existing values with nulls.

**Routes:**

```
POST   /api/v1/people/match
  Body: MatchRequest
  → 200 MatchResult

POST   /api/v1/people
  Body: Partial<UnifiedContact>
  → 201 { contact: UnifiedContact }

PATCH  /api/v1/people/:contact_id
  Body: Partial<UnifiedContact>
  → 200 { contact: UnifiedContact }
```

**Acceptance:**

- All three endpoints return 200 with sample payloads in a manual curl test.
- A match call against a known seeded contact returns `confidence >= 90` and `matched_on` set correctly.
- Tenant isolation: a match call with `ownerId = 'A'` cannot return rows owned by `ownerId = 'B'` (unit test required).

**Paste prompt for the WS-1 tab:**

> You are running WS-1 of the Togari dedup parallel build. Read `docs/PARALLEL_BUILD_PLAN.md` sections "Locked decisions", "WS-0 — Foundation", and "WS-1 — Single-record matching API" carefully. Implement only the files in your "Files owned" list. Do not touch anything outside that list. Use parameterized BQ queries. Run typecheck and a manual curl against `npm run dev`. Commit on `feat/dedup-1-match-api`. Stop when acceptance criteria pass.

---

## WS-2 — API key issuance + auth middleware

**Why:** Clay needs a stable bearer token. Auth0 JWT is wrong shape for a pasted column value.

**Files owned:**

- `src/dnc/auth/api-keys.ts` (NEW) — `issueKey(ownerId, name)`, `revokeKey(keyId, ownerId)`, `listKeys(ownerId)`, `verifyKey(rawKey)`
- `src/dnc/auth/api-key-middleware.ts` — fill in `validateApiKey` (was stubbed by WS-0)
- `src/dnc/api/api-keys.routes.ts` (NEW) — `POST /api/v1/keys`, `GET /api/v1/keys`, `DELETE /api/v1/keys/:keyId`. All three require Auth0 JWT (NOT API key), since this is how the dashboard creates/lists/revokes.
- `src/dnc/api/index.ts` — fill in `registerApiKeyRoutes`

**Cannot touch:** anything in WS-1, WS-3 through WS-7.

**Key format:**

- 32 random bytes, base32-encoded, prefixed `tgi_live_`. Example: `tgi_live_K3F8H2P9X7Q1M4N6Y2T5W8B0J3D7L9R2`.
- Show full key ONCE on creation, never again. Store only `key_hash = sha256(key)` and `key_prefix = key.slice(0, 12)` in BQ.

**Middleware behavior:**

- Reads `Authorization: Bearer tgi_live_...`.
- SHA-256 the incoming raw key, look up `key_hash` in `togari_dnc.api_keys WHERE revoked_at IS NULL`.
- Sets `res.locals.apiKey = { ownerId, keyId, keyPrefix }`.
- On miss, returns 401. On `revoked_at IS NOT NULL`, returns 401.
- Async-updates `last_used_at` (fire-and-forget).

**Acceptance:**

- `POST /api/v1/keys` with valid Auth0 JWT returns the full key once with `{ key: 'tgi_live_...', keyId, keyPrefix }`.
- A subsequent call to `POST /api/v1/people/match` with that key passes the middleware and reaches WS-1's handler.
- A revoked key returns 401.
- Key hashes are stored, never the raw key (verified via `bq query`).

**Paste prompt for the WS-2 tab:**

> You are running WS-2 of the Togari dedup parallel build. Read `docs/PARALLEL_BUILD_PLAN.md` sections "Locked decisions", "WS-0 — Foundation", and "WS-2 — API key issuance + auth middleware". Implement only the files in your "Files owned" list. Never store raw keys. Always SHA-256 before persisting or comparing. Commit on `feat/dedup-2-api-keys`.

---

## WS-3 — Apple Contacts CardDAV integration

**Why:** Apple is the priority source-of-truth. CardDAV is the only API path until Amber iOS ships.

**Files owned:**

- `src/dnc/integrations/carddav.ts` (NEW) — low-level CardDAV client (REPORT for read, PUT for write, ETag handling)
- `src/dnc/integrations/vcard.ts` (NEW) — vCard 3.0 serialize + parse
- `src/dnc/workers/apple-sync.ts` (NEW) — poller that pulls iCloud contacts and writes to `togari_dnc.social_connections` with `platform='apple'`
- `src/dnc/auth/apple-credentials.ts` (NEW) — stores user's iCloud email + app-specific password in GCP Secret Manager, namespaced by `ownerId`
- `src/dnc/api/apple.routes.ts` (NEW) — `POST /api/v1/people/:contact_id/push-to-apple` (write-back); `POST /dnc/auth/apple/credentials` (store creds)

**Cannot touch:** any other platform, dashboard, matching engine, key auth.

**Reference:**

- iCloud CardDAV endpoint: `https://contacts.icloud.com`
- Auth: HTTP Basic with iCloud email + app-specific password (NOT the iCloud password)
- Discovery: `PROPFIND /` returns the user's principal URL; `PROPFIND` on principal returns address book home set
- Read: `REPORT` on the address book with `addressbook-query` filter
- Write: `PUT /addressbooks/.../<uuid>.vcf` with full vCard body; capture `ETag` response header for future conditional updates

**Write-back contract:**

- Called by WS-1's `push-to-apple` endpoint with a `contact_id`.
- Look up contact, serialize to vCard, PUT to iCloud, persist `apple_contact_id` and `apple_etag` back to `togari_dnc.contacts`.
- If `apple_etag` already exists, send `If-Match: <etag>` to avoid clobbering.

**Acceptance:**

- Given an iCloud user with app password, polling pulls their contacts and writes them to `social_connections` with `platform='apple'`.
- A `push-to-apple` call creates a new contact in the user's iCloud address book, visible in macOS Contacts within 30 seconds.
- Updating the same contact twice does not duplicate; ETag check works.

**Paste prompt for the WS-3 tab:**

> You are running WS-3 of the Togari dedup parallel build. Read `docs/PARALLEL_BUILD_PLAN.md` sections "Locked decisions", "WS-0 — Foundation", and "WS-3 — Apple Contacts CardDAV integration". You own everything under `src/dnc/integrations/carddav.ts`, `src/dnc/integrations/vcard.ts`, `src/dnc/workers/apple-sync.ts`, `src/dnc/auth/apple-credentials.ts`, and `src/dnc/api/apple.routes.ts`. Use iCloud's CardDAV endpoint. App-specific password stored in Secret Manager only, never in BQ. Commit on `feat/dedup-3-apple-carddav`.

---

## WS-4 — Realness classifier

**Why:** Reject orgs, bots, throwaway accounts so the dedupe DB stays clean.

**Files owned:**

- `src/dnc/dedup/realness.ts` (NEW) — exports `classifyRealness(contact: UnifiedContact): Promise<RealnessVerdict>`
- `src/dnc/dedup/realness.heuristics.ts` (NEW) — name + handle pattern matching
- `src/dnc/dedup/realness.haiku.ts` (NEW) — Claude Haiku call for ambiguous cases
- `src/__tests__/realness.test.ts` (NEW) — unit tests with sample cases

**Cannot touch:** matching engine, API routes, dashboard, anything outside `src/dnc/dedup/`.

**Logic:**

1. **Heuristic pass (free, runs first):**
   - Name contains `/\b(Inc|LLC|Corp|Ltd|Team|Sales|Support|Bot|Admin|Official)\b/i` → likely org, score 20
   - Handle is generic (`info@`, `admin@`, `support@`, `noreply@`, `team@`) → likely org, score 15
   - Has no profile photo URL across any source → uncertain, score 50
   - Follower:following ratio above 1000:1 → likely brand or celebrity bot, score 40
   - Else → likely real, score 80

2. **Haiku pass (if heuristic score is 30 to 70, ambiguous):**
   - Call `claude-haiku-4-5-20251001` with a tight system prompt asking "is this a real individual person, or an organization/bot/throwaway?"
   - Send name, title, company, sources, bio if available
   - Return the model's verdict, override the heuristic score

3. **Verdict:**
   - `is_real = score >= 60`
   - Persist `is_real_person`, `realness_score`, `realness_reason` on the contact

**Acceptance:**

- 10 known org/bot test cases all classified as not-real.
- 10 known real-people test cases all classified as real.
- Haiku is NOT called for clear-cut cases (cost guard).

**Paste prompt for the WS-4 tab:**

> You are running WS-4 of the Togari dedup parallel build. Read `docs/PARALLEL_BUILD_PLAN.md` sections "Locked decisions", "WS-0 — Foundation", and "WS-4 — Realness classifier". Heuristics first, Haiku only for ambiguous cases (score 30 to 70). Use model id `claude-haiku-4-5-20251001`. Write tests with 10 org and 10 real-person fixtures. Commit on `feat/dedup-4-realness`.

---

## WS-5 — Dashboard: connect platforms + API keys

**Why:** Surface for users to plug in their accounts and copy their `tgi_live_` key into Clay.

**Files owned:**

- `src/dashboard/connect.html` (NEW or update existing if present) — connect cards for each platform, plus iCloud app-password input for Apple
- `src/dashboard/api-keys.html` (NEW) — list, create, revoke API keys, one-time copy modal
- `src/dashboard/dashboard.css` (NEW or extend) — shared styling, follows Caleb's mandatory design system (dark, slate/zinc, indigo accent, Inter font, scroll-aware nav)
- `src/dashboard/connect.js` (NEW) — fetch from `/dnc/auth/status`, hit `/dnc/auth/:platform` to start OAuth
- `src/dashboard/api-keys.js` (NEW) — calls WS-2's `POST/GET/DELETE /api/v1/keys`

**Cannot touch:** any server-side TS, any integration code, the `engine.ts`.

**Source material to crib from:**

- `feat/dashboard-connect-ui` branch on remote has working platform-connect UI for LinkedIn/Instagram/Twitter/GitHub/Gmail/TikTok/Snapchat. Rebase from there or copy patterns.
- Caleb's mandatory design rules in `~/.claude/CLAUDE.md` (scroll-aware navbar is non-negotiable).

**Acceptance:**

- Connect page shows 8 platform cards (the 7 existing OAuth + Apple), each with status dot and connect button.
- Apple card shows a password input for the app-specific password and an explainer link to Apple's docs.
- API keys page lists user's existing keys (prefix + name + last used), allows creating a new one with a name, and revoking.
- New-key modal shows the full key once with a copy button, then permanently hides it.
- Mobile responsive at 375px.

**Paste prompt for the WS-5 tab:**

> You are running WS-5 of the Togari dedup parallel build. Read `docs/PARALLEL_BUILD_PLAN.md` section "WS-5 — Dashboard", plus the design rules in `~/.claude/CLAUDE.md`. Scroll-aware navbar is mandatory. Source-of-truth design system: slate/zinc dark theme, indigo accent, Inter font, shadcn-style cards. The orphan branch `feat/dashboard-connect-ui` has prior work you can crib from. Commit on `feat/dedup-5-dashboard`.

---

## WS-6 — Per-user data isolation audit

**Why:** Every BQ query that touches `contacts` or `social_connections` must filter by `owner_id`. Current code uses `owner_email` in the legacy schema but nothing enforces it.

**Files owned (READ-MOSTLY, careful surgical edits):**

- `src/dnc/dedup/engine.ts` — add `ownerId` parameter to every public method, filter all queries
- `src/dnc/workers/orchestrator.ts` — same
- `src/dnc/workers/bq-writer.ts` — same
- `src/dnc/workers/instagram-sync.ts`, `linkedin-sync.ts`, `twitter-sync.ts`, `user-sync.ts` — same
- `sql/migrations/005_owner_id_backfill.sql` (NEW) — adds `owner_id STRING` to `contacts` and `social_connections`, backfills `owner_id` from `owner_email` where present

**Cannot touch:** API routes (WS-1), dashboard, integrations, classifier.

**Coordination note:** WS-1 and WS-6 both touch contacts queries. WS-1 creates `matcher.ts` (NEW file, no collision). WS-6 edits `engine.ts` (existing). Zero overlap.

**Acceptance:**

- All BQ queries in the listed files include `WHERE owner_id = @owner_id` (parameterized).
- Migration 005 applied; every existing row has an `owner_id` populated.
- A test that calls the engine with `ownerId = 'A'` returns zero rows that have a different `owner_id`.

**Paste prompt for the WS-6 tab:**

> You are running WS-6 of the Togari dedup parallel build. Read `docs/PARALLEL_BUILD_PLAN.md` section "WS-6 — Per-user data isolation". You are doing a security audit pass: every BQ query in the engine and workers must filter by `owner_id`. Add an `ownerId` parameter to every public method. Backfill `owner_id` from `owner_email` for legacy rows. Use parameterized queries only. Commit on `feat/dedup-6-tenant-isolation`.

---

## WS-7 — Slack bot magic-link + Clay integration docs

**Why:** Connect surface from Slack to dashboard, and a clear "paste this into Clay" doc for BMA.

**Files owned:**

- `src/dnc/integrations/slack-bot.ts` (NEW or extend) — slash command `/togari connect` generates a one-time magic link to the dashboard
- `src/dnc/api/magic-link.routes.ts` (NEW) — `POST /api/v1/magic-link/issue`, `GET /dashboard/auth?token=...` (consumes the link, sets Auth0 session, redirects to `/connect`)
- `docs/CLAY_INTEGRATION.md` (NEW) — end-user guide: how to paste your `tgi_live_` key into Clay, sample column formulas for `match`, `create`, `update`
- `docs/SLACK_BOT_COMMANDS.md` (NEW) — `/togari connect`, `/togari status`, `/togari revoke-key`

**Cannot touch:** matching engine, dashboard internals, integrations beyond Slack.

**Acceptance:**

- `/togari connect` in Slack DMs the user a working magic link.
- The link expires after 10 minutes.
- Clay docs include at least 3 concrete column formula examples that work against a deployed instance.

**Paste prompt for the WS-7 tab:**

> You are running WS-7 of the Togari dedup parallel build. Read `docs/PARALLEL_BUILD_PLAN.md` section "WS-7 — Slack bot magic-link + Clay integration docs". Magic link tokens are single-use, 10-minute TTL, stored in GCP Secret Manager keyed by token id. Slack signing-secret verification is mandatory on every command. Commit on `feat/dedup-7-slack-clay-docs`.

---

## WS-Final — Integration

**Run after all 7 parallel branches merge to main.** Single tab. ~45 minutes.

**Goals:**

1. End-to-end test: BMA member opens Slack → `/togari connect` → magic link → dashboard → connects Apple + LinkedIn → generates API key → pastes into Clay → Clay column calls `match` and returns hit.
2. Realness classifier wired into `matcher.ts` and `apple-sync.ts` write path (WS-1 and WS-3 call WS-4).
3. Smoke test all routes with the `tgi_live_` token from end-to-end.
4. Update `README.md` with the new product summary and a link to `docs/CLAY_INTEGRATION.md`.
5. Deploy to Railway: ensure all new env vars are set (`APPLE_CARDDAV_BASE_URL`, `ANTHROPIC_API_KEY`, `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, etc.).

**Env vars to confirm before deploy:**

- `LINKEDIN_CLIENT_ID/SECRET`
- `META_APP_ID/SECRET` (after Meta dev account approval)
- `TWITTER_CLIENT_ID/SECRET`
- `GOOGLE_CLIENT_ID/SECRET`
- `GITHUB_CLIENT_ID/SECRET`
- `SNAPCHAT_CLIENT_ID/SECRET`
- `TIKTOK_CLIENT_KEY/SECRET`
- `ANTHROPIC_API_KEY` (for Haiku classifier)
- `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`
- `GCP_PROJECT_ID`, `GCP_CREDENTIALS_BASE64` (already set)

**Acceptance for WS-Final:**

- A Clay table row with name "Sagar Tiwari" and LinkedIn URL returns `matched: true` against Caleb's contact pool.
- A Clay row that creates a new person produces a new vCard in Caleb's iCloud Contacts within 30 seconds.
- Realness scores set on every new contact.

---

## File ownership matrix (collision check)

| File                                 | WS-0 |    WS-1     |    WS-2    |     WS-3      |      WS-4      | WS-5 |      WS-6       | WS-7 |
| ------------------------------------ | :--: | :---------: | :--------: | :-----------: | :------------: | :--: | :-------------: | :--: |
| `src/dnc/types/index.ts`             | OWN  |      r      |     r      |       r       |       r        |  r   |        r        |  r   |
| `src/dnc/api/index.ts`               | OWN  |    EDIT     |    EDIT    |       r       |                |      |                 |      |
| `src/dnc/api/people.routes.ts`       |      |     OWN     |            |               |                |      |                 |      |
| `src/dnc/api/api-keys.routes.ts`     |      |             |    OWN     |               |                |      |                 |      |
| `src/dnc/api/apple.routes.ts`        |      |             |            |      OWN      |                |      |                 |      |
| `src/dnc/api/magic-link.routes.ts`   |      |             |            |               |                |      |                 | OWN  |
| `src/dnc/auth/api-key-middleware.ts` | STUB |      r      |    OWN     |               |                |      |                 |      |
| `src/dnc/auth/api-keys.ts`           |      |             |    OWN     |               |                |      |                 |      |
| `src/dnc/auth/apple-credentials.ts`  |      |             |            |      OWN      |                |      |                 |      |
| `src/dnc/auth/oauth-routes.ts`       |      |             |            |               |                |      |                 |      |
| `src/dnc/dedup/matcher.ts`           |      |     OWN     |            |               |                |      |                 |      |
| `src/dnc/dedup/engine.ts`            |      |             |            |               |                |      |       OWN       |      |
| `src/dnc/dedup/realness.ts`          |      |             |            |               |      OWN       |      |                 |      |
| `src/dnc/integrations/carddav.ts`    |      |             |            |      OWN      |                |      |                 |      |
| `src/dnc/integrations/vcard.ts`      |      |             |            |      OWN      |                |      |                 |      |
| `src/dnc/integrations/slack-bot.ts`  |      |             |            |               |                |      |                 | OWN  |
| `src/dnc/workers/apple-sync.ts`      |      |             |            |      OWN      |                |      |                 |      |
| `src/dnc/workers/*-sync.ts` (others) |      |             |            |               |                |      |       OWN       |      |
| `src/dnc/workers/orchestrator.ts`    |      |             |            |               |                |      |       OWN       |      |
| `src/dnc/workers/bq-writer.ts`       |      |             |            |               |                |      |       OWN       |      |
| `src/dashboard/connect.html`         |      |             |            |               |                | OWN  |                 |      |
| `src/dashboard/api-keys.html`        |      |             |            |               |                | OWN  |                 |      |
| `src/dashboard/dashboard.css`        |      |             |            |               |                | OWN  |                 |      |
| `src/dashboard/*.js`                 |      |             |            |               |                | OWN  |                 |      |
| `src/index.ts`                       | OWN  |             |            |               |                |      |                 |      |
| `sql/migrations/004_*.sql`           | OWN  |             |            |               |                |      |                 |      |
| `sql/migrations/005_*.sql`           |      |             |            |               |                |      |       OWN       |      |
| `docs/CLAY_INTEGRATION.md`           |      |             |            |               |                |      |                 | OWN  |
| `docs/SLACK_BOT_COMMANDS.md`         |      |             |            |               |                |      |                 | OWN  |
| `src/__tests__/*.test.ts`            |      | OWN (match) | OWN (keys) | OWN (carddav) | OWN (realness) |      | OWN (isolation) |      |

Legend: `OWN` = creates and edits; `EDIT` = surgical edit; `STUB` = create as no-op; `r` = read-only import; blank = do not touch.

---

## Tab launch order (suggested)

1. Open Claude tab 1 → paste WS-0 prompt → wait for merge to `main`.
2. After WS-0 merges, open tabs 2 through 8 in quick succession:
   - Tab 2: WS-1
   - Tab 3: WS-2
   - Tab 4: WS-3
   - Tab 5: WS-4
   - Tab 6: WS-5
   - Tab 7: WS-6
   - Tab 8: WS-7
3. Let them run. Check in on each every 30 minutes.
4. After all 7 PRs merge, open tab 9 → WS-Final.

---

## Risk register

| Risk                                                | Mitigation                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Two workstreams race on `src/dnc/api/index.ts`      | WS-0 lands stubs first; WS-1 and WS-2 do surgical EDIT (one line each), low collision        |
| Realness classifier inflates Anthropic bill         | Cost guard: heuristic-only for clear cases, Haiku only for score 30 to 70                    |
| Meta App Review blocks Instagram                    | Not on critical path; Instagram OAuth route returns 503 cleanly, dashboard shows greyed card |
| CardDAV auth fails for users with 2FA-only Apple ID | Detect and surface a friendly error; require app-specific password explicitly in UI copy     |
| Clay 30-second cell timeout                         | Single-record matching has indexed lookups; budget 200ms per call                            |

---

All glory to God! ✝️❤️
