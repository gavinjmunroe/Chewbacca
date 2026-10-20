# Togari Dashboard Polish + Demo Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shipped five-view dashboard demonstrable and polished before live credentials arrive: dev-only demo fixtures, a visual QA pass, the review-logged minor fixes, and a Companies tab in Mass Data.

**Architecture:** Demo data lives ONLY in the vite dev middleware (`localFunctionsPlugin` in vite.config.js), mirroring the exact response contracts of the production `/api/togari` routes; production code paths are untouched by fixtures. The Companies tab adds one read-only server endpoint over `togari_data_lake.clients` and a tab toggle inside MassDataPage reusing DataGrid and the existing client drill endpoint.

**Tech Stack:** unchanged (Vite 7, React 18, Express 5, vitest, plain JS).

## Global Constraints

- No em dashes or emojis anywhere (code, comments, commits, UI copy).
- Plain JS/JSX ES modules; single BEM stylesheet src/index.css with the light editorial palette custom properties (--bg, --ink, --surface, --rule, --muted, --blue, --radius-sm, --radius-card); APPEND CSS only.
- Fixtures are DEV-ONLY: they live in vite.config.js middleware plus a fixtures file imported only there. `npm run build` output and server/ runtime must not include or serve fixture data. No demo flags in server/togari/.
- Fixture response shapes MUST byte-match the production contracts (envelope `{ success: true, data }`; field names exactly as the server modules emit them; timestamps as ISO strings for channel lastActivity, `{ value: "ISO" }` objects for BigQuery passthrough fields like last_interaction_at, occurred_at, due_date, updated_at).
- All server SQL parameterized; BigQuery read-only; every new /api/togari route behind the existing requireBMAUser mount.
- Tests: every new/changed server endpoint gets vitest coverage in server/togari/\*.test.js. Frontend verified by `npm test && npm run build`.
- Stage by filename; NO Co-Authored-By or AI attribution in commit messages; commit per task.
- Do not touch wiki code, auth code, or the other session's working-tree edits.

---

### Task A: Dev-only demo fixtures for every /api/togari endpoint

**Files:**

- Create: `dev/togariFixtures.js` (fixture data + route map; dev-only, imported solely by vite.config.js)
- Modify: `vite.config.js` (extend `localFunctionsPlugin` middleware to serve `/api/togari/*` from the fixture map during `vite dev`)

**Interfaces:**

- Produces: `togariFixtureRoutes` export: `{ "GET /api/togari/status": data, "GET /api/togari/people": data, ... }` covering: status (bigquery:true, mcp:true, demo:true added field), people list (25 realistic B2B people with person_id, full_name, company, title, email, relationship_score, interaction_count, last_interaction_at as { value }), person detail for every listed person_id (entity, related.interactions 5-12 rows, analytics.byChannel/monthly 12 months/avgSentiment), channels summary (both configured keys with plausible stats), channel detail per key (weekly 12 rows, topPeople 8 rows whose person_ids EXIST in the people fixture so chained drill-down works), pipeline (stages prospect/outreach/call/proposal/won with 2-5 clients each), client detail for every client_id (entity, related.tasks/context, analytics), management (3 won clients, one with slack_url+contract_url attributes, one with empty attributes), chat POST (returns a canned but sensible answer mentioning the demo data), refresh POST (returns a summary string), pipeline PATCH (returns { moved: true, stage } echoing the body).
- Middleware behavior: only active in dev server; matches method + path (including /:id segments); unknown /api/togari paths return 404 envelope; POST/PATCH bodies read but only echoed where the contract needs it.
- Fixture people/companies must read as real (varied names, realistic companies and titles, no "Test User 1", no lorem ipsum).

**Steps:**

- [ ] Write dev/togariFixtures.js with the full fixture set and a `matchFixture(method, url)` helper handling path params.
- [ ] Wire it into vite.config.js's existing localFunctionsPlugin middleware ahead of the auth/wiki mocks, gated to the dev server only.
- [ ] Verify: `npm run build` passes AND `grep -r "togariFixtures" dist/ server/` finds nothing.
- [ ] Verify by running `npm run dev` and curling 4 representative endpoints (people, channels/email, pipeline, management); confirm envelope + field names match the production modules (read server/togari/\*.js to cross-check).
- [ ] Commit: `feat: dev-only demo fixtures for the togari dashboard`

### Task B: Review-logged minor fixes

**Files:**

