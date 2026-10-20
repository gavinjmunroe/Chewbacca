# Togari Dedup v2 — Handoff

## What this is, in one paragraph

We built a "is this person already in your contacts?" layer for BMA. Anyone on the team can paste a name, an email, or a LinkedIn URL into a Clay column, and Togari instantly tells them whether that person already exists in their contact pool — and tags every contact with where it came from (LinkedIn, Apple Contacts, Gmail, etc). It also automatically filters out fake profiles and organization accounts so the contact list stays clean. It's private per-person: Sagar's contacts don't mix with Kevin's.

## Why it matters

BMA currently relies on third-party tools (Clearbit, Apollo, etc) and manual checks for contact dedupe and enrichment. This brings that capability in-house, tailored to the platforms BMA actually uses, with a real-person classifier that catches the junk Clearbit misses. Every BMA team member gets their own private contact source-of-truth that follows them across Clay tables, the Togari Slack bot, and (eventually) the Amber iOS app.

## What's live right now

- All the code is merged, tested, and ready to ship.
- The database side is already deployed: BigQuery has the new schema, plus 2,135 historical BMA contacts imported and tagged.
- The Chrome extension that auto-captures LinkedIn is built and ready to submit to the Chrome Web Store.
- A full step-by-step migration script and runbook is in this repo for Karthik.

## What's left, and the rough timeline

| When                     | What                                                                                                                                                                            | Who                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Day 1                    | Karthik ports the new code into `togari-platform` (the live production service), registers the LinkedIn OAuth app, and deploys. **LinkedIn-only Clay matching is live by EOD.** | Karthik              |
| Day 1 (start the clocks) | Submit Meta App Review for Instagram (2–4 weeks), submit Chrome extension to the Web Store (1–3 days), submit TikTok + Snapchat for scope approval                              | Karthik (admin work) |
| Day 2–3                  | Add Twitter, Google/Gmail, GitHub, TikTok, Snapchat as their OAuth apps get approved                                                                                            | Karthik              |
| Week 2–4                 | Instagram flips on once Meta approves. Chrome extension flips on once Google approves.                                                                                          | Auto                 |

LinkedIn alone is enough to start using the product the day Karthik finishes the port. Everything else is incremental coverage.

## What we're waiting on (long-lead external clocks)

These can't be sped up by writing code. Start them today so they finish on time:

1. **Meta App Review** for Instagram scopes — 2 to 4 weeks. Requires Meta Business Verification first.
2. **Chrome Web Store review** for the extension — 1 to 3 business days.
3. **TikTok + Snapchat** scope approvals — ~1 week each.

---

## Engineering details (the rest of this document is for Karthik)

The dedup v2 code was built in this repo (`togari-bma-dvlp`, dev environment). It lands in `togari-platform` (`@togari/admin`, Cloud Run), the production service Karthik already operates and where Slack is already wired up. The plan is to port the dedup v2 modules into `togari-platform` so there's one repo, one deployment, one Slack app going forward.

---

## The migration

**Why this isn't a `cp -r`:**

|              | `togari-bma-dvlp` (this repo, dev)        | `togari-platform` (prod)                                                       |
| ------------ | ----------------------------------------- | ------------------------------------------------------------------------------ |
| Organized by | feature (`src/dnc/*`, `src/dashboard/*`)  | transport (`src/transports/api`, `src/transports/slack`, `src/transports/mcp`) |
| Tests        | `npx tsx src/__tests__/*.test.ts`         | `vitest`                                                                       |
| Server entry | `src/index.ts` (MCP + Express)            | `src/server.ts` (Cloud Run Express)                                            |
| BQ access    | raw `@google-cloud/bigquery`              | `src/bigquery/client` wrapper                                                  |
| Sentry       | `src/services/sentry`                     | `src/observability/sentry`                                                     |
| Auth         | manual `jwks-rsa` in `src/services/oauth` | `express-oauth2-jwt-bearer` + `src/auth/jwt`                                   |
| Slack        | `src/dnc/integrations/slack-bot.ts`       | `src/transports/slack/index.ts` (already wired)                                |

So most files move verbatim; some need adapter rewrites to use `togari-platform`'s helpers; a few merge with existing modules.

