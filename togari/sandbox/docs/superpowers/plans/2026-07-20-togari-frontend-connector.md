# Togari Frontend Connector + Five-View Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the Togari backend (amber-organization/togari-platform) to the togari-bma dashboard through a reusable connector layer, and ship five views (Mass Data, Channels, Pipeline, Management, Wiki) where every click on an entity drills into detailed analytics for that exact thing.

**Architecture:** The togari-bma Express server becomes the "Togari connector": it reads BigQuery directly (`togari_pdw` for the people/interactions graph, `togari_data_lake` for clients/tasks/context) and exposes typed JSON REST endpoints under `/api/togari`, all gated by the existing Google OAuth middleware. Writes, natural-language chat, and data refresh go through an MCP client that calls togari-platform's V1 tools (`togari_ask`, `togari_client_upsert`, `togari_context_add`, `togari_pull`) over Streamable HTTP. The React SPA adds a five-tab dashboard shell where every list endpoint has a sibling `/:id` detail endpoint returning an `analytics` object, rendered by one shared DrillDown component.

**Tech Stack:** Vite 7 + React 18 (JSX, no TypeScript), react-router-dom v7, Express 5, `@google-cloud/bigquery`, `@modelcontextprotocol/sdk` (MCP client), existing Google OAuth (`server/verify.js`), existing Postgres wiki. Tests: vitest + supertest with vi.mock.

## Global Constraints

