# Demo Feedback Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three items from the 2026-07-21 demo feedback meeting plus the one still-missing spec feature: per-user API keys behind a Settings page, the wiki restyled into the dashboard's top-bar shell, and a promote-to-pipeline action in Mass Data.

**Architecture:** Extend the existing togari-bma hybrid connector. API keys live in the wiki Postgres (new table, `db.js`), are minted/revoked via new `/api/togari/settings` endpoints, and are accepted as an alternative Bearer credential in `requireBMAUser`. The Settings page and wiki restyle are React work inside the existing dash shell. Promote-to-pipeline reuses the existing `PATCH /api/togari/pipeline/:clientId` MCP write path.

**Tech Stack:** Express 5, pg, node:crypto, Vite 7 + React 18 plain JSX, react-router-dom v7, vitest + supertest, single BEM stylesheet `src/index.css`.

## Global Constraints

- NO em dashes and NO emojis anywhere: code, comments, UI copy, commit messages.
- Repo conventions override global UI rules: plain JSX (no TypeScript), no component libraries, no Tailwind. All styling goes in `src/index.css` using the existing custom properties (`--bg`, `--ink`, `--surface`, `--rule`, `--muted`, `--blue`, `--radius-sm`, `--radius-card`) and the `dash-` class prefix (wiki classes use `wiki-`).
- Every `/api/togari` response uses the envelope `{ success: true, data }` or `{ success: false, error }` via the `ok`/`fail`/`wrap` helpers in `server/togari/routes.js`.
- Server routes never crash on missing config: DB unavailable or `DATABASE_URL` unset returns a friendly 503 through `wrap`, matching the existing `togari_not_configured` pattern.
- Frontend async views always render loading, empty, and error states (existing `dash-grid__error` banner pattern).
- Tests: vitest + supertest, mock modules with regular `function` expressions (NOT arrow functions) because some are constructed with `new`.
- Commits: stage by filename, conventional message (`feat:`/`fix:`), no Co-Authored-By or AI attribution.
- API key format: `tbk_` + 32 lowercase hex chars from `crypto.randomBytes(16)`. Only the SHA-256 hex hash and the 12-char prefix are stored. The full key is returned exactly once, at creation.
- Demo fixtures in `dev/togariFixtures.js` must byte-match the production response contracts for every new endpoint.

---

### Task 1: Personal API keys, server side

**Files:**

- Modify: `server/db.js` (add table + key functions)
- Create: `server/togari/settings.js`
- Modify: `server/togari/routes.js` (register settings routes)
- Modify: `server/verify.js` (accept `tbk_` keys in `requireBMAUser`)
- Test: `server/togari/settings.test.js`, `server/verify.apikey.test.js`

**Interfaces:**

- Consumes: `getPool()` from `server/db.js`; `ok`/`fail`/`wrap`, `togariRouter` from `server/togari/routes.js`; `isBigQueryConfigured`/`isMcpConfigured`/`togariConfig` from `server/togari/config.js`.
- Produces (Task 2 relies on these exact shapes):
  - `GET /api/togari/settings` -> `{ success: true, data: { brand, bigquery, mcp, wikiDb, channels: [key], user: { email, name }, keys: [{ id, label, prefix, createdAt, lastUsedAt }] } }`
  - `POST /api/togari/settings/keys` body `{ label }` -> `{ success: true, data: { id, label, prefix, createdAt, key } }` (`key` is the full `tbk_...`, returned only here)
  - `DELETE /api/togari/settings/keys/:id` -> `{ success: true, data: { revoked: true } }`
  - `requireBMAUser` accepts `Authorization: Bearer tbk_...` and sets `req.user = { email, name, viaApiKey: true }`.

- [ ] **Step 1: Extend `server/db.js`**

Append to the `SCHEMA` constant a second statement (run with the same `pool.query(SCHEMA)` call; pg supports multi-statement simple queries):

```sql
  CREATE TABLE IF NOT EXISTS togari_api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email  TEXT NOT NULL,
    label       TEXT NOT NULL,
    key_hash    TEXT NOT NULL UNIQUE,
    key_prefix  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ
  );
```

Export three functions following the `listPages` style, each mapping rows to camelCase:

```js
export async function listApiKeys(email) {
  const db = await getPool();
  const { rows } = await db.query(
    `SELECT id, label, key_prefix, created_at, last_used_at
       FROM togari_api_keys
      WHERE user_email = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    [email],
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    prefix: r.key_prefix,
    createdAt: r.created_at.toISOString(),
    lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : null,
  }));
}

