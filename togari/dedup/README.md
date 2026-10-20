# Togari

GTM operating system for Blue Modern Advisory. Built on MCP, BigQuery, and a Clay-callable dedup API.

## Dedup v2 — what shipped

Togari's social-network unification and DNC dedupe layer turns scattered contacts across Apple, LinkedIn, Instagram, Twitter, Gmail, GitHub, TikTok, and Snapchat into a single deduped source-of-truth per user. The API is Clay-callable today; iOS-native later.

### What you get

- **Apple Contacts as source-of-truth** via CardDAV with iCloud app-specific password (read + write back).
- **Single-record matching** in BigQuery via priority chain: email → LinkedIn slug → phone E.164 → full name. Sub-second per Clay cell.
- **Long-lived bearer keys** (`tgi_live_*`) with SHA-256 hashing at rest. Issue, list, revoke from the dashboard.
- **Real-person classifier** that rejects orgs and bots via cheap heuristics, escalating ambiguous cases to Claude Haiku.
- **Per-user tenant isolation** with `owner_id` filtering on every BQ query.
- **Magic-link Slack onboarding** via `/togari connect` and `/togari status`.

### Architecture

```
Clay column                                    Slack DM
   │ Authorization: Bearer tgi_live_*             │ /togari connect
   ▼                                              ▼
POST /api/v1/people/match  ──┐         GET /dashboard/auth?token=...
POST /api/v1/people          │                  │
PATCH /api/v1/people/:id     │                  ▼
POST /api/v1/people/:id/push-to-apple   src/dashboard/connect.html
   │                         │            ├─ LinkedIn / IG / X / GitHub / Gmail / TikTok / Snapchat OAuth
   ▼                         │            ├─ Apple CardDAV credentials
src/dnc/dedup/matcher.ts    ─┤            └─ src/dashboard/api-keys.html (issue tgi_live_*)
   ├─ priority match (single BQ round trip)
   ├─ src/dnc/dedup/realness.ts (heuristic + Haiku)
   └─ writes to togari_dnc.contacts (owner_id scoped)

src/dnc/workers/*-sync.ts  ─→ togari_dnc.social_connections (raw firehose, owner_id scoped)
                          ─→ dedup engine consolidates into contacts
```

### BigQuery layout (`togari_dnc`)

- `contacts` — unified deduped people, source-tagged, realness-scored, owner-scoped.
- `social_connections` — raw per-platform rows, partitioned by `DATE(created_at)`, clustered on `platform, connection_type, is_dnc`.
- `api_keys` — issued bearer tokens (hash + 12-char display prefix only), clustered by `owner_id`.
- `sync_log` — audit trail for every poll/webhook run.
- Views: `v_contacts_enriched`, `v_dnc_only`, `v_dnc_unified`, `v_dnc_unified_by_owner`.

## Quickstart

### Run locally

```bash
npm install
cp .env.example .env   # fill in secrets
npm run dev            # starts on PORT=3000 with hot reload
```

### Typecheck + test

```bash
NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit
npx jest
```

### Required environment

| Var                         | Purpose                                                |
| --------------------------- | ------------------------------------------------------ |
| `GCP_PROJECT_ID`            | BigQuery project (default `midyear-glazing-485303-u3`) |
| `GCP_CREDENTIALS_BASE64`    | Service-account JSON, base64-encoded                   |
| `ANTHROPIC_API_KEY`         | Haiku classifier                                       |
| `LINKEDIN_CLIENT_ID/SECRET` | Self-serve LinkedIn OAuth                              |
| `META_APP_ID/SECRET`        | Instagram (Meta App Review required)                   |
| `TWITTER_CLIENT_ID/SECRET`  | X OAuth 2.0 with PKCE                                  |
| `GOOGLE_CLIENT_ID/SECRET`   | Gmail + Contacts                                       |
| `GITHUB_CLIENT_ID/SECRET`   | GitHub OAuth                                           |
| `SNAPCHAT_CLIENT_ID/SECRET` | Snapchat Kit                                           |
| `TIKTOK_CLIENT_KEY/SECRET`  | TikTok for Developers                                  |
| `SLACK_SIGNING_SECRET`      | `/togari` slash commands                               |
| `SLACK_BOT_TOKEN`           | DM the magic link                                      |
| `CHROME_EXTENSION_ID`       | LinkedIn cookie auto-capture                           |

## Docs

- [docs/PARALLEL_BUILD_PLAN.md](docs/PARALLEL_BUILD_PLAN.md) — the workstream breakdown that shipped this layer.
- [docs/CLAY_INTEGRATION.md](docs/CLAY_INTEGRATION.md) — paste-this-into-Clay guide.
- [docs/SLACK_BOT_COMMANDS.md](docs/SLACK_BOT_COMMANDS.md) — `/togari` command reference.

All glory to God! ✝️❤️