**Automation first.** Run `bash scripts/migrate-to-platform.sh /path/to/togari-platform` (or with `--dry-run` first). It mechanically copies every file that needs ZERO changes (~30 files). The script's tail prints a numbered TODO list of the files that need hand-porting.

**File-by-file plan (for the items the script doesn't auto-copy):**

| Source (this repo)                                                                                      | Destination (`togari-platform`)                     | Action                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/dnc/api/people.routes.ts`                                                                          | `src/transports/api/dedup/people.routes.ts`         | copy + swap BQ import to `src/bigquery/client`                                                                                                                                        |
| `src/dnc/api/api-keys.routes.ts`                                                                        | `src/transports/api/dedup/api-keys.routes.ts`       | copy + swap JWT validator to platform's `auth/jwt`                                                                                                                                    |
| `src/dnc/api/apple.routes.ts`                                                                           | `src/transports/api/dedup/apple.routes.ts`          | copy verbatim                                                                                                                                                                         |
| `src/dnc/api/magic-link.routes.ts`                                                                      | `src/transports/api/dedup/magic-link.routes.ts`     | copy verbatim                                                                                                                                                                         |
| `src/dnc/api/health.routes.ts`                                                                          | `src/transports/api/dedup/health.routes.ts`         | merge with platform's existing health endpoint if present                                                                                                                             |
| `src/dnc/api/index.ts`                                                                                  | `src/transports/api/dedup/index.ts`                 | copy; wire register fns into platform's `apiRouter` in `src/transports/api/router.ts`                                                                                                 |
| `src/dnc/dedup/{matcher,realness,realness.heuristics,realness.haiku}.ts`                                | `src/dedup/*.ts`                                    | copy; swap BQ import to platform's client                                                                                                                                             |
| `src/dnc/dedup/engine.ts` MODIFICATIONS                                                                 | `src/dedup/engine.ts` (NEW file derived from edits) | port `owner_id` filter + new MERGE rewrite. Skip legacy batch logic if platform has its own.                                                                                          |
| `src/dnc/auth/api-keys.ts`                                                                              | `src/auth/api-keys.ts`                              | copy; uses BQ — swap to platform client                                                                                                                                               |
| `src/dnc/auth/api-key-middleware.ts`                                                                    | `src/auth/api-key-middleware.ts`                    | copy verbatim                                                                                                                                                                         |
| `src/dnc/auth/apple-credentials.ts`                                                                     | `src/secrets/apple-credentials.ts`                  | copy; swap to platform's Secret Manager wrapper                                                                                                                                       |
| `src/dnc/integrations/carddav.ts`                                                                       | `src/integrations/apple/carddav.ts`                 | copy verbatim                                                                                                                                                                         |
| `src/dnc/integrations/vcard.ts`                                                                         | `src/integrations/apple/vcard.ts`                   | copy verbatim                                                                                                                                                                         |
| `src/dnc/integrations/slack-bot.ts`                                                                     | `src/transports/slack/togari-commands.ts`           | **MERGE** into existing `src/transports/slack/index.ts` — add `/togari` slash command alongside the Slack events handler already there. Reuse platform's signing-secret verification. |
| `src/dnc/workers/apple-sync.ts`                                                                         | `src/workers/apple-sync.ts`                         | copy; swap BQ writer + cache helpers                                                                                                                                                  |
| `src/dnc/workers/*-sync.ts` MODIFICATIONS (linkedin, instagram, twitter, user, bq-writer, orchestrator) | platform may or may not have equivalents            | if platform has its own sync workers, hand-port the `owner_id` filter pattern. If not, copy the lot.                                                                                  |
| `src/dnc/types/index.ts`                                                                                | `src/dedup/types.ts`                                | copy; the dedup contracts are self-contained                                                                                                                                          |
| `src/dashboard/*`                                                                                       | `src/dashboard/*` or `public/dashboard/*`           | copy; verify static-file serving picks them up                                                                                                                                        |
| `src/lib/env.ts`                                                                                        | `src/lib/env.ts`                                    | copy; widen REQUIRED list if platform enforces more                                                                                                                                   |
| `src/__tests__/*.test.ts`                                                                               | `tests/**/*.test.ts`                                | **REWRITE** to vitest. Test logic transfers 1:1; only the runner syntax changes (`describe`/`it`/`expect`).                                                                           |
| `sql/migrations/004_dedup_v2_columns.sql` + `005_owner_id_backfill.sql`                                 | renumber to platform's next available numbers       | copy; already applied to BQ so the SQL is a no-op there                                                                                                                               |
| `scripts/claim-contacts.ts`                                                                             | `scripts/claim-contacts.ts`                         | copy; swap BQ client                                                                                                                                                                  |
| `scripts/smoke.ts`                                                                                      | `scripts/smoke.ts`                                  | copy verbatim (uses `fetch`, no internal deps)                                                                                                                                        |
| `chrome-extension/*`                                                                                    | `chrome-extension/*`                                | copy whole directory verbatim                                                                                                                                                         |
| `.env.example`                                                                                          | merge into platform's `.env.example`                | union both files; dedup identical lines                                                                                                                                               |
| `.github/workflows/ci.yml`                                                                              | merge into platform's existing CI workflow          | add `npm test` + `npx tsc --noEmit` + build steps                                                                                                                                     |
| `src/index.ts` MODIFICATIONS (validateEnv call, route registrations)                                    | `src/server.ts` in platform                         | merge: call `validateEnv()` early; register the dedup routes alongside existing routers                                                                                               |
| `package.json` scripts                                                                                  | platform's `package.json`                           | add `smoke` and `claim-contacts` script entries                                                                                                                                       |

**Hardest item:** the Slack merge in `src/transports/slack/index.ts`. Platform already handles Slack events (probably for the email engine / smartlead). Add `/togari` as another slash command handler, sharing signing-secret verification with what's already there.

**After the port:**

1. `npx tsc --noEmit` clean in `togari-platform`.
2. `npm test` (vitest) clean.
3. Deploy to Cloud Run.
4. `curl https://<cloud-run-url>/api/v1/health` → 200.
5. Smoke test against the Cloud Run URL.
6. Configure Clay columns to call the Cloud Run URL.

---

## What shipped (so Karthik knows what he's getting)

- **Single-record matcher API** behind `tgi_live_*` bearer tokens. Sub-second per Clay cell.
  - `POST /api/v1/people/match`
  - `POST /api/v1/people`
  - `PATCH /api/v1/people/:contact_id`
  - `POST /api/v1/people/:contact_id/push-to-apple`
  - `GET  /api/v1/health` (public)
- **API key issuance** in the dashboard. Keys are SHA-256-hashed at rest in BQ; raw secret is shown once.
- **Per-user tenant isolation** via `owner_id` (Auth0 sub) on every BQ query.
- **Realness classifier** (heuristics + Claude Haiku escalation) runs at `matcher.create` time.
- **Apple CardDAV integration** — read + write back via app-specific iCloud password.
- **Slack `/togari connect`** — magic-link onboarding.
- **Chrome extension** for zero-friction LinkedIn cookie capture (unpublished).

**File-of-interest map:**

- API routes: `src/dnc/api/{people,api-keys,apple,magic-link,health}.routes.ts`
- Core: `src/dnc/dedup/{matcher,realness}.ts`, `src/dnc/auth/{api-keys,api-key-middleware}.ts`
- Apple: `src/dnc/integrations/{carddav,vcard}.ts`, `src/dnc/workers/apple-sync.ts`
- Slack: `src/dnc/integrations/slack-bot.ts`, `src/dnc/api/magic-link.routes.ts`
- Dashboard: `src/dashboard/{connect,api-keys}.{html,js}`, `src/dashboard/dashboard.css`
- Schema: `sql/migrations/004_dedup_v2_columns.sql`, `005_owner_id_backfill.sql`

---

## What's already done in shared infrastructure

These are SHARED across both repos — no work needed on the production side:

- **BigQuery schema** — migrations 002, 003, 004, 005 already applied to `togari_dnc` on `midyear-glazing-485303-u3`. Tables visible from any service with creds on that project.
- **Legacy data migration** — 2,135 historical contacts backfilled with `owner_id = 'env-default'`. Reassign to a real Auth0 sub with `npm run claim-contacts -- <auth0_sub>` when Karthik wants the contacts under his account.
- **Service account** — `togari-platform`'s existing SA already has BQ access on this project. Nothing to add.
- **Auth0 tenant** — `dev-4prs757badfajpi5.us.auth0.com` per memory.

---

## External work (the only real blockers)

Everything else is code-complete. These items are external clocks — start the long-lead ones now.

### 1. OAuth apps to register

| #   | Platform                    | Register at                                            | Credentials produced                                     | Set in togari-platform env as                                 | Time   |
| --- | --------------------------- | ------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------- | ------ |
| 1.1 | LinkedIn                    | https://www.linkedin.com/developers/apps/new           | Client ID + Secret                                       | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`                | 15 min |
| 1.2 | Meta (Instagram + Facebook) | https://developers.facebook.com/apps                   | App ID + Secret + Webhook verify token                   | `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` | 20 min |
| 1.3 | Twitter / X                 | https://developer.twitter.com/en/portal/dashboard      | OAuth 2.0 Client ID + Secret                             | `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`                  | 15 min |
| 1.4 | Google (Gmail + Contacts)   | https://console.cloud.google.com/apis/credentials      | OAuth Client ID + Secret. Enable Gmail API + People API. | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                    | 20 min |
| 1.5 | GitHub                      | https://github.com/settings/developers → New OAuth App | Client ID + Secret                                       | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                    | 10 min |
| 1.6 | Snapchat Kit                | https://kit.snapchat.com/portal                        | Client ID + Secret                                       | `SNAPCHAT_CLIENT_ID`, `SNAPCHAT_CLIENT_SECRET`                | 15 min |
| 1.7 | TikTok for Developers       | https://developers.tiktok.com/apps                     | Client Key + Secret                                      | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`                   | 15 min |

For each: set OAuth redirect URI to `https://<your-host>/dnc/authorize` (single shared callback; the `state` param routes per platform).

### 2. App reviews — long-lead, start today

| #   | What                                                                                                                | Where                                      | Expected duration |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------- |
| 2.1 | Meta App Review for `instagram_basic`, `instagram_manage_insights`, `instagram_manage_followers`, `pages_show_list` | Meta App Dashboard → App Review → Requests | 2–4 weeks         |
| 2.2 | Meta Business Verification (prerequisite for 2.1)                                                                   | Meta Business Settings → Security Center   | 1–7 days          |
| 2.3 | TikTok scope review for `user.info.stats`                                                                           | TikTok app dashboard → Scopes              | 1–2 weeks         |
| 2.4 | Snapchat Kit production access                                                                                      | Snap Kit portal → Submit for production    | ~1 week           |

### 3. Twitter — pick a tier

| Option                             | What you get                                                                          | Cost           |
| ---------------------------------- | ------------------------------------------------------------------------------------- | -------------- |
| **Free tier (Recommended for v1)** | Basic OAuth. Poll `/users/:id/following` every N minutes. Detect new follows by diff. | $0             |
| Pro tier                           | Account Activity API webhooks (real-time push)                                        | $5,000 / month |

Action: pick free unless there's a concrete feature that needs webhooks. Set `TWITTER_WEBHOOK_REGISTER=false`.

### 4. Slack — add `/togari` to the existing app

`togari-platform` already has a Slack app installed and signing-secret verified. We add `/togari` as another slash command on the **same** app, not a new one.

| #   | Step                                                                                                                                      | Where                                                    | Output                         | Time  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------ | ----- |
| 4.1 | Open the existing Togari Slack app                                                                                                        | https://api.slack.com/apps → pick the existing app       | App settings open              | 1 min |
| 4.2 | Add slash command `/togari` → request URL `https://<cloud-run-host>/slack/togari`                                                         | App settings → Slash Commands → Create New Command       | Slash command live             | 5 min |
| 4.3 | Confirm bot scopes include `commands`, `chat:write`, `users:read`                                                                         | App settings → OAuth & Permissions                       | Scopes verified                | 2 min |
| 4.4 | Reinstall the app to BMA workspace if scopes changed                                                                                      | Install App                                              | Refreshed bot token if changed | 1 min |
| 4.5 | Add `MAGIC_LINK_INTERNAL_SECRET` (any 32+ char hex) to togari-platform env. `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` are already set. | togari-platform env (Cloud Run / repo `.env` / wherever) | Magic-link issuance live       | 1 min |

### 5. Chrome extension

| #   | Step                                                                                                                                                                                                                                                                                                            | Where                                         | Time              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------- |
| 5.1 | `cd chrome-extension && zip -r ../togari-connect.zip . -x "tests/*"`                                                                                                                                                                                                                                            | Local                                         | 1 min             |
| 5.2 | Create Chrome Web Store dev account ($5 one-time)                                                                                                                                                                                                                                                               | https://chrome.google.com/webstore/devconsole | 10 min            |
| 5.3 | Upload zip, fill listing, submit for review                                                                                                                                                                                                                                                                     | Web Store dashboard                           | 20 min            |
| 5.4 | Wait for approval                                                                                                                                                                                                                                                                                               | n/a                                           | 1–3 business days |
| 5.5 | After approval: set `CHROME_EXTENSION_ID`, `CHROME_EXTENSION_STORE_URL` in togari-platform env. Also update `externally_connectable.matches` in `manifest.json` AND `TRUSTED_BACKENDS` in `background.js` (both lists must include the production domain; updating only one is a security hole), then re-upload | togari-platform env + repo                    | 15 min            |

### 6. Critical-path order

1. **Day 1 (synchronous):** run the port (Slack handler merge is the hardest item; the rest mostly auto-copy via `scripts/migrate-to-platform.sh`), register LinkedIn + GitHub OAuth apps, add `/togari` to the existing Slack app, deploy togari-platform, smoke-test. Ship a working LinkedIn-only product.
2. **Day 1 (start, finish later):** 2.1 Meta App Review, 2.2 Business Verification, 5 Chrome Web Store. External clocks — start them ticking before anything else.
3. **Day 2–3:** 1.3 Twitter (free), 1.4 Google, 1.7 TikTok, 1.6 Snapchat. Roll each out as OAuth approval lands.
4. **Week 2–4:** Meta approval lands → flip Instagram on. Chrome approval lands → flip LinkedIn auto-capture on.

LinkedIn alone is enough to start using the product in Clay. Everything else is incremental coverage.

---

## Post-deploy verification

| #   | Command                                                                   | Pass condition                                      |
| --- | ------------------------------------------------------------------------- | --------------------------------------------------- |
| 8.1 | `curl https://<host>/api/v1/health`                                       | 200 with `"ok": true` and `bigquery.ok: true`       |
| 8.2 | Issue a `tgi_live_*` key from the dashboard                               | Key returned, displays in API Keys list             |
| 8.3 | `npm run smoke -- https://<host> tgi_live_...`                            | All 5 steps PASS                                    |
| 8.4 | Slack: `/togari connect` in DM, click link, connect at least LinkedIn     | Reaches dashboard, OAuth completes                  |
| 8.5 | Clay column hits `POST /api/v1/people/match` against a known LinkedIn URL | Returns `matched: true` with the right `contact_id` |

---

## Troubleshooting playbook

| Symptom                                                              | Likely cause                                                   | Fix                                                                                                                                                       |
| -------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boot dies with `[env] FATAL: missing required env vars`              | Missing REQUIRED var                                           | Read the printed list, set in togari-platform env, redeploy                                                                                               |
| `/api/v1/health` returns 503 with `bigquery.ok: false`               | SA missing BQ access, or `GCP_CREDENTIALS_BASE64` malformed    | Re-encode JSON: `base64 -i sa.json \| tr -d '\n'`. Grant `roles/bigquery.dataEditor` + `roles/bigquery.jobUser` to the SA on `midyear-glazing-485303-u3`. |
| `POST /api/v1/people/match` returns 401 "Invalid or revoked API key" | Key revoked, mistyped, wrong env                               | Issue new key from dashboard. Confirm host.                                                                                                               |
| 401 "Invalid API key format"                                         | Missing `Bearer ` prefix or key doesn't start with `tgi_live_` | Header: `Authorization: Bearer tgi_live_...` exactly                                                                                                      |
| OAuth callback: "Invalid or expired OAuth state"                     | Token TTL is 10 min                                            | Restart connect flow. If it's everyone, confirm dashboard + `/dnc/authorize` are same-origin (state lives in process memory)                              |
| Instagram connect works for whitelisted accounts only                | Meta App Review pending                                        | Expected. Wait.                                                                                                                                           |
| Dashboard shows zero contacts; `bq` shows 2,135                      | Legacy rows owned by `'env-default'`                           | `npm run claim-contacts -- <your-auth0-sub>`                                                                                                              |
| Clay times out (>30s)                                                | Cold-start adds ~2s                                            | Check `/api/v1/health` BQ latency. Warm should be <500ms                                                                                                  |

---

## Common admin tasks

### Issue a key for a new BMA member

1. They log into the dashboard.
2. "API Keys" → "Create" → name it → copy `tgi_live_*` once.
3. Paste into Clay HTTP API account's `Authorization: Bearer ...`.
4. Verify: `npm run smoke -- https://<host> tgi_live_...`

### Revoke a key

Dashboard → API Keys → revoke icon. Or:

```sql
UPDATE `midyear-glazing-485303-u3.togari_dnc.api_keys`
SET revoked_at = CURRENT_TIMESTAMP()
WHERE key_prefix = 'tgi_live_XYZ';
```

### Reassign legacy contacts

```bash
npm run claim-contacts -- <auth0_sub> --dry-run
npm run claim-contacts -- <auth0_sub>
```

### Apply a new BQ migration

```bash
bq --project_id=midyear-glazing-485303-u3 query --use_legacy_sql=false --nouse_cache < sql/migrations/00X_whatever.sql
```

---

## Architecture cheat sheet

```
Clay column                                    Slack DM
   │ Authorization: Bearer tgi_live_*             │ /togari connect
   ▼                                              ▼
POST /api/v1/people/match  ──┐         POST /slack/togari
POST /api/v1/people          │            │
PATCH /api/v1/people/:id     │            ▼
POST /api/v1/people/:id/push-to-apple   src/dnc/integrations/slack-bot.ts
   │                         │            │ issue magic-link token
   ▼                         │            ▼
src/dnc/api/people.routes.ts │      GET /dashboard/auth?token=...
   │ validateApiKey          │            │ exchange for Auth0 session
   ▼                         │            ▼
src/dnc/dedup/matcher.ts ────┤      src/dashboard/connect.html
   ├─ priority match (single BQ round trip via CASE-WHEN rank)
   ├─ src/dnc/dedup/realness.ts (heuristic + Haiku)
   └─ writes to togari_dnc.contacts (filtered by owner_id)

src/dnc/workers/*-sync.ts ─→ togari_dnc.social_connections (raw firehose)
                          ─→ dedup engine consolidates into contacts
```

### BigQuery (`togari_dnc`)

| Object                                                                         | Type  | What it is                                                                                  |
| ------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------- |
| `contacts`                                                                     | TABLE | Unified deduped people. Source-tagged, owner-scoped, realness-scored.                       |
| `social_connections`                                                           | TABLE | Raw per-platform rows. Partitioned by `DATE(created_at)`.                                   |
| `api_keys`                                                                     | TABLE | Issued bearer tokens (SHA-256 hash + 12-char display prefix only). Clustered by `owner_id`. |
| `sync_log`                                                                     | TABLE | Audit trail per sync run.                                                                   |
| `contacts_pre_migration_2026_05_20`, `contacts_backup`                         | TABLE | Pre-migration snapshots. Drop after 90 days.                                                |
| `v_contacts_enriched`, `v_dnc_only`, `v_dnc_unified`, `v_dnc_unified_by_owner` | VIEW  | Convenience views. The last is the only owner-filtered one — prefer it.                     |

---

## Doc index

- This file — handoff, paths A/B, external work checklist
- [docs/CLAY_INTEGRATION.md](./CLAY_INTEGRATION.md) — how to paste keys into Clay columns
- [docs/SLACK_BOT_COMMANDS.md](./SLACK_BOT_COMMANDS.md) — `/togari` command reference
- [docs/PARALLEL_BUILD_PLAN.md](./PARALLEL_BUILD_PLAN.md) — the 8-workstream plan that produced this layer
- `scripts/migrate-to-platform.sh` — automation for the file copies

## Contact

- Caleb (calebnewtonusc) — author
- Sagar Tiwari — product strategy

All glory to God! ✝️❤️
