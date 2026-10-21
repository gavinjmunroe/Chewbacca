# Trek — Amber Handoff

This directory is a vendored copy of the Trek self-hosted travel planner,
imported from `https://github.com/amber-organization/trek` so we can
archive/delete that standalone repo without losing source history or the
ability to run Trek for reference.

## Origin

- Upstream repo: `amber-organization/trek`
- Imported at commit: `ca832e8d883a88f21ad35d51556c065bb28607c2` (v3.0.10)
- Imported on: 2026-04-27
- Importer: amber-agent migration (PR `vendor/trek-into-newton`)

The repo's full git history is **not** preserved here — see the upstream
GitHub repo (or any local mirror) if you need blame/log. The migration
PR retains the upstream HEAD reference above so you can always recover
the exact tree.

## What was vendored vs. trimmed

To keep the amber-agent PR reviewable, the following heavy binary
artefacts were excluded:

| Excluded path                               | Why                                |
| ------------------------------------------- | ---------------------------------- |
| `.git/`                                      | Nested git repo                    |
| `wiki/assets/` (~17 MB of screenshots)       | Reproducible from upstream         |
| `docs/screenshots/` (~3.6 MB)                | Reproducible from upstream         |
| `server/public/assets/index-*.js,*.css`      | Vite build output of `client/`     |
| `server/public/{sw,registerSW,workbox}*.js`  | Vite-PWA build output              |
| `server/public/{index.html,manifest.webmanifest}` | Build output                  |

Everything else — server source, client source, MCP definitions, scripts,
tests, charts, docker config, wiki markdown, addons, and assets like
`server/assets/airports.json` — is preserved verbatim.

If you need the trimmed assets, re-clone the upstream repo at the commit
above and merge them back in, or rebuild the client locally
(`cd client && npm ci && npm run build`).

## Ownership in amber-agent

Trek is **not wired into the amber-agent runtime.** The amber-agent
already replaced the TREK-MCP HTTP proxy with a native in-process
implementation; see `Newton/agent/lib/tools/travel.js` (Camber/Samber
trip planning is fully handled there, no external TREK service needed).

This vendored copy exists for:

1. **Source preservation** — so the standalone repo can be archived.
2. **Reference** — the MCP tool surface in `server/src/mcp/tools/` and
   the storage shapes in `server/src/db/` are still useful design
   reference for the native implementation.
3. **Re-activation** — should we ever want to host Trek again (PWA/map
   UI, multi-user collab), the source is here and runnable.

There is **no** import path from amber-agent code into this directory.
Linting, tests, and `node --check` in the amber-agent CI **skip** this
folder.

## Running Trek standalone

The fastest path is Docker:

```bash
cd Newton/trek
docker compose up --build
```

Or, with Node 22+ for development:

```bash
# Server
cd Newton/trek/server
npm ci
npm run dev          # listens on :3001

# Client (separate terminal)
cd Newton/trek/client
npm ci
npm run dev          # Vite dev server, proxies API to :3001
```

Both have full vitest suites:

```bash
cd Newton/trek/server && npm test
cd Newton/trek/client && npm test
```

See `Newton/trek/README.md` (the upstream README) and
`Newton/trek/MCP.md` for full configuration, env vars, and the MCP
tool surface.

## Smoke validation

A static smoke check lives at
`Newton/agent/lib/__tests__/trek-vendor.test.mjs`. It verifies the
vendored tree contains the entry points and configs we expect (server
`src/index.ts`, client `package.json`, MCP definitions, etc.) without
actually running Trek. This protects the migration from accidental
deletions.

## Deletion readiness

The standalone `amber-organization/trek` repo can be archived (and later
deleted) once:

1. The amber-agent PR vendoring this tree is merged to `main`.
2. A team member has confirmed the smoke test passes on `main`.
3. Any open PRs / issues in the upstream repo are triaged or migrated.
4. Docker Hub publish workflow (`.github/workflows/`) is either
   re-pointed at this repo or sunset.

The upstream repo should be **archived first**, kept read-only for a
grace period (≥30 days suggested) while consumers update bookmarks, and
only then deleted. **Do not delete before the migration PR is merged.**
