# Deploying from medha-sandbox

All active deployables live under `domains/`. Point hosting root directories at
these paths (do **not** keep deploying from the old sibling remotes).

## Services

| Service | Path | Host | Old remote (retire) |
| ------- | ---- | ---- | ------------------- |
| PeopleRank API | `domains/peoplerank` | Railway (Dockerfile) | `peoplerank-sandbox` |
| Tizzy web demo | `domains/tizzy` | Vercel | `tizzy` |
| ClearOut web | `domains/clearout/web` | Vercel | none (was deleted archive) |
| amber-core API | `ventures/core/amber-core/apps/api` | Railway | stay archive unless revived |
| amber-core worker | `ventures/core/amber-core/apps/worker` | Railway | stay archive unless revived |
| Voice adapter | `ventures/voice/amber-phone-call-ref` | Railway | stay archive unless revived |

macOS-only (`messages2`, `messages2kit`) are not cloud-deployed.

## One-time reconnect

### Railway — PeopleRank

1. Open the existing PeopleRank Railway service (or create a new one).
2. Set **Source repo** → `amber-organization/medha-sandbox`.
3. Set **Root Directory** → `domains/peoplerank`.
4. Builder: Dockerfile (`domains/peoplerank/Dockerfile`).
5. Copy env vars from the old `peoplerank-sandbox` service (`BLIND8_API_KEY`,
   `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, weight knobs, …).
6. Deploy from `main`.

`domains/peoplerank/railway.json` already points at the local Dockerfile.

### Vercel — Tizzy

1. Import or relink project to `amber-organization/medha-sandbox`.
2. **Root Directory** → `domains/tizzy`.
3. Framework: Next.js (see `domains/tizzy/vercel.json`).
4. Copy env (`ANTHROPIC_API_KEY`, …) from the old `tizzy` Vercel project.
5. Production branch: `main`. Redeploy.

### Vercel — ClearOut

1. Create/import Vercel project on `amber-organization/medha-sandbox`.
2. **Root Directory** → `domains/clearout/web`.
3. Env from `domains/clearout/web/.env.example` (Supabase, Google OAuth,
   Anthropic, `CRON_SECRET`).
4. Update Supabase Auth redirect URLs to the new Vercel host.
5. Production branch: `main`. Deploy.

## GitHub Actions

Workflows under `.github/workflows/` deploy on push to `main` when secrets exist:

| Secret | Used by |
| ------ | ------- |
| `RAILWAY_TOKEN` | `deploy-peoplerank.yml` |
| `VERCEL_TOKEN` | tizzy + clearout workflows |
| `VERCEL_ORG_ID` | tizzy + clearout |
| `VERCEL_PROJECT_ID_TIZZY` | `deploy-tizzy.yml` |
| `VERCEL_PROJECT_ID_CLEAROUT` | `deploy-clearout.yml` |

Without secrets, Actions stay no-op / fail-soft; dashboard reconnect still works.

## Local smoke before promote

```bash
./scripts/smoke.sh
./scripts/provenance-check.sh

# PeopleRank container
docker build -t peoplerank domains/peoplerank

# Next apps (needs node deps)
cd domains/tizzy && npm ci && npm run build
cd domains/clearout/web && npm ci && npm run build
```

## After reconnect

Safe to delete/archive: `peoplerank-sandbox`, `messages2` (see prior guidance).
Keep `messages2kit` until SPM consumers retarget; keep old `tizzy` remote until
Vercel is confirmed on medha-sandbox.