- No em dashes and no emojis anywhere: copy, code comments, commit messages.
- Plain JavaScript ES modules only, no TypeScript, matching the existing repo.
- Express 5: never use a bare `*` route; use middleware fallbacks (see existing `server/index.js`).
- Every `/api/togari/*` route is mounted behind `requireBMAUser` from `server/verify.js`. No new auth systems.
- All API responses use the envelope `{ success: true, data }` or `{ success: false, error }` (matches togari-platform's REST convention).
- All BigQuery SQL uses named parameters (`@param`), never string interpolation.
- BigQuery is READ-ONLY from this repo. All writes go through MCP tools on togari-platform. Never INSERT/UPDATE/DELETE via BigQuery.
- Brand/tenant values come from `server/togari/config.js`, never hardcoded in queries or components, so the same connector can later serve Ritual, Amber, and Silo.
- GCP project: `midyear-glazing-485303-u3`. Datasets: `togari_pdw` (persons, interactions), `togari_data_lake` (clients, client_tasks, client_context).
- Drill-down convention (applies to every view): every list endpoint `GET /api/togari/<collection>` has a sibling `GET /api/togari/<collection>/:id` returning `{ entity, related, analytics }`; every grid row click navigates to a drill route rendering the shared `DrillDown` component. No dead-end rows.
- Styling continues the existing single-stylesheet BEM approach in `src/index.css`, prefix `dash-`. UI must clear the funded-startup quality bar (consult `~/.claude/rules/design.md` before frontend tasks; consult the dataviz skill before writing chart code).
- Keep the wiki (`/wiki`, `WikiPage.jsx`, wiki endpoints) working untouched except for navigation integration.
- Commit after every task. Do not touch the bma_website repo.

**New env vars (server-side, set in `.env` locally and Railway in prod):**

```
GCP_PROJECT_ID=midyear-glazing-485303-u3
GCP_CREDENTIALS_BASE64=            # base64 service-account JSON with BigQuery read access (from Sagar/Karthik)
TOGARI_MCP_URL=                    # e.g. https://<togari-platform>.up.railway.app/mcp
TOGARI_MCP_TOKEN=                  # matches MCP_BEARER_TOKEN (or a signed JWT if MCP_JWT_SECRET is set) on togari-platform
TOGARI_BRAND=bma
TOGARI_OWNER_ID=sagar
```

Endpoints degrade gracefully when these are unset: BigQuery-backed routes return `{ success: false, error: "togari_not_configured" }` with status 503, and `GET /api/togari/status` reports which pieces are configured.

---

### Task 0: Baseline commit and test harness

**Files:**

- Modify: `package.json` (add devDeps + test script)
- Create: `vitest.config.js`
- Commit: the 4 already-modified files (`index.html`, `src/components/AuthComponents.jsx`, `src/components/GoogleSignInButton.jsx`, `src/index.css`)

**Interfaces:**

- Produces: `npm test` runs vitest over `server/**/*.test.js`.

- [ ] **Step 1: Commit the pre-existing working-tree changes so the plan starts clean**

```bash
cd ~/Desktop/code/togari-bma
git add index.html src/components/AuthComponents.jsx src/components/GoogleSignInButton.jsx src/index.css
git commit -m "chore: commit in-flight auth UI tweaks before dashboard work"
```

- [ ] **Step 2: Install test dependencies and runtime dependencies for the connector**

```bash
npm install @google-cloud/bigquery @modelcontextprotocol/sdk
npm install -D vitest supertest
```

- [ ] **Step 3: Add the test script and vitest config**

In `package.json` scripts add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Create `vitest.config.js`:

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.js"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Verify the harness runs (0 tests is fine)**

Run: `npm test`
Expected: vitest exits reporting "No test files found" or 0 tests, exit code may be non-zero for no tests; add `passWithNoTests: true` to the `test` block in `vitest.config.js` so it exits 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.js
git commit -m "chore: add vitest harness and connector dependencies"
```

---

### Task 1: Togari config module

**Files:**

- Create: `server/togari/config.js`
- Test: `server/togari/config.test.js`

**Interfaces:**

- Produces: `togariConfig` object with `{ brand, ownerId, gcpProjectId, gcpCredentialsBase64, datasets: { lake, pdw }, mcpUrl, mcpToken, channels }` and helpers `isBigQueryConfigured()`, `isMcpConfigured()`. `channels` is `[{ key, label, interactionChannels }]`.

- [ ] **Step 1: Write the failing test**

```js
// server/togari/config.test.js
import { describe, it, expect } from "vitest";
import {
  togariConfig,
  isBigQueryConfigured,
  isMcpConfigured,
} from "./config.js";

describe("togariConfig", () => {
  it("defaults brand, owner, project, and datasets", () => {
    expect(togariConfig.brand).toBe("bma");
    expect(togariConfig.ownerId).toBe("sagar");
    expect(togariConfig.gcpProjectId).toBe("midyear-glazing-485303-u3");
    expect(togariConfig.datasets).toEqual({
      lake: "togari_data_lake",
      pdw: "togari_pdw",
    });
  });

  it("defines the two launch channels", () => {
    const keys = togariConfig.channels.map((c) => c.key);
    expect(keys).toEqual(["email", "founder-marketing"]);
  });

  it("reports unconfigured when env vars are missing", () => {
    expect(typeof isBigQueryConfigured()).toBe("boolean");
    expect(typeof isMcpConfigured()).toBe("boolean");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/togari/config.test.js`
Expected: FAIL, cannot find module `./config.js`

- [ ] **Step 3: Write the implementation**

```js
// server/togari/config.js
export const togariConfig = {
  brand: process.env.TOGARI_BRAND || "bma",
  ownerId: process.env.TOGARI_OWNER_ID || "sagar",
  gcpProjectId: process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3",
  gcpCredentialsBase64:
    process.env.GCP_CREDENTIALS_BASE64 ||
    process.env.GOOGLE_CREDENTIALS_BASE64 ||
    "",
  datasets: { lake: "togari_data_lake", pdw: "togari_pdw" },
  mcpUrl: process.env.TOGARI_MCP_URL || "",
  mcpToken: process.env.TOGARI_MCP_TOKEN || "",
  channels: [
    { key: "email", label: "Email Outbound", interactionChannels: ["gmail"] },
    {
      key: "founder-marketing",
      label: "Founder Marketing",
      interactionChannels: ["linkedin", "slack", "manual"],
    },
  ],
};

export function isBigQueryConfigured() {
  return Boolean(togariConfig.gcpCredentialsBase64);
}

export function isMcpConfigured() {
  return Boolean(togariConfig.mcpUrl);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/togari/config.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/togari/config.js server/togari/config.test.js
git commit -m "feat: togari connector config module"
```

---

### Task 2: BigQuery read client

**Files:**

- Create: `server/togari/bigquery.js`
- Test: `server/togari/bigquery.test.js`

**Interfaces:**

- Consumes: `togariConfig`, `isBigQueryConfigured` from Task 1.
- Produces: `runQuery(sql, params = {}) -> Promise<rows[]>` (throws `Error("togari_not_configured")` when BigQuery creds are missing), `table(datasetKey, name) -> string` returning a fully qualified backtick-quoted table id, `_resetForTests()`.

- [ ] **Step 1: Write the failing test**

```js
// server/togari/bigquery.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn().mockResolvedValue([[{ ok: 1 }]]);
vi.mock("@google-cloud/bigquery", () => ({
  BigQuery: vi.fn().mockImplementation(() => ({ query: queryMock })),
}));

describe("bigquery client", () => {
  beforeEach(() => vi.resetModules());

  it("table() builds a fully qualified id", async () => {
    const { table } = await import("./bigquery.js");
    expect(table("pdw", "persons")).toBe(
      "`midyear-glazing-485303-u3.togari_pdw.persons`",
    );
  });

  it("runQuery throws togari_not_configured without credentials", async () => {
    delete process.env.GCP_CREDENTIALS_BASE64;
    delete process.env.GOOGLE_CREDENTIALS_BASE64;
    const { runQuery } = await import("./bigquery.js");
    await expect(runQuery("SELECT 1")).rejects.toThrow("togari_not_configured");
  });

  it("runQuery passes sql and named params through", async () => {
    process.env.GCP_CREDENTIALS_BASE64 = Buffer.from(
      JSON.stringify({ client_email: "t@t", private_key: "k" }),
    ).toString("base64");
    const { runQuery } = await import("./bigquery.js");
    const rows = await runQuery("SELECT @a AS ok", { a: 1 });
    expect(rows).toEqual([{ ok: 1 }]);
    expect(queryMock).toHaveBeenCalledWith({
      query: "SELECT @a AS ok",
      params: { a: 1 },
    });
    delete process.env.GCP_CREDENTIALS_BASE64;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/togari/bigquery.test.js`
Expected: FAIL, cannot find module `./bigquery.js`

- [ ] **Step 3: Write the implementation**

Note: because the test uses `vi.resetModules()` and re-imports, `config.js` re-reads env on import, which is why config values are read inside the module body.

```js
// server/togari/bigquery.js
import { BigQuery } from "@google-cloud/bigquery";
import { togariConfig, isBigQueryConfigured } from "./config.js";

let client;

function getClient() {
  if (!client) {
    const options = { projectId: togariConfig.gcpProjectId };
    const creds = togariConfig.gcpCredentialsBase64;
    if (creds) {
      options.credentials = JSON.parse(
        Buffer.from(creds, "base64").toString("utf8"),
      );
    }
    client = new BigQuery(options);
  }
  return client;
}

export function table(datasetKey, name) {
  const dataset = togariConfig.datasets[datasetKey];
  return `\`${togariConfig.gcpProjectId}.${dataset}.${name}\``;
}

export async function runQuery(sql, params = {}) {
  if (!isBigQueryConfigured()) {
    throw new Error("togari_not_configured");
  }
  const [rows] = await getClient().query({ query: sql, params });
  return rows;
}

export function _resetForTests() {
  client = undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/togari/bigquery.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/togari/bigquery.js server/togari/bigquery.test.js
git commit -m "feat: read-only BigQuery client for togari datasets"
```

---

### Task 3: MCP client wrapper for togari-platform

**Files:**

- Create: `server/togari/mcpClient.js`
- Test: `server/togari/mcpClient.test.js`

**Interfaces:**

- Consumes: `togariConfig`, `isMcpConfigured` from Task 1.
- Produces: `callTogariTool(name, args) -> Promise<{ raw, parsed }>` where `parsed` is `JSON.parse` of the joined text content when possible, else the raw text string. Throws `Error("togari_not_configured")` when `TOGARI_MCP_URL` is unset. Reconnects on failure (togari-platform loses MCP sessions on every redeploy, so one retry with a fresh connection is mandatory). `_resetForTests()`.

- [ ] **Step 1: Write the failing test**

```js
// server/togari/mcpClient.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

const callToolMock = vi.fn();
const connectMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: connectMock,
    callTool: callToolMock,
  })),
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn(),
}));

describe("callTogariTool", () => {
  beforeEach(() => {
    vi.resetModules();
    callToolMock.mockReset();
    connectMock.mockClear();
  });

  it("throws when MCP is not configured", async () => {
    delete process.env.TOGARI_MCP_URL;
    const { callTogariTool } = await import("./mcpClient.js");
    await expect(
      callTogariTool("togari_ask", { question: "hi" }),
    ).rejects.toThrow("togari_not_configured");
  });

  it("parses JSON text content", async () => {
    process.env.TOGARI_MCP_URL = "https://example.com/mcp";
    callToolMock.mockResolvedValue({
      content: [{ type: "text", text: '{"client":{"name":"Acme"}}' }],
    });
    const { callTogariTool } = await import("./mcpClient.js");
    const { parsed } = await callTogariTool("togari_client_get", {
      client_id: "acme",
    });
    expect(parsed).toEqual({ client: { name: "Acme" } });
    delete process.env.TOGARI_MCP_URL;
  });

  it("retries once with a fresh connection after a transport error", async () => {
    process.env.TOGARI_MCP_URL = "https://example.com/mcp";
    callToolMock
      .mockRejectedValueOnce(new Error("session expired"))
      .mockResolvedValueOnce({ content: [{ type: "text", text: "answer" }] });
    const { callTogariTool } = await import("./mcpClient.js");
    const { parsed } = await callTogariTool("togari_ask", { question: "q" });
    expect(parsed).toBe("answer");
    expect(callToolMock).toHaveBeenCalledTimes(2);
    delete process.env.TOGARI_MCP_URL;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/togari/mcpClient.test.js`
Expected: FAIL, cannot find module `./mcpClient.js`

- [ ] **Step 3: Write the implementation**

```js
// server/togari/mcpClient.js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { togariConfig, isMcpConfigured } from "./config.js";

let clientPromise;

async function connect() {
  const url = new URL(togariConfig.mcpUrl);
  if (togariConfig.mcpToken) {
    url.searchParams.set("token", togariConfig.mcpToken);
  }
  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client({ name: "togari-bma-dashboard", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

function extractText(result) {
  return (result.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

export async function callTogariTool(name, args, { retried = false } = {}) {
  if (!isMcpConfigured()) {
    throw new Error("togari_not_configured");
  }
  if (!clientPromise) clientPromise = connect();
  let client;
  try {
    client = await clientPromise;
    const raw = await client.callTool({ name, arguments: args });
    const text = extractText(raw);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { raw, parsed };
  } catch (err) {
    clientPromise = undefined;
    if (!retried && err.message !== "togari_not_configured") {
      return callTogariTool(name, args, { retried: true });
    }
    throw err;
  }
}

export function _resetForTests() {
  clientPromise = undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/togari/mcpClient.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/togari/mcpClient.js server/togari/mcpClient.test.js
git commit -m "feat: MCP client wrapper with redeploy-safe retry"
```

---

### Task 4: Router skeleton, envelope helpers, status endpoint

**Files:**

- Create: `server/togari/routes.js`
- Modify: `server/index.js` (mount router)
- Test: `server/togari/routes.status.test.js`

**Interfaces:**

- Consumes: `isBigQueryConfigured`, `isMcpConfigured` (Task 1).
- Produces: `togariRouter` (Express router), plus internal helpers used by every later endpoint task: `ok(res, data)`, `fail(res, status, error)`, `wrap(handlerFn)` (async error catcher that maps `togari_not_configured` to 503). Route: `GET /api/togari/status`.

- [ ] **Step 1: Write the failing test**

```js
// server/togari/routes.status.test.js
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { togariRouter } from "./routes.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/togari", togariRouter);
  return app;
}

describe("GET /api/togari/status", () => {
  it("reports configuration state in the standard envelope", async () => {
    const res = await request(makeApp()).get("/api/togari/status");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("bigquery");
    expect(res.body.data).toHaveProperty("mcp");
    expect(res.body.data).toHaveProperty("brand");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/togari/routes.status.test.js`
Expected: FAIL, cannot find module `./routes.js`

- [ ] **Step 3: Write the implementation**

```js
// server/togari/routes.js
import express from "express";
import {
  togariConfig,
  isBigQueryConfigured,
  isMcpConfigured,
} from "./config.js";

export const togariRouter = express.Router();

export function ok(res, data) {
  res.json({ success: true, data });
}

export function fail(res, status, error) {
  res.status(status).json({ success: false, error });
}

export function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err.message === "togari_not_configured") {
        return fail(res, 503, "togari_not_configured");
      }
      console.error("[togari]", err);
      fail(res, 500, err.message || "internal_error");
    }
  };
}

togariRouter.get(
  "/status",
  wrap(async (req, res) => {
    ok(res, {
      brand: togariConfig.brand,
      bigquery: isBigQueryConfigured(),
      mcp: isMcpConfigured(),
      channels: togariConfig.channels.map((c) => c.key),
    });
  }),
);
```

In `server/index.js`, next to the existing wiki routes, add:

```js
import { togariRouter } from "./togari/routes.js";
// after the /api/auth route and requireBMAUser import:
app.use("/api/togari", requireBMAUser, togariRouter);
```

- [ ] **Step 4: Run tests and boot check**

Run: `npx vitest run server/togari/routes.status.test.js`
Expected: PASS
Run: `node --check server/index.js`
Expected: no output (syntax valid)

- [ ] **Step 5: Commit**

```bash
git add server/togari/routes.js server/togari/routes.status.test.js server/index.js
git commit -m "feat: togari API router with envelope helpers and status endpoint"
```

---

### Task 5: People endpoints (Mass Data Explorer backend)

**Files:**

- Create: `server/togari/people.js`
- Modify: `server/togari/routes.js` (register routes)
- Test: `server/togari/people.test.js`

**Interfaces:**

- Consumes: `runQuery`, `table` (Task 2); `ok`, `fail`, `wrap`, `togariRouter` (Task 4); `togariConfig` (Task 1).
- Produces routes:
  - `GET /api/togari/people?search=&limit=&offset=` returns `{ rows, total }`; rows have `person_id, full_name, company, title, email, relationship_score, interaction_count, last_interaction_at`.
  - `GET /api/togari/people/:personId` returns `{ entity, related: { interactions }, analytics: { byChannel, monthly, avgSentiment } }`.
- Also produces `registerPeopleRoutes(router)` used by routes.js.

- [ ] **Step 1: Write the failing test**

```js
// server/togari/people.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("./bigquery.js", () => ({
  runQuery: vi.fn(),
  table: (d, n) => `\`p.${d}.${n}\``,
}));
import { runQuery } from "./bigquery.js";
import { togariRouter } from "./routes.js";

const app = express();
app.use(express.json());
app.use("/api/togari", togariRouter);

beforeEach(() => runQuery.mockReset());

describe("people endpoints", () => {
  it("lists people with total count", async () => {
    runQuery
      .mockResolvedValueOnce([
        { person_id: "p1", full_name: "Ada", company: "Acme" },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);
    const res = await request(app).get("/api/togari/people?search=ada");
    expect(res.status).toBe(200);
    expect(res.body.data.rows[0].full_name).toBe("Ada");
    expect(res.body.data.total).toBe(1);
  });

  it("returns 404 for a missing person", async () => {
    runQuery.mockResolvedValue([]);
    const res = await request(app).get("/api/togari/people/nope");
    expect(res.status).toBe(404);
  });

  it("returns entity, related interactions, and analytics for a person", async () => {
    runQuery
      .mockResolvedValueOnce([{ person_id: "p1", full_name: "Ada" }])
      .mockResolvedValueOnce([
        {
          interaction_id: "i1",
          channel: "gmail",
          sentiment: 0.5,
          occurred_at: "2026-07-01",
        },
        {
          interaction_id: "i2",
          channel: "gmail",
          sentiment: 0.1,
          occurred_at: "2026-07-02",
        },
      ])
      .mockResolvedValueOnce([{ month: "2026-07", count: 2 }]);
    const res = await request(app).get("/api/togari/people/p1");
    expect(res.body.data.entity.full_name).toBe("Ada");
    expect(res.body.data.related.interactions).toHaveLength(2);
    expect(res.body.data.analytics.byChannel).toEqual({ gmail: 2 });
    expect(res.body.data.analytics.avgSentiment).toBeCloseTo(0.3);
    expect(res.body.data.analytics.monthly).toEqual([
      { month: "2026-07", count: 2 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/togari/people.test.js`
Expected: FAIL (routes not registered, 404s from the router)

- [ ] **Step 3: Write the implementation**

```js
// server/togari/people.js
import { runQuery, table } from "./bigquery.js";
import { togariConfig } from "./config.js";
import { ok, fail, wrap } from "./routes.js";

const PERSON_FIELDS = `person_id, full_name, company, title,
  email_addresses[SAFE_OFFSET(0)] AS email,
  relationship_score, interaction_count, last_interaction_at`;

export function registerPeopleRoutes(router) {
  router.get(
    "/people",
    wrap(async (req, res) => {
      const search = String(req.query.search || "");
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Number(req.query.offset) || 0;
      const params = { ownerId: togariConfig.ownerId, search, limit, offset };
      const where = `owner_id = @ownerId AND (
        @search = '' OR LOWER(COALESCE(full_name, '')) LIKE CONCAT('%', LOWER(@search), '%')
        OR LOWER(COALESCE(company, '')) LIKE CONCAT('%', LOWER(@search), '%')
      )`;
      const [rows, counts] = await Promise.all([
        runQuery(
          `SELECT ${PERSON_FIELDS} FROM ${table("pdw", "persons")}
           WHERE ${where}
           ORDER BY last_interaction_at DESC NULLS LAST
           LIMIT @limit OFFSET @offset`,
          params,
        ),
        runQuery(
          `SELECT COUNT(*) AS total FROM ${table("pdw", "persons")} WHERE ${where}`,
          { ownerId: params.ownerId, search },
        ),
      ]);
      ok(res, { rows, total: Number(counts[0]?.total || 0) });
    }),
  );

  router.get(
    "/people/:personId",
    wrap(async (req, res) => {
      const params = {
        ownerId: togariConfig.ownerId,
        personId: req.params.personId,
      };
      const people = await runQuery(
        `SELECT ${PERSON_FIELDS}, phone_numbers, linkedin_url, tags
         FROM ${table("pdw", "persons")}
         WHERE owner_id = @ownerId AND person_id = @personId`,
        params,
      );
      if (!people.length) return fail(res, 404, "person_not_found");
      const [interactions, monthly] = await Promise.all([
        runQuery(
          `SELECT interaction_id, channel, direction, interaction_type, subject,
                  summary, sentiment, topics, occurred_at
           FROM ${table("pdw", "interactions")}
           WHERE owner_id = @ownerId AND person_id = @personId
           ORDER BY occurred_at DESC LIMIT 50`,
          params,
        ),
        runQuery(
          `SELECT FORMAT_TIMESTAMP('%Y-%m', occurred_at) AS month, COUNT(*) AS count
           FROM ${table("pdw", "interactions")}
           WHERE owner_id = @ownerId AND person_id = @personId
             AND occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 365 DAY)
           GROUP BY month ORDER BY month`,
          params,
        ),
      ]);
      const byChannel = {};
      let sentimentSum = 0;
      let sentimentCount = 0;
      for (const i of interactions) {
        byChannel[i.channel] = (byChannel[i.channel] || 0) + 1;
        if (typeof i.sentiment === "number") {
          sentimentSum += i.sentiment;
          sentimentCount += 1;
        }
      }
      ok(res, {
        entity: people[0],
        related: { interactions },
        analytics: {
          byChannel,
          monthly: monthly.map((m) => ({
            month: m.month,
            count: Number(m.count),
          })),
          avgSentiment: sentimentCount ? sentimentSum / sentimentCount : null,
        },
      });
    }),
  );
}
```

At the bottom of `server/togari/routes.js` add:

```js
import { registerPeopleRoutes } from "./people.js";
registerPeopleRoutes(togariRouter);
```

(Keep this import at the bottom of the file: `people.js` imports `ok/fail/wrap` back from `routes.js`, and the circular import resolves cleanly only if registration happens after the helpers are defined.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/togari/people.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/togari/people.js server/togari/people.test.js server/togari/routes.js
git commit -m "feat: people list and drill-down endpoints from togari_pdw"
```

---

### Task 6: Channel endpoints (Channel Explorer backend)

**Files:**

- Create: `server/togari/channels.js`
- Modify: `server/togari/routes.js` (register)
- Test: `server/togari/channels.test.js`

**Interfaces:**

- Consumes: same helpers as Task 5.
- Produces routes:
  - `GET /api/togari/channels` returns `{ channels: [{ key, label, interactions, people, inbound, lastActivity }] }`, one entry per configured channel group (config-driven, Task 1).
  - `GET /api/togari/channels/:key` returns `{ entity: { key, label }, related: { topPeople }, analytics: { weekly, totals } }`. `topPeople` rows: `person_id, full_name, company, total, inbound`. `weekly` rows: `{ week, count, inbound }` for the last 12 weeks.
  - 404 for an unknown channel key.

- [ ] **Step 1: Write the failing test**

```js
// server/togari/channels.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("./bigquery.js", () => ({
  runQuery: vi.fn(),
  table: (d, n) => `\`p.${d}.${n}\``,
}));
import { runQuery } from "./bigquery.js";
import { togariRouter } from "./routes.js";

const app = express();
app.use(express.json());
app.use("/api/togari", togariRouter);

beforeEach(() => runQuery.mockReset());

describe("channel endpoints", () => {
  it("aggregates raw channels into configured groups", async () => {
    runQuery.mockResolvedValueOnce([
      {
        channel: "gmail",
        interactions: 40,
        people: 12,
        inbound: 9,
        last_activity: "2026-07-19",
      },
      {
        channel: "linkedin",
        interactions: 5,
        people: 4,
        inbound: 2,
        last_activity: "2026-07-18",
      },
    ]);
    const res = await request(app).get("/api/togari/channels");
    const email = res.body.data.channels.find((c) => c.key === "email");
    const fm = res.body.data.channels.find(
      (c) => c.key === "founder-marketing",
    );
    expect(email.interactions).toBe(40);
    expect(email.inbound).toBe(9);
    expect(fm.interactions).toBe(5);
  });

  it("404s on unknown channel key", async () => {
    const res = await request(app).get("/api/togari/channels/telegraph");
    expect(res.status).toBe(404);
  });

  it("returns weekly series and top people for a channel", async () => {
    runQuery
      .mockResolvedValueOnce([{ week: "2026-07-13", count: 7, inbound: 3 }])
      .mockResolvedValueOnce([
        {
          person_id: "p1",
          full_name: "Ada",
          company: "Acme",
          total: 6,
          inbound: 3,
        },
      ]);
    const res = await request(app).get("/api/togari/channels/email");
    expect(res.body.data.analytics.weekly[0].count).toBe(7);
    expect(res.body.data.related.topPeople[0].full_name).toBe("Ada");
    expect(res.body.data.entity.label).toBe("Email Outbound");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/togari/channels.test.js`
Expected: FAIL (404 on /channels)

- [ ] **Step 3: Write the implementation**

```js
// server/togari/channels.js
import { runQuery, table } from "./bigquery.js";
import { togariConfig } from "./config.js";
import { ok, fail, wrap } from "./routes.js";

export function registerChannelRoutes(router) {
  router.get(
    "/channels",
    wrap(async (req, res) => {
      const rows = await runQuery(
        `SELECT channel, COUNT(*) AS interactions,
                COUNT(DISTINCT person_id) AS people,
                COUNTIF(direction = 'inbound') AS inbound,
                MAX(occurred_at) AS last_activity
         FROM ${table("pdw", "interactions")}
         WHERE owner_id = @ownerId
         GROUP BY channel`,
        { ownerId: togariConfig.ownerId },
      );
      const byRaw = Object.fromEntries(rows.map((r) => [r.channel, r]));
      const channels = togariConfig.channels.map((c) => {
        const members = c.interactionChannels
          .map((k) => byRaw[k])
          .filter(Boolean);
        return {
          key: c.key,
          label: c.label,
          interactions: members.reduce((s, m) => s + Number(m.interactions), 0),
          people: members.reduce((s, m) => s + Number(m.people), 0),
          inbound: members.reduce((s, m) => s + Number(m.inbound), 0),
          lastActivity:
            members
              .map((m) => m.last_activity)
              .sort()
              .pop() || null,
        };
      });
      ok(res, { channels });
    }),
  );

  router.get(
    "/channels/:key",
    wrap(async (req, res) => {
      const config = togariConfig.channels.find(
        (c) => c.key === req.params.key,
      );
      if (!config) return fail(res, 404, "channel_not_found");
      const params = {
        ownerId: togariConfig.ownerId,
        channels: config.interactionChannels,
      };
      const [weekly, topPeople] = await Promise.all([
        runQuery(
          `SELECT FORMAT_DATE('%F', DATE_TRUNC(DATE(occurred_at), WEEK(MONDAY))) AS week,
                  COUNT(*) AS count, COUNTIF(direction = 'inbound') AS inbound
           FROM ${table("pdw", "interactions")}
           WHERE owner_id = @ownerId AND channel IN UNNEST(@channels)
             AND occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 84 DAY)
           GROUP BY week ORDER BY week`,
          params,
        ),
        runQuery(
          `SELECT p.person_id, p.full_name, p.company,
                  COUNT(*) AS total, COUNTIF(i.direction = 'inbound') AS inbound
           FROM ${table("pdw", "interactions")} i
           JOIN ${table("pdw", "persons")} p
             ON p.person_id = i.person_id AND p.owner_id = i.owner_id
           WHERE i.owner_id = @ownerId AND i.channel IN UNNEST(@channels)
           GROUP BY 1, 2, 3
           ORDER BY inbound DESC, total DESC
           LIMIT 25`,
          params,
        ),
      ]);
      const totals = {
        count: weekly.reduce((s, w) => s + Number(w.count), 0),
        inbound: weekly.reduce((s, w) => s + Number(w.inbound), 0),
      };
      ok(res, {
        entity: { key: config.key, label: config.label },
        related: { topPeople },
        analytics: {
          weekly: weekly.map((w) => ({
            week: w.week,
            count: Number(w.count),
            inbound: Number(w.inbound),
          })),
          totals,
        },
      });
    }),
  );
}
```

Register in `server/togari/routes.js` (bottom, after people):

```js
import { registerChannelRoutes } from "./channels.js";
registerChannelRoutes(togariRouter);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/togari/channels.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/togari/channels.js server/togari/channels.test.js server/togari/routes.js
git commit -m "feat: channel analytics and drill-down endpoints"
```

---

### Task 7: Pipeline and client-detail endpoints (Pipeline Explorer backend)

**Files:**

- Create: `server/togari/pipeline.js`
- Modify: `server/togari/routes.js` (register)
- Test: `server/togari/pipeline.test.js`

**Interfaces:**

- Consumes: helpers from Tasks 2 and 4, plus `callTogariTool` (Task 3).
- Produces routes:
  - `GET /api/togari/pipeline` returns `{ stages: [{ stage, clients: [...] }] }` from `togari_data_lake.clients` where `client_brand = @brand AND status != 'lost'`. Stage order: `["prospect", "outreach", "call", "proposal", "won"]` first, unknown stages appended alphabetically, null stage becomes `"unstaged"`.
  - `PATCH /api/togari/pipeline/:clientId` body `{ stage, name }` calls MCP `togari_client_upsert` with `{ client_id, name, stage }` (name is required by the tool). Returns `{ moved: true, stage }`.
  - `GET /api/togari/clients/:clientId` returns `{ entity, related: { tasks, context }, analytics: { openTasks, doneTasks, contextByType, lastTouch } }`.

- [ ] **Step 1: Write the failing test**

```js
// server/togari/pipeline.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("./bigquery.js", () => ({
  runQuery: vi.fn(),
  table: (d, n) => `\`p.${d}.${n}\``,
}));
vi.mock("./mcpClient.js", () => ({ callTogariTool: vi.fn() }));
import { runQuery } from "./bigquery.js";
import { callTogariTool } from "./mcpClient.js";
import { togariRouter } from "./routes.js";

const app = express();
app.use(express.json());
app.use("/api/togari", togariRouter);

beforeEach(() => {
  runQuery.mockReset();
  callTogariTool.mockReset();
});

describe("pipeline endpoints", () => {
  it("groups clients by stage in canonical order", async () => {
    runQuery.mockResolvedValueOnce([
      { client_id: "a", name: "A", stage: "won" },
      { client_id: "b", name: "B", stage: "prospect" },
      { client_id: "c", name: "C", stage: null },
    ]);
    const res = await request(app).get("/api/togari/pipeline");
    const stages = res.body.data.stages.map((s) => s.stage);
    expect(stages.indexOf("prospect")).toBeLessThan(stages.indexOf("won"));
    expect(stages).toContain("unstaged");
  });

  it("moves a client to a new stage via MCP upsert", async () => {
    callTogariTool.mockResolvedValue({ parsed: "updated" });
    const res = await request(app)
      .patch("/api/togari/pipeline/acme")
      .send({ stage: "call", name: "Acme" });
    expect(res.body.data).toEqual({ moved: true, stage: "call" });
    expect(callTogariTool).toHaveBeenCalledWith("togari_client_upsert", {
      client_id: "acme",
      name: "Acme",
      stage: "call",
    });
  });

  it("rejects a stage move without name or stage", async () => {
    const res = await request(app).patch("/api/togari/pipeline/acme").send({});
    expect(res.status).toBe(400);
  });

  it("returns client detail with task and context analytics", async () => {
    runQuery
      .mockResolvedValueOnce([
        { client_id: "acme", name: "Acme", stage: "call" },
      ])
      .mockResolvedValueOnce([
        { task_id: "t1", status: "open" },
        { task_id: "t2", status: "done" },
      ])
      .mockResolvedValueOnce([
        { context_id: "c1", content_type: "email", occurred_at: "2026-07-18" },
      ]);
    const res = await request(app).get("/api/togari/clients/acme");
    expect(res.body.data.analytics.openTasks).toBe(1);
    expect(res.body.data.analytics.doneTasks).toBe(1);
    expect(res.body.data.analytics.contextByType).toEqual({ email: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/togari/pipeline.test.js`
Expected: FAIL (404s)

- [ ] **Step 3: Write the implementation**

```js
// server/togari/pipeline.js
import { runQuery, table } from "./bigquery.js";
import { callTogariTool } from "./mcpClient.js";
import { togariConfig } from "./config.js";
import { ok, fail, wrap } from "./routes.js";

const STAGE_ORDER = ["prospect", "outreach", "call", "proposal", "won"];

export function registerPipelineRoutes(router) {
  router.get(
    "/pipeline",
    wrap(async (req, res) => {
      const rows = await runQuery(
        `SELECT client_id, name, stage, pipeline, owner, status,
                primary_email, summary, updated_at
         FROM ${table("lake", "clients")}
         WHERE client_brand = @brand AND status != 'lost'
         ORDER BY updated_at DESC`,
        { brand: togariConfig.brand },
      );
      const byStage = new Map();
      for (const row of rows) {
        const stage = row.stage || "unstaged";
        if (!byStage.has(stage)) byStage.set(stage, []);
        byStage.get(stage).push(row);
      }
      const known = STAGE_ORDER.filter((s) => byStage.has(s));
      const unknown = [...byStage.keys()]
        .filter((s) => !STAGE_ORDER.includes(s))
        .sort();
      const stages = [...known, ...unknown].map((stage) => ({
        stage,
        clients: byStage.get(stage),
      }));
      ok(res, { stages });
    }),
  );

  router.patch(
    "/pipeline/:clientId",
    wrap(async (req, res) => {
      const { stage, name } = req.body || {};
      if (!stage || !name) return fail(res, 400, "stage_and_name_required");
      await callTogariTool("togari_client_upsert", {
        client_id: req.params.clientId,
        name,
        stage,
      });
      ok(res, { moved: true, stage });
    }),
  );

  router.get(
    "/clients/:clientId",
    wrap(async (req, res) => {
      const params = {
        brand: togariConfig.brand,
        clientId: req.params.clientId,
      };
      const clients = await runQuery(
        `SELECT client_id, name, stage, pipeline, owner, status, primary_email,
                primary_domain, summary, attributes, updated_at, created_at
         FROM ${table("lake", "clients")}
         WHERE client_brand = @brand AND client_id = @clientId`,
        params,
      );
      if (!clients.length) return fail(res, 404, "client_not_found");
      const [tasks, context] = await Promise.all([
        runQuery(
          `SELECT task_id, description, status, due_date, owner, priority, created_at
           FROM ${table("lake", "client_tasks")}
           WHERE client_brand = @brand AND client_id = @clientId
           ORDER BY created_at DESC LIMIT 100`,
          params,
        ),
        runQuery(
          `SELECT context_id, title, content_type, source, occurred_at, created_at
           FROM ${table("lake", "client_context")}
           WHERE client_brand = @brand AND client_id = @clientId
           ORDER BY COALESCE(occurred_at, created_at) DESC LIMIT 50`,
          params,
        ),
      ]);
      const contextByType = {};
      for (const c of context) {
        const t = c.content_type || "note";
        contextByType[t] = (contextByType[t] || 0) + 1;
      }
      ok(res, {
        entity: clients[0],
        related: { tasks, context },
        analytics: {
          openTasks: tasks.filter((t) => t.status === "open").length,
          doneTasks: tasks.filter((t) => t.status === "done").length,
          contextByType,
          lastTouch: context[0]?.occurred_at || context[0]?.created_at || null,
        },
      });
    }),
  );
}
```

Register in `server/togari/routes.js` (bottom):

```js
import { registerPipelineRoutes } from "./pipeline.js";
registerPipelineRoutes(togariRouter);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/togari/pipeline.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/togari/pipeline.js server/togari/pipeline.test.js server/togari/routes.js
git commit -m "feat: pipeline board, stage moves via MCP, client drill-down"
```

---

### Task 8: Management endpoints (paying clients)

**Files:**

- Create: `server/togari/management.js`
- Modify: `server/togari/routes.js` (register)
- Test: `server/togari/management.test.js`

**Interfaces:**

- Consumes: helpers from Tasks 2, 3, 4.
- Produces routes:
  - `GET /api/togari/management` returns `{ clients }` where `status = 'won'` (paying clients), each row including parsed `attributes` (`slack_url`, `contract_url` live inside the JSON `attributes` column). Client detail reuses `GET /api/togari/clients/:clientId` from Task 7.
  - `POST /api/togari/management/:clientId/meta` body `{ name, slack_url?, contract_url?, notes? }` calls `togari_client_upsert` with `{ client_id, name, attributes: {...} }`.
  - `POST /api/togari/management/:clientId/dnc` body `{ name, filename, content }` stores a do-not-contact list via `togari_context_add` with `content_type: "file"`, `source: "dashboard"`, title `` `Do not contact list (${filename})` ``.

- [ ] **Step 1: Write the failing test**

```js
// server/togari/management.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("./bigquery.js", () => ({
  runQuery: vi.fn(),
  table: (d, n) => `\`p.${d}.${n}\``,
}));
vi.mock("./mcpClient.js", () => ({ callTogariTool: vi.fn() }));
import { runQuery } from "./bigquery.js";
import { callTogariTool } from "./mcpClient.js";
import { togariRouter } from "./routes.js";

const app = express();
app.use(express.json());
app.use("/api/togari", togariRouter);

beforeEach(() => {
  runQuery.mockReset();
  callTogariTool.mockReset();
  callTogariTool.mockResolvedValue({ parsed: "ok" });
});

describe("management endpoints", () => {
  it("lists won clients with parsed attributes", async () => {
    runQuery.mockResolvedValueOnce([
      {
        client_id: "acme",
        name: "Acme",
        status: "won",
        attributes: '{"slack_url":"https://s"}',
      },
    ]);
    const res = await request(app).get("/api/togari/management");
    expect(res.body.data.clients[0].attributes.slack_url).toBe("https://s");
  });

  it("updates client meta through MCP upsert", async () => {
    const res = await request(app)
      .post("/api/togari/management/acme/meta")
      .send({
        name: "Acme",
        slack_url: "https://slack.test",
        contract_url: "https://c",
      });
    expect(res.status).toBe(200);
    expect(callTogariTool).toHaveBeenCalledWith("togari_client_upsert", {
      client_id: "acme",
      name: "Acme",
      attributes: {
        slack_url: "https://slack.test",
        contract_url: "https://c",
      },
    });
  });

  it("stores a DNC upload as client context", async () => {
    const res = await request(app)
      .post("/api/togari/management/acme/dnc")
      .send({ name: "Acme", filename: "dnc.csv", content: "email\na@b.com" });
    expect(res.status).toBe(200);
    expect(callTogariTool).toHaveBeenCalledWith("togari_context_add", {
      client_id: "acme",
      title: "Do not contact list (dnc.csv)",
      content: "email\na@b.com",
      content_type: "file",
      source: "dashboard",
    });
  });

  it("rejects a DNC upload without content", async () => {
    const res = await request(app)
      .post("/api/togari/management/acme/dnc")
      .send({ name: "Acme", filename: "dnc.csv" });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/togari/management.test.js`
Expected: FAIL (404s)

- [ ] **Step 3: Write the implementation**

```js
// server/togari/management.js
import { runQuery, table } from "./bigquery.js";
import { callTogariTool } from "./mcpClient.js";
import { togariConfig } from "./config.js";
import { ok, fail, wrap } from "./routes.js";

function parseAttributes(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function registerManagementRoutes(router) {
  router.get(
    "/management",
    wrap(async (req, res) => {
      const rows = await runQuery(
        `SELECT client_id, name, stage, owner, status, primary_email,
                primary_domain, summary, attributes, updated_at
         FROM ${table("lake", "clients")}
         WHERE client_brand = @brand AND status = 'won'
         ORDER BY updated_at DESC`,
        { brand: togariConfig.brand },
      );
      ok(res, {
        clients: rows.map((r) => ({
          ...r,
          attributes: parseAttributes(r.attributes),
        })),
      });
    }),
  );

  router.post(
    "/management/:clientId/meta",
    wrap(async (req, res) => {
      const { name, slack_url, contract_url, notes } = req.body || {};
      if (!name) return fail(res, 400, "name_required");
      const attributes = {};
      if (slack_url !== undefined) attributes.slack_url = slack_url;
      if (contract_url !== undefined) attributes.contract_url = contract_url;
      if (notes !== undefined) attributes.notes = notes;
      await callTogariTool("togari_client_upsert", {
        client_id: req.params.clientId,
        name,
        attributes,
      });
      ok(res, { updated: true, attributes });
    }),
  );

  router.post(
    "/management/:clientId/dnc",
    wrap(async (req, res) => {
      const { name, filename, content } = req.body || {};
      if (!name || !filename || !content) {
        return fail(res, 400, "name_filename_content_required");
      }
      await callTogariTool("togari_context_add", {
        client_id: req.params.clientId,
        title: `Do not contact list (${filename})`,
        content,
        content_type: "file",
        source: "dashboard",
      });
      ok(res, { stored: true });
    }),
  );
}
```

Register in `server/togari/routes.js` (bottom):

```js
import { registerManagementRoutes } from "./management.js";
registerManagementRoutes(togariRouter);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/togari/management.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/togari/management.js server/togari/management.test.js server/togari/routes.js
git commit -m "feat: management endpoints for paying clients, meta, DNC uploads"
```

---

### Task 9: Chat and refresh endpoints

**Files:**

- Create: `server/togari/chat.js`
- Modify: `server/togari/routes.js` (register)
- Test: `server/togari/chat.test.js`

**Interfaces:**

- Consumes: `callTogariTool` (Task 3), helpers (Task 4).
- Produces routes:
  - `POST /api/togari/chat` body `{ message }` calls `togari_ask` with `{ question: message }`, returns `{ answer }` (answer is the parsed text; if parsed is an object, JSON.stringify it). Expect multi-second latency; the frontend shows a thinking state.
  - `POST /api/togari/refresh` body `{ sinceDays? }` calls `togari_pull` with `{ source: "all", since_days: sinceDays || 7 }`, returns `{ summary }`.

- [ ] **Step 1: Write the failing test**

```js
// server/togari/chat.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("./bigquery.js", () => ({
  runQuery: vi.fn(),
  table: (d, n) => `\`p.${d}.${n}\``,
}));
vi.mock("./mcpClient.js", () => ({ callTogariTool: vi.fn() }));
import { callTogariTool } from "./mcpClient.js";
import { togariRouter } from "./routes.js";

const app = express();
app.use(express.json());
app.use("/api/togari", togariRouter);

beforeEach(() => callTogariTool.mockReset());

describe("chat and refresh", () => {
  it("proxies chat messages to togari_ask", async () => {
    callTogariTool.mockResolvedValue({ parsed: "You have 3 open tasks." });
    const res = await request(app)
      .post("/api/togari/chat")
      .send({ message: "what are my open tasks" });
    expect(res.body.data.answer).toBe("You have 3 open tasks.");
    expect(callTogariTool).toHaveBeenCalledWith("togari_ask", {
      question: "what are my open tasks",
    });
  });

  it("rejects empty messages", async () => {
    const res = await request(app).post("/api/togari/chat").send({});
    expect(res.status).toBe(400);
  });

  it("triggers a full pull on refresh", async () => {
    callTogariTool.mockResolvedValue({ parsed: "Pulled 12 items" });
    const res = await request(app)
      .post("/api/togari/refresh")
      .send({ sinceDays: 3 });
    expect(res.body.data.summary).toBe("Pulled 12 items");
    expect(callTogariTool).toHaveBeenCalledWith("togari_pull", {
      source: "all",
      since_days: 3,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/togari/chat.test.js`
Expected: FAIL (404s)

- [ ] **Step 3: Write the implementation**

```js
// server/togari/chat.js
import { callTogariTool } from "./mcpClient.js";
import { ok, fail, wrap } from "./routes.js";

export function registerChatRoutes(router) {
  router.post(
    "/chat",
    wrap(async (req, res) => {
      const message = String(req.body?.message || "").trim();
      if (!message) return fail(res, 400, "message_required");
      const { parsed } = await callTogariTool("togari_ask", {
        question: message,
      });
      const answer =
        typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
      ok(res, { answer });
    }),
  );

  router.post(
    "/refresh",
    wrap(async (req, res) => {
      const sinceDays = Number(req.body?.sinceDays) || 7;
      const { parsed } = await callTogariTool("togari_pull", {
        source: "all",
        since_days: sinceDays,
      });
      const summary =
        typeof parsed === "string" ? parsed : JSON.stringify(parsed);
      ok(res, { summary });
    }),
  );
}
```

Register in `server/togari/routes.js` (bottom):

```js
import { registerChatRoutes } from "./chat.js";
registerChatRoutes(togariRouter);
```

- [ ] **Step 4: Run the full server suite**

Run: `npm test`
Expected: PASS, all server tests green

- [ ] **Step 5: Commit**

```bash
git add server/togari/chat.js server/togari/chat.test.js server/togari/routes.js
git commit -m "feat: chat proxy to togari_ask and full-source refresh endpoint"
```

---

### Task 10: Frontend API helper and useApi hook

**Files:**

- Create: `src/lib/api.js`
- Create: `src/lib/useApi.js`

**Interfaces:**

- Consumes: the localStorage key `bma_google_cred` already written by `src/context/AuthContext.jsx`.
- Produces: `apiFetch(path, options?) -> Promise<data>` (unwraps the envelope, throws `Error(error)` on failure, sends the Google credential as a Bearer token), `useApi(path) -> { loading, data, error, reload }` (refetches when `path` changes; `useApi(null)` stays idle).

- [ ] **Step 1: Write the implementation** (frontend modules are verified by build plus the page tasks that consume them; the server contract is already test-covered)

```js
// src/lib/api.js
export async function apiFetch(path, options = {}) {
  const cred = localStorage.getItem("bma_google_cred");
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(cred ? { Authorization: `Bearer ${cred}` } : {}),
      ...(options.headers || {}),
    },
  });
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Request failed (${res.status})`);
  }
  if (!res.ok || body.success === false) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body.data;
}
```

```js
// src/lib/useApi.js
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api.js";

export function useApi(path) {
  const [state, setState] = useState({
    loading: Boolean(path),
    data: null,
    error: null,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let active = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    apiFetch(path)
      .then((data) => active && setState({ loading: false, data, error: null }))
      .catch(
        (err) =>
          active &&
          setState({ loading: false, data: null, error: err.message }),
      );
    return () => {
      active = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: vite build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.js src/lib/useApi.js
git commit -m "feat: authed api fetch helper and useApi hook"
```

---

### Task 11: Dashboard shell with five-tab navigation

**Files:**

- Create: `src/pages/DashboardLayout.jsx`
- Modify: `src/App.jsx` (routes)
- Modify: `src/index.css` (append `dash-` styles)

**Interfaces:**

- Consumes: `useAuth` from `src/context/AuthContext.jsx`, existing `WikiPage`.
- Produces: routes under `/dash` with `<Outlet />`; nav tabs Data, Channels, Pipeline, Clients, Wiki. Root `/` now redirects to `/dash/data` instead of `/wiki`. Unauthenticated users hitting `/dash/*` are redirected to `/login`. Later tasks plug pages into these route slots; until then each slot renders a `DashPlaceholder`.

- [ ] **Step 1: Write DashboardLayout**

```jsx
// src/pages/DashboardLayout.jsx
import { NavLink, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

const TABS = [
  { to: "/dash/data", label: "Data" },
  { to: "/dash/channels", label: "Channels" },
  { to: "/dash/pipeline", label: "Pipeline" },
  { to: "/dash/clients", label: "Clients" },
  { to: "/wiki", label: "Wiki" },
];

export default function DashboardLayout() {
  const { user, loading } = useAuth();
  if (loading) return <div className="dash-loading">Loading session...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <div className="dash-shell">
      <header className="dash-topbar">
        <span className="dash-brand">Togari</span>
        <nav className="dash-tabs">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                "dash-tab" + (isActive ? " dash-tab--active" : "")
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <span className="dash-user">{user.email}</span>
      </header>
      <main className="dash-main">
        <Outlet />
      </main>
    </div>
  );
}

export function DashPlaceholder({ title }) {
  return (
    <div className="dash-placeholder">
      <h1>{title}</h1>
      <p>Coming in a later task of this plan.</p>
    </div>
  );
}
```

Note: check `src/context/AuthContext.jsx` for the exact fields `useAuth` exposes. If the hook exposes `session` instead of `user` or has no `loading` flag, adapt the two lines that read them; do not modify AuthContext itself.

- [ ] **Step 2: Update routes in `src/App.jsx`**

Replace the `/` redirect and add the dash tree (keep every existing route):

```jsx
import DashboardLayout, { DashPlaceholder } from "./pages/DashboardLayout.jsx";

// inside <Routes>:
<Route path="/" element={<Navigate to="/dash/data" replace />} />
<Route path="/dash" element={<DashboardLayout />}>
  <Route index element={<Navigate to="/dash/data" replace />} />
  <Route path="data" element={<DashPlaceholder title="Mass Data Explorer" />} />
  <Route path="data/person/:personId" element={<DashPlaceholder title="Person" />} />
  <Route path="channels" element={<DashPlaceholder title="Channel Explorer" />} />
  <Route path="channels/:key" element={<DashPlaceholder title="Channel" />} />
  <Route path="pipeline" element={<DashPlaceholder title="Pipeline Explorer" />} />
  <Route path="pipeline/:clientId" element={<DashPlaceholder title="Client" />} />
  <Route path="clients" element={<DashPlaceholder title="Management Explorer" />} />
  <Route path="clients/:clientId" element={<DashPlaceholder title="Client" />} />
</Route>
```

Change the catch-all from `/wiki` to `/dash/data`.

- [ ] **Step 3: Append shell styles to `src/index.css`**

```css
/* Dashboard shell */
.dash-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg, #0e0f12);
  color: var(--text, #e8e9ec);
}
.dash-topbar {
  display: flex;
  align-items: center;
  gap: 32px;
  padding: 14px 28px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.dash-brand {
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 14px;
}
.dash-tabs {
  display: flex;
  gap: 4px;
  flex: 1;
}
.dash-tab {
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 14px;
  color: inherit;
  opacity: 0.65;
  text-decoration: none;
}
.dash-tab:hover {
  opacity: 1;
}
.dash-tab--active {
  opacity: 1;
  background: rgba(255, 255, 255, 0.08);
}
.dash-user {
  font-size: 13px;
  opacity: 0.6;
}
.dash-main {
  flex: 1;
  padding: 28px;
  max-width: 1440px;
  width: 100%;
  margin: 0 auto;
}
.dash-loading,
.dash-placeholder {
  padding: 64px;
  text-align: center;
  opacity: 0.7;
}
```

These tokens are a starting point; align exact colors and type with the existing auth screens' palette in `src/index.css` so the shell reads as the same product. Run the frontend-design skill or `~/.claude/rules/design.md` checklist before final styling.

- [ ] **Step 4: Verify build and manual check**

Run: `npm run build`
Expected: success
Run: `npm run dev`, open `http://localhost:5173/`, sign in
Expected: redirect to `/dash/data`, five tabs render, Wiki tab opens the existing wiki.

- [ ] **Step 5: Commit**

```bash
git add src/pages/DashboardLayout.jsx src/App.jsx src/index.css
git commit -m "feat: dashboard shell with five-tab navigation"
```

---

### Task 12: Shared components (DataGrid, DrillDown, StatCard, MiniBarChart)

**Files:**

- Create: `src/components/togari/DataGrid.jsx`
- Create: `src/components/togari/DrillDown.jsx`
- Create: `src/components/togari/StatCard.jsx`
- Create: `src/components/togari/MiniBarChart.jsx`
- Modify: `src/index.css` (append component styles)

**Interfaces:**

- Produces:
  - `DataGrid({ columns, rows, rowKey, onRowClick, searchValue, onSearchChange, loading, error, emptyLabel })` where `columns = [{ key, label, render? }]`.
  - `DrillDown({ title, subtitle, backTo, stats, children })` where `stats = [{ label, value }]`; renders back link, header, StatCard row, then sections.
  - `StatCard({ label, value })`.
  - `MiniBarChart({ data, xKey, yKey, height = 80 })` pure inline SVG bars, no chart library. Consult the dataviz skill for color and axis rules before writing this component's final styling.

- [ ] **Step 1: Write the components**

```jsx
// src/components/togari/StatCard.jsx
export default function StatCard({ label, value }) {
  return (
    <div className="dash-stat">
      <span className="dash-stat__value">{value ?? "-"}</span>
      <span className="dash-stat__label">{label}</span>
    </div>
  );
}
```

```jsx
// src/components/togari/MiniBarChart.jsx
export default function MiniBarChart({ data, xKey, yKey, height = 80 }) {
  if (!data?.length)
    return <div className="dash-chart-empty">No activity yet</div>;
  const max = Math.max(...data.map((d) => Number(d[yKey]) || 0), 1);
  const barWidth = 100 / data.length;
  return (
    <svg
      className="dash-minibar"
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="activity over time"
    >
      {data.map((d, i) => {
        const h = ((Number(d[yKey]) || 0) / max) * (height - 4);
        return (
          <rect
            key={d[xKey] ?? i}
            x={i * barWidth + barWidth * 0.15}
            y={height - h}
            width={barWidth * 0.7}
            height={h}
            rx="1"
            className="dash-minibar__bar"
          >
            <title>{`${d[xKey]}: ${d[yKey]}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
```

```jsx
// src/components/togari/DataGrid.jsx
export default function DataGrid({
  columns,
  rows,
  rowKey,
  onRowClick,
  searchValue,
  onSearchChange,
  loading,
  error,
  emptyLabel = "No records yet",
}) {
  return (
    <div className="dash-grid">
      {onSearchChange && (
        <input
          className="dash-grid__search"
          type="search"
          placeholder="Search..."
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      )}
      {error && <div className="dash-grid__error">{error}</div>}
      <table className="dash-grid__table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="dash-grid__state">
                Loading...
              </td>
            </tr>
          ) : !rows?.length ? (
            <tr>
              <td colSpan={columns.length} className="dash-grid__state">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row[rowKey]}
                className={onRowClick ? "dash-grid__row--clickable" : ""}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key}>
                    {c.render ? c.render(row) : (row[c.key] ?? "-")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
```

```jsx
// src/components/togari/DrillDown.jsx
import { Link } from "react-router-dom";
import StatCard from "./StatCard.jsx";

export default function DrillDown({
  title,
  subtitle,
  backTo,
  stats = [],
  children,
}) {
  return (
    <div className="dash-drill">
      <Link to={backTo} className="dash-drill__back">
        Back
      </Link>
      <header className="dash-drill__header">
        <h1>{title}</h1>
        {subtitle && <p className="dash-drill__subtitle">{subtitle}</p>}
      </header>
      {stats.length > 0 && (
        <div className="dash-drill__stats">
          {stats.map((s) => (
            <StatCard key={s.label} label={s.label} value={s.value} />
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
```

Append to `src/index.css`:

```css
/* Dashboard components */
.dash-grid__search {
  width: 320px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: transparent;
  color: inherit;
  margin-bottom: 16px;
}
.dash-grid__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.dash-grid__table th {
  text-align: left;
  padding: 10px 12px;
  opacity: 0.55;
  font-weight: 500;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.dash-grid__table td {
  padding: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.dash-grid__row--clickable {
  cursor: pointer;
}
.dash-grid__row--clickable:hover {
  background: rgba(255, 255, 255, 0.04);
}
.dash-grid__state {
  text-align: center;
  padding: 40px;
  opacity: 0.5;
}
.dash-grid__error {
  padding: 12px 16px;
  border-radius: 8px;
  background: rgba(220, 80, 80, 0.12);
  color: #f2b8b8;
  margin-bottom: 16px;
}
.dash-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 20px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  min-width: 140px;
}
.dash-stat__value {
  font-size: 26px;
  font-weight: 650;
}
.dash-stat__label {
  font-size: 12px;
  opacity: 0.55;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.dash-drill__back {
  display: inline-block;
  margin-bottom: 16px;
  opacity: 0.6;
  color: inherit;
}
.dash-drill__header h1 {
  font-size: 28px;
  margin: 0 0 4px;
}
.dash-drill__subtitle {
  opacity: 0.6;
  margin: 0 0 20px;
}
.dash-drill__stats {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin: 20px 0 28px;
}
.dash-minibar {
  width: 100%;
  height: 80px;
}
.dash-minibar__bar {
  fill: rgba(120, 160, 255, 0.85);
}
.dash-chart-empty {
  opacity: 0.5;
  padding: 24px 0;
}
.dash-section {
  margin-top: 28px;
}
.dash-section h2 {
  font-size: 15px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.6;
  margin-bottom: 12px;
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: success

- [ ] **Step 3: Commit**

```bash
git add src/components/togari/ src/index.css
git commit -m "feat: shared DataGrid, DrillDown, StatCard, MiniBarChart components"
```

---

### Task 13: Mass Data Explorer page with Togari chat panel

**Files:**

- Create: `src/pages/MassDataPage.jsx`
- Create: `src/pages/PersonDrillPage.jsx`
- Create: `src/components/togari/ChatPanel.jsx`
- Modify: `src/App.jsx` (swap placeholders)
- Modify: `src/index.css` (chat styles)

**Interfaces:**

- Consumes: `useApi`, `apiFetch` (Task 10); `DataGrid`, `DrillDown`, `MiniBarChart` (Task 12); endpoints from Tasks 5 and 9.
- Produces: `/dash/data` (grid of all people, search, chat panel on the right, refresh button) and `/dash/data/person/:personId` (drill-down).

- [ ] **Step 1: Write ChatPanel**

```jsx
// src/components/togari/ChatPanel.jsx
import { useState } from "react";
import { apiFetch } from "../../lib/api.js";

export default function ChatPanel() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const { answer } = await apiFetch("/api/togari/chat", {
        method: "POST",
        body: JSON.stringify({ message: text }),
      });
      setMessages((m) => [...m, { role: "togari", text: answer }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "error", text: err.message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="dash-chat">
      <h2>Talk to Togari</h2>
      <div className="dash-chat__log">
        {messages.length === 0 && (
          <p className="dash-chat__hint">
            Ask about your data or tell Togari to update it. Example: "move Acme
            to proposal stage" or "who did we meet last week?"
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`dash-chat__msg dash-chat__msg--${m.role}`}>
            {m.text}
          </div>
        ))}
        {busy && (
          <div className="dash-chat__msg dash-chat__msg--togari">
            Thinking...
          </div>
        )}
      </div>
      <form className="dash-chat__form" onSubmit={send}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message Togari..."
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}
```

- [ ] **Step 2: Write MassDataPage and PersonDrillPage**

```jsx
// src/pages/MassDataPage.jsx
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../lib/useApi.js";
import { apiFetch } from "../lib/api.js";
import DataGrid from "../components/togari/DataGrid.jsx";
import ChatPanel from "../components/togari/ChatPanel.jsx";

const COLUMNS = [
  { key: "full_name", label: "Name" },
  { key: "company", label: "Company" },
  { key: "title", label: "Title" },
  { key: "email", label: "Email" },
  { key: "relationship_score", label: "Score" },
  { key: "interaction_count", label: "Interactions" },
  {
    key: "last_interaction_at",
    label: "Last touch",
    render: (r) =>
      r.last_interaction_at
        ? new Date(
            r.last_interaction_at.value || r.last_interaction_at,
          ).toLocaleDateString()
        : "-",
  },
];

export default function MassDataPage() {
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const navigate = useNavigate();
  const path = useMemo(
    () => `/api/togari/people?search=${encodeURIComponent(search)}&limit=200`,
    [search],
  );
  const { loading, data, error, reload } = useApi(path);

  async function refresh() {
    setRefreshing(true);
    try {
      await apiFetch("/api/togari/refresh", {
        method: "POST",
        body: JSON.stringify({}),
      });
      reload();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="dash-split">
      <section className="dash-split__main">
        <div className="dash-page-head">
          <h1>Mass Data Explorer</h1>
          <div className="dash-page-head__meta">
            <span>{data ? `${data.total} people` : ""}</span>
            <button
              className="dash-btn"
              onClick={refresh}
              disabled={refreshing}
            >
              {refreshing ? "Pulling sources..." : "Refresh from sources"}
            </button>
          </div>
        </div>
        <DataGrid
          columns={COLUMNS}
          rows={data?.rows}
          rowKey="person_id"
          searchValue={search}
          onSearchChange={setSearch}
          loading={loading}
          error={error}
          emptyLabel="No people yet. Run a refresh to pull from Gmail, Fireflies, and Calendar."
          onRowClick={(row) => navigate(`/dash/data/person/${row.person_id}`)}
        />
      </section>
      <ChatPanel />
    </div>
  );
}
```

```jsx
// src/pages/PersonDrillPage.jsx
import { useParams } from "react-router-dom";
import { useApi } from "../lib/useApi.js";
import DrillDown from "../components/togari/DrillDown.jsx";
import DataGrid from "../components/togari/DataGrid.jsx";
import MiniBarChart from "../components/togari/MiniBarChart.jsx";

const INTERACTION_COLUMNS = [
  { key: "channel", label: "Channel" },
  { key: "direction", label: "Direction" },
  { key: "subject", label: "Subject" },
  { key: "summary", label: "Summary" },
  {
    key: "occurred_at",
    label: "When",
    render: (r) =>
      r.occurred_at
        ? new Date(r.occurred_at.value || r.occurred_at).toLocaleDateString()
        : "-",
  },
];

export default function PersonDrillPage() {
  const { personId } = useParams();
  const { loading, data, error } = useApi(`/api/togari/people/${personId}`);
  if (loading) return <div className="dash-loading">Loading person...</div>;
  if (error) return <div className="dash-grid__error">{error}</div>;
  const { entity, related, analytics } = data;
  return (
    <DrillDown
      title={entity.full_name || "Unknown"}
      subtitle={[entity.title, entity.company].filter(Boolean).join(" at ")}
      backTo="/dash/data"
      stats={[
        { label: "Relationship score", value: entity.relationship_score },
        { label: "Interactions", value: entity.interaction_count },
        {
          label: "Avg sentiment",
          value:
            analytics.avgSentiment == null
              ? "-"
              : analytics.avgSentiment.toFixed(2),
        },
        {
          label: "Top channel",
          value:
            Object.entries(analytics.byChannel).sort(
              (a, b) => b[1] - a[1],
            )[0]?.[0] || "-",
        },
      ]}
    >
      <section className="dash-section">
        <h2>Activity, last 12 months</h2>
        <MiniBarChart data={analytics.monthly} xKey="month" yKey="count" />
      </section>
      <section className="dash-section">
        <h2>Recent interactions</h2>
        <DataGrid
          columns={INTERACTION_COLUMNS}
          rows={related.interactions}
          rowKey="interaction_id"
          emptyLabel="No interactions recorded"
        />
      </section>
    </DrillDown>
  );
}
```

- [ ] **Step 3: Swap the placeholders in `src/App.jsx` and add styles**

```jsx
import MassDataPage from "./pages/MassDataPage.jsx";
import PersonDrillPage from "./pages/PersonDrillPage.jsx";
// replace the two data placeholders:
<Route path="data" element={<MassDataPage />} />
<Route path="data/person/:personId" element={<PersonDrillPage />} />
```

Append to `src/index.css`:

```css
.dash-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 24px;
  align-items: start;
}
@media (max-width: 1100px) {
  .dash-split {
    grid-template-columns: 1fr;
  }
}
.dash-page-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 18px;
}
.dash-page-head h1 {
  font-size: 24px;
  margin: 0;
}
.dash-page-head__meta {
  display: flex;
  gap: 16px;
  align-items: center;
  opacity: 0.85;
  font-size: 13px;
}
.dash-btn {
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 13px;
}
.dash-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.07);
}
.dash-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.dash-chat {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 140px);
  position: sticky;
  top: 24px;
}
.dash-chat h2 {
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.6;
  margin: 0 0 12px;
}
.dash-chat__log {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dash-chat__hint {
  font-size: 13px;
  opacity: 0.5;
}
.dash-chat__msg {
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  white-space: pre-wrap;
}
.dash-chat__msg--user {
  background: rgba(120, 160, 255, 0.15);
  align-self: flex-end;
  max-width: 90%;
}
.dash-chat__msg--togari {
  background: rgba(255, 255, 255, 0.06);
  align-self: flex-start;
  max-width: 95%;
}
.dash-chat__msg--error {
  background: rgba(220, 80, 80, 0.12);
  color: #f2b8b8;
}
.dash-chat__form {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.dash-chat__form input {
  flex: 1;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: transparent;
  color: inherit;
}
.dash-chat__form button {
  padding: 10px 16px;
  border-radius: 8px;
  border: none;
  background: rgba(120, 160, 255, 0.9);
  color: #0e0f12;
  font-weight: 600;
  cursor: pointer;
}
.dash-chat__form button:disabled {
  opacity: 0.4;
  cursor: default;
}
```

- [ ] **Step 4: Verify build and manual check**

Run: `npm run build` then `npm run dev`
Expected: `/dash/data` renders grid + chat; without BigQuery creds the grid shows the `togari_not_configured` error banner, which is correct degraded behavior.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MassDataPage.jsx src/pages/PersonDrillPage.jsx src/components/togari/ChatPanel.jsx src/App.jsx src/index.css
git commit -m "feat: mass data explorer with person drill-down and togari chat"
```

---

### Task 14: Channel Explorer page

**Files:**

- Create: `src/pages/ChannelsPage.jsx`
- Create: `src/pages/ChannelDrillPage.jsx`
- Modify: `src/App.jsx` (swap placeholders)
- Modify: `src/index.css` (card grid styles)

**Interfaces:**

- Consumes: Task 6 endpoints, shared components.
- Produces: `/dash/channels` (card grid, one card per channel with headline stats) and `/dash/channels/:key` (weekly MiniBarChart + top reactors grid; clicking a person navigates to `/dash/data/person/:personId`, chaining the drill-down).

- [ ] **Step 1: Write the pages**

```jsx
// src/pages/ChannelsPage.jsx
import { Link } from "react-router-dom";
import { useApi } from "../lib/useApi.js";

export default function ChannelsPage() {
  const { loading, data, error } = useApi("/api/togari/channels");
  if (loading) return <div className="dash-loading">Loading channels...</div>;
  if (error) return <div className="dash-grid__error">{error}</div>;
  return (
    <div>
      <div className="dash-page-head">
        <h1>Channel Explorer</h1>
      </div>
      <div className="dash-cards">
        {data.channels.map((c) => (
          <Link
            key={c.key}
            to={`/dash/channels/${c.key}`}
            className="dash-card"
          >
            <h2>{c.label}</h2>
            <div className="dash-card__stats">
              <span>{c.interactions} interactions</span>
              <span>{c.people} people</span>
              <span>{c.inbound} inbound</span>
            </div>
            <span className="dash-card__foot">
              Last activity:{" "}
              {c.lastActivity
                ? new Date(
                    c.lastActivity.value || c.lastActivity,
                  ).toLocaleDateString()
                : "none yet"}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

```jsx
// src/pages/ChannelDrillPage.jsx
import { useNavigate, useParams } from "react-router-dom";
import { useApi } from "../lib/useApi.js";
import DrillDown from "../components/togari/DrillDown.jsx";
import DataGrid from "../components/togari/DataGrid.jsx";
import MiniBarChart from "../components/togari/MiniBarChart.jsx";

const PEOPLE_COLUMNS = [
  { key: "full_name", label: "Name" },
  { key: "company", label: "Company" },
  { key: "total", label: "Touches" },
  { key: "inbound", label: "Replies / inbound" },
];

export default function ChannelDrillPage() {
  const { key } = useParams();
  const navigate = useNavigate();
  const { loading, data, error } = useApi(`/api/togari/channels/${key}`);
  if (loading) return <div className="dash-loading">Loading channel...</div>;
  if (error) return <div className="dash-grid__error">{error}</div>;
  const { entity, related, analytics } = data;
  const replyRate = analytics.totals.count
    ? Math.round((analytics.totals.inbound / analytics.totals.count) * 100)
    : 0;
  return (
    <DrillDown
      title={entity.label}
      subtitle="Last 12 weeks"
      backTo="/dash/channels"
      stats={[
        { label: "Interactions", value: analytics.totals.count },
        { label: "Inbound", value: analytics.totals.inbound },
        { label: "Reply rate", value: `${replyRate}%` },
      ]}
    >
      <section className="dash-section">
        <h2>Weekly volume</h2>
        <MiniBarChart data={analytics.weekly} xKey="week" yKey="count" />
      </section>
      <section className="dash-section">
        <h2>Who is reacting</h2>
        <DataGrid
          columns={PEOPLE_COLUMNS}
          rows={related.topPeople}
          rowKey="person_id"
          emptyLabel="No engagement yet on this channel"
          onRowClick={(row) => navigate(`/dash/data/person/${row.person_id}`)}
        />
      </section>
    </DrillDown>
  );
}
```

- [ ] **Step 2: Swap placeholders in `src/App.jsx` and add card styles**

```jsx
import ChannelsPage from "./pages/ChannelsPage.jsx";
import ChannelDrillPage from "./pages/ChannelDrillPage.jsx";
<Route path="channels" element={<ChannelsPage />} />
<Route path="channels/:key" element={<ChannelDrillPage />} />
```

Append to `src/index.css`:

```css
.dash-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 18px;
}
.dash-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  color: inherit;
  text-decoration: none;
  transition: border-color 120ms ease;
}
.dash-card:hover {
  border-color: rgba(120, 160, 255, 0.5);
}
.dash-card h2 {
  margin: 0;
  font-size: 18px;
}
.dash-card__stats {
  display: flex;
  gap: 14px;
  font-size: 13px;
  opacity: 0.8;
  flex-wrap: wrap;
}
.dash-card__foot {
  font-size: 12px;
  opacity: 0.5;
}
```

- [ ] **Step 3: Verify build and manual check**

Run: `npm run build` then `npm run dev`
Expected: two channel cards (Email Outbound, Founder Marketing); clicking one shows weekly bars and top reactors; clicking a reactor lands on their person drill page.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ChannelsPage.jsx src/pages/ChannelDrillPage.jsx src/App.jsx src/index.css
git commit -m "feat: channel explorer with per-channel drill-down"
```

---

### Task 15: Pipeline Explorer page (kanban)

**Files:**

- Create: `src/pages/PipelinePage.jsx`
- Create: `src/pages/ClientDrillPage.jsx`
- Modify: `src/App.jsx` (swap placeholders; ClientDrillPage serves both `/dash/pipeline/:clientId` and `/dash/clients/:clientId`)
- Modify: `src/index.css` (kanban styles)

**Interfaces:**

- Consumes: Task 7 endpoints, shared components.
- Produces: `/dash/pipeline` kanban with HTML5 drag-and-drop between stage columns (drop calls `PATCH /api/togari/pipeline/:clientId` with `{ stage, name }` then reloads) and `/dash/pipeline/:clientId` client drill-down (tasks, context timeline, analytics stats).

- [ ] **Step 1: Write PipelinePage**

```jsx
// src/pages/PipelinePage.jsx
import { useNavigate } from "react-router-dom";
import { useApi } from "../lib/useApi.js";
import { apiFetch } from "../lib/api.js";

export default function PipelinePage() {
  const { loading, data, error, reload } = useApi("/api/togari/pipeline");
  const navigate = useNavigate();
  if (loading) return <div className="dash-loading">Loading pipeline...</div>;
  if (error) return <div className="dash-grid__error">{error}</div>;

  async function moveTo(stage, payload) {
    const { clientId, name, fromStage } = JSON.parse(payload);
    if (fromStage === stage) return;
    await apiFetch(`/api/togari/pipeline/${clientId}`, {
      method: "PATCH",
      body: JSON.stringify({ stage, name }),
    });
    reload();
  }

  return (
    <div>
      <div className="dash-page-head">
        <h1>Pipeline Explorer</h1>
      </div>
      <div className="dash-kanban">
        {data.stages.map((col) => (
          <div
            key={col.stage}
            className="dash-kanban__col"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) =>
              moveTo(col.stage, e.dataTransfer.getData("text/plain"))
            }
          >
            <h2>
              {col.stage} <span>{col.clients.length}</span>
            </h2>
            {col.clients.map((c) => (
              <div
                key={c.client_id}
                className="dash-kanban__card"
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData(
                    "text/plain",
                    JSON.stringify({
                      clientId: c.client_id,
                      name: c.name,
                      fromStage: col.stage,
                    }),
                  )
                }
                onClick={() => navigate(`/dash/pipeline/${c.client_id}`)}
              >
                <strong>{c.name}</strong>
                {c.primary_email && <span>{c.primary_email}</span>}
                {c.owner && (
                  <span className="dash-kanban__owner">{c.owner}</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write ClientDrillPage**

```jsx
// src/pages/ClientDrillPage.jsx
import { useLocation, useParams } from "react-router-dom";
import { useApi } from "../lib/useApi.js";
import DrillDown from "../components/togari/DrillDown.jsx";
import DataGrid from "../components/togari/DataGrid.jsx";

const TASK_COLUMNS = [
  { key: "description", label: "Task" },
  { key: "status", label: "Status" },
  { key: "owner", label: "Owner" },
  {
    key: "due_date",
    label: "Due",
    render: (r) => r.due_date?.value || r.due_date || "-",
  },
  { key: "priority", label: "Priority" },
];

const CONTEXT_COLUMNS = [
  { key: "title", label: "Title" },
  { key: "content_type", label: "Type" },
  { key: "source", label: "Source" },
  {
    key: "occurred_at",
    label: "When",
    render: (r) => {
      const ts = r.occurred_at || r.created_at;
      return ts ? new Date(ts.value || ts).toLocaleDateString() : "-";
    },
  },
];

export default function ClientDrillPage() {
  const { clientId } = useParams();
  const location = useLocation();
  const backTo = location.pathname.startsWith("/dash/clients")
    ? "/dash/clients"
    : "/dash/pipeline";
  const { loading, data, error } = useApi(`/api/togari/clients/${clientId}`);
  if (loading) return <div className="dash-loading">Loading client...</div>;
  if (error) return <div className="dash-grid__error">{error}</div>;
  const { entity, related, analytics } = data;
  return (
    <DrillDown
      title={entity.name}
      subtitle={[entity.stage, entity.owner, entity.primary_email]
        .filter(Boolean)
        .join("  |  ")}
      backTo={backTo}
      stats={[
        { label: "Open tasks", value: analytics.openTasks },
        { label: "Done tasks", value: analytics.doneTasks },
        {
          label: "Last touch",
          value: analytics.lastTouch
            ? new Date(
                analytics.lastTouch.value || analytics.lastTouch,
              ).toLocaleDateString()
            : "-",
        },
        { label: "Context items", value: related.context.length },
      ]}
    >
      {entity.summary && (
        <section className="dash-section">
          <h2>Summary</h2>
          <p>{entity.summary}</p>
        </section>
      )}
      <section className="dash-section">
        <h2>Tasks</h2>
        <DataGrid
          columns={TASK_COLUMNS}
          rows={related.tasks}
          rowKey="task_id"
          emptyLabel="No tasks"
        />
      </section>
      <section className="dash-section">
        <h2>Context timeline</h2>
        <DataGrid
          columns={CONTEXT_COLUMNS}
          rows={related.context}
          rowKey="context_id"
          emptyLabel="No context yet"
        />
      </section>
    </DrillDown>
  );
}
```

- [ ] **Step 3: Swap placeholders in `src/App.jsx` and add kanban styles**

```jsx
import PipelinePage from "./pages/PipelinePage.jsx";
import ClientDrillPage from "./pages/ClientDrillPage.jsx";
<Route path="pipeline" element={<PipelinePage />} />
<Route path="pipeline/:clientId" element={<ClientDrillPage />} />
<Route path="clients/:clientId" element={<ClientDrillPage />} />
```

Append to `src/index.css`:

```css
.dash-kanban {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  align-items: flex-start;
  padding-bottom: 12px;
}
.dash-kanban__col {
  min-width: 260px;
  flex: 1;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  padding: 14px;
}
.dash-kanban__col h2 {
  font-size: 13px;
  text-transform: capitalize;
  letter-spacing: 0.04em;
  opacity: 0.7;
  display: flex;
  justify-content: space-between;
  margin: 0 0 12px;
}
.dash-kanban__card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 10px;
  cursor: pointer;
  font-size: 13px;
}
.dash-kanban__card:hover {
  border-color: rgba(120, 160, 255, 0.5);
}
.dash-kanban__card span {
  opacity: 0.6;
  font-size: 12px;
}
.dash-kanban__owner {
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 10px;
}
```

- [ ] **Step 4: Verify build and manual check**

Run: `npm run build` then `npm run dev`
Expected: stage columns render; dragging a card to another column fires the PATCH (visible in the network tab) and the board reloads; clicking a card opens the client drill-down.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PipelinePage.jsx src/pages/ClientDrillPage.jsx src/App.jsx src/index.css
git commit -m "feat: pipeline kanban with drag stage moves and client drill-down"
```

---

### Task 16: Management Explorer page

**Files:**

- Create: `src/pages/ManagementPage.jsx`
- Modify: `src/App.jsx` (swap placeholder)

**Interfaces:**

- Consumes: Task 8 endpoints, shared components; `ClientDrillPage` (Task 15) already handles `/dash/clients/:clientId`.
- Produces: `/dash/clients` card grid of paying clients. Each card shows name, owner, Slack link and contract link when set, plus inline forms to save meta (`POST /meta`) and upload a DNC file (`POST /dnc`, read client-side with `FileReader`). Card header click drills into `/dash/clients/:clientId`.

- [ ] **Step 1: Write the page**

```jsx
// src/pages/ManagementPage.jsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../lib/useApi.js";
import { apiFetch } from "../lib/api.js";

function ClientCard({ client, onSaved }) {
  const [slackUrl, setSlackUrl] = useState(client.attributes.slack_url || "");
  const [contractUrl, setContractUrl] = useState(
    client.attributes.contract_url || "",
  );
  const [status, setStatus] = useState("");

  async function saveMeta(e) {
    e.preventDefault();
    setStatus("Saving...");
    try {
      await apiFetch(`/api/togari/management/${client.client_id}/meta`, {
        method: "POST",
        body: JSON.stringify({
          name: client.name,
          slack_url: slackUrl,
          contract_url: contractUrl,
        }),
      });
      setStatus("Saved");
      onSaved();
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function uploadDnc(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("Uploading DNC list...");
    const content = await file.text();
    try {
      await apiFetch(`/api/togari/management/${client.client_id}/dnc`, {
        method: "POST",
        body: JSON.stringify({
          name: client.name,
          filename: file.name,
          content,
        }),
      });
      setStatus(`Stored ${file.name}`);
    } catch (err) {
      setStatus(err.message);
    }
  }

  return (
    <div className="dash-card dash-card--static">
      <Link
        to={`/dash/clients/${client.client_id}`}
        className="dash-card__title"
      >
        <h2>{client.name}</h2>
      </Link>
      <div className="dash-card__stats">
        {client.owner && <span>Owner: {client.owner}</span>}
        {client.attributes.slack_url && (
          <a
            href={client.attributes.slack_url}
            target="_blank"
            rel="noreferrer"
          >
            Slack
          </a>
        )}
        {client.attributes.contract_url && (
          <a
            href={client.attributes.contract_url}
            target="_blank"
            rel="noreferrer"
          >
            Contract
          </a>
        )}
      </div>
      <form className="dash-card__form" onSubmit={saveMeta}>
        <input
          value={slackUrl}
          onChange={(e) => setSlackUrl(e.target.value)}
          placeholder="Slack channel URL"
        />
        <input
          value={contractUrl}
          onChange={(e) => setContractUrl(e.target.value)}
          placeholder="Contract URL"
        />
        <div className="dash-card__actions">
          <button type="submit" className="dash-btn">
            Save
          </button>
          <label className="dash-btn">
            Upload DNC list
            <input type="file" accept=".csv,.txt" hidden onChange={uploadDnc} />
          </label>
        </div>
      </form>
      {status && <span className="dash-card__foot">{status}</span>}
    </div>
  );
}

export default function ManagementPage() {
  const { loading, data, error, reload } = useApi("/api/togari/management");
  if (loading) return <div className="dash-loading">Loading clients...</div>;
  if (error) return <div className="dash-grid__error">{error}</div>;
  return (
    <div>
      <div className="dash-page-head">
        <h1>Management Explorer</h1>
        <span className="dash-page-head__meta">
          {data.clients.length} paying clients
        </span>
      </div>
      <div className="dash-cards">
        {data.clients.length === 0 && (
          <p className="dash-placeholder">
            No paying clients yet. A client appears here once their status is
            won.
          </p>
        )}
        {data.clients.map((c) => (
          <ClientCard key={c.client_id} client={c} onSaved={reload} />
        ))}
      </div>
    </div>
  );
}
```

Append to `src/index.css`:

```css
.dash-card--static {
  cursor: default;
}
.dash-card__title {
  color: inherit;
  text-decoration: none;
}
.dash-card__title:hover h2 {
  text-decoration: underline;
}
.dash-card__form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dash-card__form input {
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: transparent;
  color: inherit;
  font-size: 13px;
}
.dash-card__actions {
  display: flex;
  gap: 8px;
}
.dash-card__actions label {
  display: inline-flex;
  align-items: center;
}
```

- [ ] **Step 2: Swap placeholder in `src/App.jsx`**

```jsx
import ManagementPage from "./pages/ManagementPage.jsx";
<Route path="clients" element={<ManagementPage />} />;
```

- [ ] **Step 3: Verify build and manual check**

Run: `npm run build` then `npm run dev`
Expected: management grid renders (empty state without data); meta save and DNC upload hit the endpoints.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ManagementPage.jsx src/App.jsx src/index.css
git commit -m "feat: management explorer with client meta and DNC uploads"
```

---

### Task 17: Full verification, deploy config, push

**Files:**

- Modify: `.env.example` (document new vars)
- Modify: `README.md` (dashboard section)

- [ ] **Step 1: Append the new env vars to `.env.example`** (copy the block from Global Constraints, with comments).

- [ ] **Step 2: Add a README section**

```markdown
## Togari dashboard

Post-login dashboard over the Togari backend (amber-organization/togari-platform).
Reads BigQuery directly (`togari_pdw`, `togari_data_lake`) for grids and analytics;
writes, chat, and refresh go through Togari's MCP tools. Views: Mass Data, Channels,
Pipeline, Clients (management), Wiki. Every row click opens a drill-down with
analytics for that entity. Requires GCP_CREDENTIALS_BASE64, TOGARI_MCP_URL, and
TOGARI_MCP_TOKEN; without them the wiki still works and dashboard endpoints
return togari_not_configured.
```

Keep the README's existing signature footer as the last line.

- [ ] **Step 3: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds.

- [ ] **Step 4: End-to-end smoke against the real backend** (needs the env vars set)

Start `npm run dev`, sign in, then verify in order: `/api/togari/status` shows `bigquery: true, mcp: true`; Mass Data lists real people (if empty, click Refresh from sources and wait); a person drill shows interactions; Channels shows nonzero counts; Pipeline shows clients and a drag persists after a hard reload; chat answers a question. If BigQuery access is denied, the service account lacks the `BigQuery Data Viewer` and `BigQuery Job User` roles on project `midyear-glazing-485303-u3`; request them from Sagar or Karthik.

- [ ] **Step 5: Run the stop-slop pass on all UI copy** (mandatory before showing Colin or Sagar), then push and report

```bash
git push origin main
```

Post a group-chat update summarizing what shipped, per the standing agreement with Sagar.

---

## Later phases (explicitly out of this plan's scope, listed so they are not lost)

- Streaming chat over `POST /api/v1/message/stream` SSE instead of blocking `togari_ask`.
- Editable spreadsheet cells in Mass Data (writes via `togari_client_upsert` / person-level MCP tools once togari-platform exposes them; the PDW `persons` table currently has no MCP write tool).
- Companies tab inside Mass Data backed by `togari_data_lake.clients` (top-of-funnel companies), reusing DataGrid and the client drill endpoint.
- Wiki as the connected multi-source hub (embed dashboard stats into wiki pages).
- Client-facing upload portal (clients log in themselves to upload DNC lists and documents). togari-platform already has per-client-key portal routes at `/api/v1/portal/*`; wiring a client login against those is a separate auth surface and its own plan. This plan's DNC upload is internal (BMA team uploads on the client's behalf).
- Multi-brand rollout for Ritual, Amber, Silo: parameterize `TOGARI_BRAND` / `TOGARI_OWNER_ID` per deployment; togari-platform is single-tenant-in-practice today, so this also needs backend tenant work.
- Scheduled daily `togari_pull` (cron on Railway or togari-platform's AUTO_POLL) instead of the manual refresh button.
