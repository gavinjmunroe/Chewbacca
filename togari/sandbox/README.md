# togari-sandbox

Monorepo for Blue Modern Advisory / Togari internal tools. The root app is the BMA wiki and team portal (Vite + React 18 SPA served by Express 5 with Postgres). Sibling projects live in their own directories and keep independent package manifests and deploys.

| Directory | What it is |
| --------- | ---------- |
| *(root)* | Wiki + Togari dashboard (`togari-bma`) |
| `amber-chrome/` | Chrome extension |
| `bma-expenses-bot/` | Slack expenses bot |
| `togari-schedule/` | Clay MCP / GTM automation |
| `togari-stitch/` | Stitch service |

## Routes

| Route          | What it is                                      | Access                                    |
| -------------- | ----------------------------------------------- | ----------------------------------------- |
| `/`            | Redirects to `/wiki`                            | -                                         |
| `/login`       | Google sign-in for the wiki                     | Public page, org-gated sign-in            |
| `/wiki`        | The wiki: static docs plus member-created pages | `@bluemodernadvisory.com` Google accounts |
| `/get-started` | Signup form stub (not wired up)                 | Public                                    |
| `/bma-login`   | Shared-password gate for the team portal        | Public                                    |
| `/team`        | Internal team dashboard placeholder             | Behind the shared password                |

Auth is two separate systems: Google Identity Services ID tokens verified server-side (`server/verify.js`, domain-locked via `ALLOWED_DOMAIN`) gate the wiki and its API; a shared password (`VITE_PORTAL_PASSWORD`, checked client-side, ships in the bundle) gates `/team`.

## Develop

```bash
npm install
cp .env.example .env   # fill in values
npm run dev
```

`vite dev` serves a local mock of the API (`localFunctionsPlugin` in `vite.config.js`): `/api/auth` verifies real Google tokens, and `/api/wiki-pages` persists to `.netlify/wiki-pages.json` (gitignored). No database needed for local work.

## Production

```bash
npm run build   # -> dist/
npm start       # Express serves dist/ + /api/auth + /api/wiki-pages
```

Deployed on Railway (Nixpacks auto-detects the build/start scripts). The `wiki_pages` table auto-creates on first query. Env vars: see `.env.example`. `VITE_*` values are baked in at build time, so changing them on Railway requires a redeploy.

## Togari dashboard

Post-login dashboard over the Togari backend (amber-organization/togari-platform).
Reads BigQuery directly (`togari_pdw`, `togari_data_lake`) for grids and analytics;
writes, chat, and refresh go through Togari's MCP tools. Views: Mass Data, Channels,
Pipeline, Clients (management), Wiki. Every row click opens a drill-down with
analytics for that entity. Requires GCP_CREDENTIALS_BASE64, TOGARI_MCP_URL, and
TOGARI_MCP_TOKEN; without them the wiki still works and dashboard endpoints
return togari_not_configured. In development, `npm run dev` serves realistic
fixture data for every dashboard view, so the full UI is browsable with no
credentials.

---

Built with D1 Vibe Coding