export async function insertApiKey({ email, label, hash, prefix }) {
  const db = await getPool();
  const { rows } = await db.query(
    `INSERT INTO togari_api_keys (user_email, label, key_hash, key_prefix)
     VALUES ($1, $2, $3, $4)
     RETURNING id, label, key_prefix, created_at`,
    [email, label, hash, prefix],
  );
  const r = rows[0];
  return {
    id: r.id,
    label: r.label,
    prefix: r.key_prefix,
    createdAt: r.created_at.toISOString(),
  };
}

export async function revokeApiKey({ email, id }) {
  const db = await getPool();
  const { rowCount } = await db.query(
    `UPDATE togari_api_keys SET revoked_at = now()
      WHERE id = $1 AND user_email = $2 AND revoked_at IS NULL`,
    [id, email],
  );
  return rowCount > 0;
}

export async function findApiKeyByHash(hash) {
  const db = await getPool();
  const { rows } = await db.query(
    `SELECT id, user_email, label FROM togari_api_keys
      WHERE key_hash = $1 AND revoked_at IS NULL`,
    [hash],
  );
  if (!rows[0]) return null;
  db.query("UPDATE togari_api_keys SET last_used_at = now() WHERE id = $1", [
    rows[0].id,
  ]).catch(() => {});
  return { id: rows[0].id, email: rows[0].user_email, label: rows[0].label };
}
```

- [ ] **Step 2: Write failing tests for `server/togari/settings.js`**

Follow the mocking pattern in `server/togari/management.test.js` (regular function expressions, `vi.mock` of `../db.js` and `./config.js`). Cover:

- `GET /settings` returns brand, flag booleans, user echo, and mapped keys.
- `GET /settings` with DB throwing `DATABASE_URL is not set` still returns 200 with `keys: []` and `wikiDb: false` (settings must load without Postgres).
- `POST /settings/keys` with `{ label: "Zapier" }` returns 200, `data.key` matches `/^tbk_[0-9a-f]{32}$/`, `data.prefix` is the first 12 chars of `data.key`.
- `POST /settings/keys` with missing/blank label returns 400.
- `POST /settings/keys` when DB unavailable returns 503.
- `DELETE /settings/keys/:id` returns `{ revoked: true }` when `revokeApiKey` resolves true, 404 when false.

- [ ] **Step 3: Run tests, verify FAIL**

Run: `npx vitest run server/togari/settings.test.js`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `server/togari/settings.js`**

```js
import crypto from "node:crypto";
import { ok, fail, wrap } from "./routes.js";
import {
  togariConfig,
  isBigQueryConfigured,
  isMcpConfigured,
} from "./config.js";
import { listApiKeys, insertApiKey, revokeApiKey } from "../db.js";

export const hashKey = (key) =>
  crypto.createHash("sha256").update(key).digest("hex");

