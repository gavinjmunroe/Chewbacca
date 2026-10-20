import { describe, it, expect, beforeEach } from "vitest";
import { queueBqRows, getMockState } from "../../../../tests/smoke/helpers";
import { createClayConnectorRouter } from "../index";

const KEY = "test-clay-connector-key";

/**
 * Drive the express router without a listening server. We fabricate minimal
 * req/res objects and hand them to router.handle(), capturing the JSON body and
 * status the route sets. Same approach as clay-lead.test.ts.
 */
function invoke(
  router: ReturnType<typeof createClayConnectorRouter>,
  method: string,
  path: string,
  body: unknown,
  authHeader: string | null = `Bearer ${KEY}`,
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify(body ?? {}));
    let dataEmitted = false;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "content-length": String(raw.length),
    };
    if (authHeader) headers.authorization = authHeader;

    const req: any = {
      method: method.toUpperCase(),
      url: path,
      query: {},
      headers,
      header(name: string) {
        return this.headers[name.toLowerCase()];
      },
      on(event: string, cb: (chunk?: any) => void) {
        if (event === "data" && !dataEmitted) {
          dataEmitted = true;
          cb(raw);
        }
        if (event === "end") cb();
        return this;
      },
      once() {
        return this;
      },
      removeListener() {
        return this;
      },
      pipe() {
        return this;
      },
      unpipe() {
        return this;
      },
      resume() {
        return this;
      },
      setEncoding() {
        return this;
      },
    };

    let statusCode = 200;
    const res: any = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        statusCode = code;
        this.statusCode = code;
        return this;
      },
      set() {
        return this;
      },
      setHeader() {
        return this;
      },
      getHeader() {
        return undefined;
      },
      json(payload: any) {
        this.headersSent = true;
        resolve({ status: statusCode, json: payload });
        return this;
      },
      end() {
        this.headersSent = true;
        resolve({ status: statusCode, json: undefined });
        return this;
      },
    };

    (router as any).handle(req, res, (err: unknown) => {
      if (err) reject(err);
      else resolve({ status: statusCode, json: undefined });
    });
  });
}

describe("createClayConnectorRouter — /clay/v1", () => {
  beforeEach(() => {
    process.env.CLAY_CONNECTOR_KEY = KEY;
    process.env.GCP_PROJECT_ID = "test-project";
    // DNC enforcement must be on so the check actually queries BigQuery.
    process.env.DNC_ENFORCEMENT_ENABLED = "true";
    delete process.env.NODE_ENV;
  });

  it("rejects sync without the connector key", async () => {
    process.env.NODE_ENV = "production";
    const router = createClayConnectorRouter();
    const res = await invoke(router, "POST", "/sync", { action: "dnc" }, null);
    expect(res.status).toBe(401);
    expect(res.json.ok).toBe(false);
  });

  it("action=dnc returns is_dnc true when the DNC list matches", async () => {
    // The mock shifts one queued response per BigQuery job — reads AND writes.
    // Registry does a read then a MERGE write, so both consume a slot before
    // the DNC SELECT runs.
    queueBqRows([]); // registry read (table unseen)
    queueBqRows([]); // registry MERGE write
    // DNC SELECT returns a matching suppression row.
    queueBqRows([
      {
        id: "dnc-1",
        email: "blocked@acme.com",
        company_domain: "acme.com",
        dnc_reason: "on_dnc_list",
        dnc_added_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const router = createClayConnectorRouter();
    const res = await invoke(router, "POST", "/sync", {
      action: "dnc",
      table: "my_leads",
      email: "blocked@acme.com",
    });

    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(res.json.action).toBe("dnc");
    expect(res.json.is_dnc).toBe(true);
    expect(res.json.dnc_reason).toBe("on_dnc_list");
    expect(res.json.matched).toBe(1);
  });

  it("action=dnc returns is_dnc false when the DNC list is empty", async () => {
    queueBqRows([]); // registry read
    queueBqRows([]); // registry MERGE write
    queueBqRows([]); // DNC SELECT empty

    const router = createClayConnectorRouter();
    const res = await invoke(router, "POST", "/sync", {
      action: "dnc",
      email: "clean@acme.com",
    });

    expect(res.status).toBe(200);
    expect(res.json.is_dnc).toBe(false);
    expect(res.json.dnc_reason).toBe("");
    expect(res.json.matched).toBe(0);
  });

  it("action=ingest stores the raw row and returns extracted counts", async () => {
    // registry read + merge, then the universal ingest writes (raw store,
    // status update). Extraction returns nothing (no Anthropic handler), so
    // routing is empty but the raw write must have happened.
    queueBqRows([]); // registry read
    // Anthropic extractor gets no handler -> extraction fails -> 0 entities.

    const router = createClayConnectorRouter();
    const res = await invoke(router, "POST", "/sync", {
      action: "ingest",
      table: "cold_outreach",
      full_name: "Jane Doe",
      email: "jane@acme.com",
      company: "Acme",
    });

    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(res.json.action).toBe("ingest");
    expect(res.json.togari_ingestion_id).toBeTruthy();
    expect(typeof res.json.extracted).toBe("number");

    // The raw submission must have been written to BigQuery.
    const writes = getMockState().bq.writes;
    expect(writes.length).toBeGreaterThan(0);
  });

  it("unknown table still returns 200 and issues a registry MERGE", async () => {
    queueBqRows([]); // registry read (unknown table -> empty)
    queueBqRows([]); // registry MERGE write
    queueBqRows([]); // DNC SELECT (empty is fine)

    const router = createClayConnectorRouter();
    const res = await invoke(router, "POST", "/sync", {
      action: "dnc",
      // no `table` -> resolves to "unknown"
      email: "someone@new.com",
    });

    expect(res.status).toBe(200);

    const writes = getMockState().bq.writes;
    const registryMerge = writes.find(
      (w) => w.sql.includes("MERGE") && w.sql.includes("clay_table_registry"),
    );
    expect(registryMerge).toBeTruthy();
    expect(registryMerge!.params.tableKey).toBe("unknown");
  });

  it("GET /schema returns the action list without auth", async () => {
    const router = createClayConnectorRouter();
    const res = await invoke(router, "GET", "/schema", null, null);

    expect(res.status).toBe(200);
    expect(res.json.service).toBe("togari-clay-connector");
    const actions = res.json.actions.map((a: any) => a.action);
    expect(actions).toEqual(["ingest", "dnc", "upsert", "enrich"]);
  });

  it("GET /health returns ok", async () => {
    const router = createClayConnectorRouter();
    const res = await invoke(router, "GET", "/health", null, null);
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(res.json.service).toBe("togari-clay-connector");
  });
});
