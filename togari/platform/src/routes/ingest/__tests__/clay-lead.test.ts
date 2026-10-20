import { describe, it, expect, beforeEach, vi } from "vitest";
import { queueBqRows, getMockState } from "../../../../tests/smoke/helpers";

// The DNC module is built in parallel by another agent. Mock it so this route
// can be tested in isolation. The mock is driven per-test via `dncResult`.
let dncResult: {
  suppressed: boolean;
  reason?: string;
  matches: unknown[];
} = { suppressed: false, matches: [] };

vi.mock("../../../dnc", () => ({
  checkDncByEmail: async () => dncResult,
}));

import { createClayLeadRouter } from "../clay-lead";

const KEY = "test-clay-ingest-key";

/**
 * Drive the express router without a listening server. We fabricate minimal
 * req/res objects and hand them to router.handle(), capturing the JSON body
 * and status the route sets.
 */
function invoke(
  router: ReturnType<typeof createClayLeadRouter>,
  body: unknown,
  authHeader = `Bearer ${KEY}`,
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify(body));
    let dataEmitted = false;
    const req: any = {
      method: "POST",
      url: "/lead",
      headers: {
        "content-type": "application/json",
        "content-length": String(raw.length),
        authorization: authHeader,
      },
      header(name: string) {
        return this.headers[name.toLowerCase()];
      },
      // express.json() reads the body off the stream.
      on(event: string, cb: (chunk?: any) => void) {
        if (event === "data" && !dataEmitted) {
          dataEmitted = true;
          cb(raw);
        }
        if (event === "end") cb();
        return this;
      },
      once(_event: string, _cb: () => void) {
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

describe("createClayLeadRouter — /webhooks/clay/lead", () => {
  beforeEach(() => {
    process.env.CLAY_INGEST_API_KEY = KEY;
    process.env.GCP_PROJECT_ID = "test-project";
    dncResult = { suppressed: false, matches: [] };
  });

  it("rejects a request without the ingest key", async () => {
    const router = createClayLeadRouter();
    const res = await invoke(router, { email: "a@x.com" }, "Bearer wrong-key");
    expect(res.status).toBe(401);
  });

  it("fans out to GCP and Rytual when NOT suppressed", async () => {
    dncResult = { suppressed: false, matches: [] };
    // Two executeWrite calls: GCP insert, then Rytual insert.
    queueBqRows([]);
    queueBqRows([]);

    const router = createClayLeadRouter();
    const res = await invoke(router, {
      email: "lead@acme.com",
      full_name: "Lead Person",
      company: "Acme",
      company_domain: "acme.com",
    });

    expect(res.status).toBe(200);
    expect(res.json.dnc.suppressed).toBe(false);
    expect(res.json.gcp.status).toBe("inserted");
    expect(res.json.rytual.status).toBe("added");

    const writes = getMockState().bq.writes;
    expect(writes.length).toBe(2);
    expect(writes[0].sql).toContain("INSERT INTO");
    expect(writes[0].sql).toContain("contacts");
    expect(writes[1].sql).toContain("rytual_audience");
  });

  it("blocks the Rytual branch when DNC-suppressed but still records to GCP", async () => {
    dncResult = { suppressed: true, reason: "on_dnc_list", matches: [{}] };
    queueBqRows([]); // GCP insert only

    const router = createClayLeadRouter();
    const res = await invoke(router, {
      email: "blocked@acme.com",
      company_domain: "acme.com",
    });

    expect(res.status).toBe(200);
    expect(res.json.dnc.suppressed).toBe(true);
    expect(res.json.gcp.status).toBe("inserted");
    expect(res.json.rytual.skipped).toBe(true);
    expect(res.json.rytual.reason).toBe("dnc_suppressed");

    // Only ONE write (GCP), Rytual was skipped.
    const writes = getMockState().bq.writes;
    expect(writes.length).toBe(1);
    expect(writes[0].sql).toContain("contacts");
  });

  it("rejects an invalid payload (missing email)", async () => {
    const router = createClayLeadRouter();
    const res = await invoke(router, { full_name: "No Email" });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_payload");
  });
});