export function registerSettingsRoutes(router) {
  router.get(
    "/settings",
    wrap(async (req, res) => {
      let keys = [];
      let wikiDb = true;
      try {
        keys = await listApiKeys(req.user.email);
      } catch {
        wikiDb = false;
      }
      ok(res, {
        brand: togariConfig.brand,
        bigquery: isBigQueryConfigured(),
        mcp: isMcpConfigured(),
        wikiDb,
        channels: togariConfig.channels.map((c) => c.key),
        user: { email: req.user.email, name: req.user.name },
        keys,
      });
    }),
  );

  router.post(
    "/settings/keys",
    wrap(async (req, res) => {
      const label = String(req.body?.label || "").trim();
      if (!label) return fail(res, 400, "A key label is required.");
      const key = "tbk_" + crypto.randomBytes(16).toString("hex");
      const prefix = key.slice(0, 12);
      let created;
      try {
        created = await insertApiKey({
          email: req.user.email,
          label: label.slice(0, 60),
          hash: hashKey(key),
          prefix,
        });
      } catch {
        return fail(
          res,
          503,
          "API keys need the wiki database, which is not connected.",
        );
      }
      ok(res, { ...created, key });
    }),
  );

  router.delete(
    "/settings/keys/:id",
    wrap(async (req, res) => {
      let revoked = false;
      try {
        revoked = await revokeApiKey({
          email: req.user.email,
          id: req.params.id,
        });
      } catch {
        return fail(
          res,
          503,
          "API keys need the wiki database, which is not connected.",
        );
      }
      if (!revoked) return fail(res, 404, "Key not found.");
      ok(res, { revoked: true });
    }),
  );
}
```

Register at the bottom of `server/togari/routes.js` alongside the other `register*` calls.

- [ ] **Step 5: Extend `requireBMAUser` in `server/verify.js`**

Before the Google verification, add:

```js
if (token.startsWith("tbk_")) {
  try {
    const { hashKey } = await import("./togari/settings.js");
    const { findApiKeyByHash } = await import("./db.js");
    const match = await findApiKeyByHash(hashKey(token));
    if (match) {
      req.user = { email: match.email, name: match.label, viaApiKey: true };
      return next();
    }
  } catch {
    // DB unavailable: fall through to 401 below
  }
  return res.status(401).json({ error: "Unauthorized" });
}
```

(Use dynamic imports as shown to avoid a static import cycle: routes.js -> settings.js -> ... -> verify.js is not currently a cycle, but verify.js -> settings.js -> routes.js would be. Dynamic import inside the handler avoids it entirely.)

Test in `server/verify.apikey.test.js`: valid key sets `req.user.viaApiKey`, revoked/unknown key gets 401, DB error gets 401, Google-token path still works (mock `google-auth-library` with a regular function expression constructor).

- [ ] **Step 6: Run all server tests, verify PASS**

Run: `npx vitest run server/`
Expected: all green, including the 30 pre-existing tests.

- [ ] **Step 7: Commit**

```bash
git add server/db.js server/togari/settings.js server/togari/routes.js server/verify.js server/togari/settings.test.js server/verify.apikey.test.js
git commit -m "feat: personal API keys with settings endpoints and key auth"
```

---

### Task 2: Settings page UI and demo fixtures

**Files:**

- Create: `src/pages/SettingsPage.jsx`
- Modify: `src/pages/DashboardLayout.jsx` (add Settings tab), `src/App.jsx` (route `/dash/settings`)
- Modify: `dev/togariFixtures.js` (settings fixtures)
- Modify: `src/index.css` (settings styles)

**Interfaces:**

- Consumes: Task 1's three endpoints exactly as specified; `apiFetch` from `src/lib/api.js`; `useApi` from `src/lib/useApi.js` (`{ loading, data, error, reload }`).
- Produces: route `/dash/settings` inside `DashboardLayout`; tab labeled `Settings` placed after `Clients`, before `Wiki`.

- [ ] **Step 1: Build `SettingsPage.jsx`**

Structure (all classes prefixed `dash-settings`):

- Page header (`dash-page-head` convention used by other pages): title "Settings", subtitle "Connection status and personal API keys."
- "Connections" card grid using the existing `StatCard` pattern or plain cards: Brand (value from `data.brand`, uppercase), BigQuery, Togari MCP, Wiki database. Boolean values render as a small pill: "Connected" (blue) or "Not connected" (muted). Channels listed as comma-joined text under the brand card.
- "API keys" section: intro line "Keys act as your login for scripts and integrations. Anyone holding a key can read and write Togari data as you."
  - Create row: text input (placeholder "Key label, e.g. Zapier") + "Create key" button. Disabled while submitting. On success, show a one-time reveal panel: the full key in a `<code>` block, a "Copy" button using `navigator.clipboard.writeText`, and the line "Copy it now. You will not see this key again." The panel stays until dismissed or another key is created.
  - Key list: table of label, prefix + ellipsis (`tbk_1234abcd...`), created date (`toLocaleDateString`), last used ("Never" when null), and a "Revoke" button per row with a `confirm()` guard. Empty state: "No keys yet."
  - All failures surface in a `dash-grid__error` banner; loading state is "Loading settings..."; when `data.wikiDb` is false, replace the create row with a muted notice: "API keys need the wiki database, which is not connected."
- After create or revoke, call `reload()` (keys list refreshes; the reveal panel must survive the reload, so hold the revealed key in local state, not derived from `data`).

- [ ] **Step 2: Wire tab + route**

`DashboardLayout.jsx` TABS: insert `{ to: "/dash/settings", label: "Settings" }` between Clients and Wiki. `App.jsx`: add `<Route path="settings" element={<SettingsPage />} />` inside the existing `/dash` layout route, matching how the other dash routes are declared.

- [ ] **Step 3: Fixtures**

In `dev/togariFixtures.js`, add matchers byte-matching Task 1's contracts:

- `GET /api/togari/settings`: brand "bma", bigquery true, mcp true, wikiDb true, channels `["email", "founder-marketing"]`, user `{ email: "dev@bluemodernadvisory.com", name: "Dev Preview" }`, and 2 seed keys (labels "Zapier import", "Reporting script"; realistic prefixes; one lastUsedAt null).
- `POST /api/togari/settings/keys`: echo label, generate a fake but format-valid `tbk_` key from a counter (no `Math.random`), id `key-3` style.
- `DELETE /api/togari/settings/keys/:id`: `{ success: true, data: { revoked: true } }`.

- [ ] **Step 4: Verify in dev server, run tests, commit**

Run: `npx vitest run server/` (must stay green) and `npm run build` (must succeed).
Manual check: `TOGARI_DEV_BYPASS_AUTH=1 npm run dev`, visit `/dash/settings`, create and revoke a key against fixtures.

```bash
git add src/pages/SettingsPage.jsx src/pages/DashboardLayout.jsx src/App.jsx dev/togariFixtures.js src/index.css
git commit -m "feat: settings page with connection status and API key management"
```

---

### Task 3: Wiki inside the dashboard shell

**Files:**

- Modify: `src/pages/WikiPage.jsx`, `src/App.jsx`, `src/index.css`

**Interfaces:**

- Consumes: `DashboardLayout` shell (`dash-topbar` with tabs, `dash-main` outlet).
- Produces: `/wiki` renders inside `DashboardLayout` (nested route), so the Togari top bar with the five tabs plus Settings is the ONLY primary chrome on the wiki.

Demo feedback being implemented, verbatim requirement: the wiki UI must match the Togari internal dashboard, with top-bar navigation, not a left sidebar.

- [ ] **Step 1: Re-route**

In `App.jsx`, move the `/wiki` route to be a child of the `DashboardLayout` route (path `/wiki` can stay absolute via a second child route or by moving wiki under the layout element; keep the URL `/wiki` unchanged so existing links and the Wiki tab keep working).

- [ ] **Step 2: Strip wiki-owned chrome**

In `WikiPage.jsx`: remove the wiki's own top header (brand, back-to-site link, user chip, sign-out) and the light/dark theme toggle (SunIcon/MoonIcon and associated state); the dash shell is light-only and already shows the user. Remove the left sidebar entirely.

- [ ] **Step 3: Horizontal page picker**

Replace the sidebar with a horizontal, wrap-friendly pill bar directly under the wiki page title, styled like the existing `dash-seg` control but scrollable on mobile (`overflow-x: auto`): one pill per page (static manifest pages plus custom pages), active pill uses the `dash-tab--active` treatment. The "New page" action becomes a pill-styled button at the end of the bar. Keep ALL existing functionality: static content components untouched, custom page create/edit/delete, attachments.

- [ ] **Step 4: CSS**

Add/adjust `wiki-` classes in `src/index.css` so the wiki content area uses the same width, background, and typography rhythm as the other dash pages. Delete now-dead wiki chrome CSS (old header/sidebar/dark-theme rules) rather than leaving it orphaned.

- [ ] **Step 5: Verify, commit**

`npm run build` green; dev-server manual pass at desktop and 390px width (pill bar scrolls, no horizontal page scroll).

```bash
git add src/App.jsx src/pages/WikiPage.jsx src/index.css
git commit -m "feat: move wiki under the dashboard shell with top-bar page picker"
```

---

### Task 4: Promote to pipeline from Mass Data

**Files:**

- Modify: `src/pages/MassDataPage.jsx`, `server/togari/companies.js` (only if `stage` is not already returned), `dev/togariFixtures.js`, `src/index.css`
- Test: extend `server/togari/companies.test.js` only if the server query changes

**Interfaces:**

- Consumes: existing `PATCH /api/togari/pipeline/:clientId` (body `{ name, stage }`, MCP `togari_client_upsert` write) and existing `GET /api/togari/companies`.
- Produces: a per-row "Promote" action on the Companies tab.

The original spec names this: view 1 needs a "promote to pipeline" action feeding view 3's kanban.

- [ ] **Step 1: Ensure `stage` is in the companies payload**

Read `server/togari/companies.js`. If the list query does not already select the client's `stage`, add it (and update the test's expected columns). Companies with a non-null stage are already in the pipeline.

- [ ] **Step 2: UI action**

In `MassDataPage.jsx`, Companies tab rows: when `stage` is null/empty, render a small "Promote" button (class `dash-row-action`); when set, render the stage name as a muted pill instead. Clicking Promote calls `apiFetch` `PATCH /api/togari/pipeline/${clientId}` with `{ name, stage: "Researching" }` ("Researching" is the first column of the live kanban, `STAGE_ORDER[0]`). While in flight, the button reads "Promoting..." and is disabled. On success, update that row locally to show the "Researching" pill (no full reload). On failure, show the existing `dash-grid__error` banner with the error message.

- [ ] **Step 3: Fixtures**

Confirm `dev/togariFixtures.js` already matches `PATCH /api/togari/pipeline/:clientId` (kanban demo uses it); if the companies fixture rows lack `stage`, add it, with at least 2 companies stageless so the button is demoable.

- [ ] **Step 4: Verify, commit**

`npx vitest run server/` green, `npm run build` green, dev-server manual pass: promote a stageless company, see the pill appear, find it on the Pipeline board's Researching column (fixtures permitting; if the fixture pipeline is a separate static list, note that in the report rather than wiring cross-fixture state).

```bash
git add src/pages/MassDataPage.jsx server/togari/companies.js server/togari/companies.test.js dev/togariFixtures.js src/index.css
git commit -m "feat: promote-to-pipeline action on the companies tab"
```