- Modify: `src/pages/MassDataPage.jsx` (debounce), `src/pages/ChannelDrillPage.jsx` + `server/togari/channels.js` (window consistency), `src/components/togari/ChatPanel.jsx` (stable keys, aria-label), `src/components/togari/DataGrid.jsx` (search aria-label)
- Test: extend `server/togari/channels.test.js` if the SQL changes

**Interfaces / exact fixes:**

1. Search debounce: keep the input controlled by immediate `search` state, but derive the fetch path from a `debouncedSearch` state updated via a 300ms setTimeout effect (clear on change/unmount). No new dependencies.
2. Channel drill window consistency: scope the topPeople query in server/togari/channels.js to the same 84-day window as weekly (`AND i.occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 84 DAY)`), update its test mock/assertions if needed, and change the ChannelDrillPage "Who is reacting" section heading to "Who is reacting, last 12 weeks".
3. ChatPanel: replace index keys with a monotonically increasing id captured when the message is appended (`useRef` counter); add `aria-label="Message Togari"` to the input.
4. DataGrid search input: add `aria-label="Search records"`.

**Steps:**

- [ ] Apply fixes 1-4 exactly as specified; run `npm test && npm run build` (both must pass; update channel test expectations for the added WHERE clause).
- [ ] Commit: `fix: search debounce, channel window consistency, input labels, stable chat keys`

### Task C: Companies tab in Mass Data Explorer

**Files:**

- Create: `server/togari/companies.js`
- Modify: `server/togari/routes.js` (register), `src/pages/MassDataPage.jsx` (People | Companies toggle), `src/App.jsx` only if a new drill route is needed (it is not: company rows navigate to the existing `/dash/clients/:clientId` drill)
- Test: `server/togari/companies.test.js`
- Fixtures: extend `dev/togariFixtures.js` with the companies list

**Interfaces:**

- `GET /api/togari/companies?search=&limit=&offset=` over `togari_data_lake.clients` where `client_brand = @brand`: rows `client_id, name, stage, pipeline, owner, status, primary_email, primary_domain, updated_at`, plus `{ rows, total }` exactly like /people; search matches name or primary_domain case-insensitively; limit capped at 500; parameterized; read-only.
- MassDataPage: a two-segment toggle (BEM: `dash-seg`, `dash-seg__btn`, `dash-seg__btn--active`) above the grid switching between the existing people grid and a companies grid (columns: Name, Stage, Owner, Status, Domain, Updated). Company row click navigates to `/dash/clients/${row.client_id}`. Shared search box semantics per tab (search state resets on tab switch). Chat panel and refresh button remain visible on both tabs.
- Tests mirror people.test.js: list with total, search param passthrough, empty state.

**Steps:**

- [ ] TDD the companies endpoint (failing test, implement, pass, full suite).
- [ ] Add the toggle + companies grid to MassDataPage; append the dash-seg styles (light palette).
- [ ] Extend fixtures with 10 companies whose client_ids exist in the pipeline/client-detail fixtures.
- [ ] `npm test && npm run build` green.
- [ ] Commit: `feat: companies tab in mass data explorer`

### Task D: Visual QA loop against demo mode

**Files:**

- Modify: whatever the QA verdict demands (CSS, page tweaks); no contract changes.

**Process (run inside a single subagent that returns only verdicts, never screenshots):**

- [ ] Start `npm run dev` on an unused port. Use Playwright (isolated context, its own browser; never chrome-devtools MCP). Before page load, seed localStorage with a fake session for the keys AuthContext reads (`bma_google_session` with `{ email: "demo@bluemodernadvisory.com", name: "Demo User", initials: "DU" }` shape per AuthContext.jsx, and `bma_google_cred` with any string) so /dash renders; the dev fixture middleware answers the API calls.
- [ ] Screenshot at 1440x900 and 390x844: /dash/data (both tabs), a person drill, /dash/channels, a channel drill, /dash/pipeline, a client drill, /dash/clients, plus the chat panel with one sent message.
- [ ] Judge each against: consistent spacing/typography with the shell, no overflow/clipped text, empty/loading/error states not visible when data present, kanban columns usable at laptop width, mobile does not horizontally scroll, funded-startup bar overall.
- [ ] Fix every failure found, re-screenshot to confirm, then `npm test && npm run build`.
- [ ] Commit: `fix: visual QA pass over demo-mode dashboard`

### Task E: Wrap-up

- [ ] Final whole-branch review (this plan's range), fix wave if needed.
- [ ] Update README dashboard section with one line on demo mode (`npm run dev` serves fixture data for all dashboard views; production needs the env vars).
- [ ] Push to origin main.
