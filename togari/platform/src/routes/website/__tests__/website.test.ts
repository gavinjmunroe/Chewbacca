import { describe, it, expect, beforeEach, vi } from "vitest";
import { queueBqRows, getMockState, onFetch } from "../../../../tests/smoke/helpers";

// Isolate the route from the real DNC service (it would consume queued
// BigQuery responses and break statement-order assertions).
let dncResult: { suppressed: boolean; reason?: string; matches: unknown[] } = {
  suppressed: false,
  matches: [],
};

vi.mock("../../../dnc", () => ({
  checkDncByEmail: async () => dncResult,
}));

import { createWebsiteRouter, scoreIcpLead, isWorkEmail } from "../index";

const KEY = "test-website-ingest-key";
const CLAY_URL = "https://api.clay.com/v3/sources/webhook/test-icp";

/**
 * Drive the express router without a listening server (same harness as
 * clay-lead.test.ts). The fake req carries an ip for the rate limiter.
 */
function invoke(
  router: ReturnType<typeof createWebsiteRouter>,
  method: string,
  url: string,
  body: unknown,
  authHeader = `Bearer ${KEY}`,
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify(body ?? {}));
    let dataEmitted = false;
    const req: any = {
      method,
      url,
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      headers: {
        "content-type": "application/json",
        "content-length": String(raw.length),
        authorization: authHeader,
      },
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

const VALID_REQUEST = {
  full_name: "Jane Smith",
  email: "jane@acme.com",
  company: "Acme",
  company_domain: "acme.com",
  company_description: "revenue cycle software for dental groups",
  industry: "Healthcare",
  icp_description: "multi-site dental groups in the Midwest",
  company_size: "51–200",
  target_titles: ["Founder / CEO", "Revenue / RevOps"],
};

describe("createWebsiteRouter — /api/v1/website", () => {
  beforeEach(() => {
    process.env.WEBSITE_INGEST_API_KEY = KEY;
    process.env.ICP_PIPELINE_ENABLED = "true";
    process.env.CLAY_ICP_WEBHOOK_URL = CLAY_URL;
    process.env.GCP_PROJECT_ID = "test-project";
    process.env.ICP_AUTOSEND_ENABLED = "true";
    process.env.GCP_CREDENTIALS_BASE64 = Buffer.from(
      JSON.stringify({ client_email: "svc@test.iam", private_key: "fake-key" }),
    ).toString("base64");
    delete process.env.SLACK_WEBSITE_NOTIFY_WEBHOOK;
    delete process.env.ICP_EMAIL_BCC;
  });

  it("rejects a request without the website key", async () => {
    const router = createWebsiteRouter();
    const res = await invoke(
      router,
      "POST",
      "/icp-request",
      VALID_REQUEST,
      "Bearer wrong-key",
    );
    expect(res.status).toBe(401);
  });

  it("returns 503 when the pipeline is disabled", async () => {
    process.env.ICP_PIPELINE_ENABLED = "false";
    const router = createWebsiteRouter();
    const res = await invoke(router, "POST", "/icp-request", VALID_REQUEST);
    expect(res.status).toBe(503);
    expect(res.json.error).toBe("pipeline_disabled");
  });

  it("rejects an invalid payload (bad company domain)", async () => {
    const router = createWebsiteRouter();
    const res = await invoke(router, "POST", "/icp-request", {
      ...VALID_REQUEST,
      company_domain: "not a domain",
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_payload");
  });

  it("normalizes a URL-shaped company domain", async () => {
    onFetch(CLAY_URL, () => ({}));
    const router = createWebsiteRouter();
    const res = await invoke(router, "POST", "/icp-request", {
      ...VALID_REQUEST,
      company_domain: "https://www.Acme.com/about",
    });
    expect(res.status).toBe(202);
    expect(getMockState().bq.writes[0].params.companyDomain).toBe("acme.com");
  });

  it("rejects an invalid payload (missing ICP brief)", async () => {
    const router = createWebsiteRouter();
    const res = await invoke(router, "POST", "/icp-request", {
      ...VALID_REQUEST,
      icp_description: "",
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_payload");
  });

  it("accepts a valid request: job insert, lead merge, clay push, 202", async () => {
    onFetch(CLAY_URL, () => ({}));
    const router = createWebsiteRouter();
    const res = await invoke(router, "POST", "/icp-request", VALID_REQUEST);

    expect(res.status).toBe(202);
    expect(res.json.job_id).toBeTruthy();
    expect(res.json.status).toBe("pending");

    const writes = getMockState().bq.writes;
    // INSERT job → MERGE contact → UPDATE status(building)
    expect(writes.length).toBe(3);
    expect(writes[0].sql).toContain("icp_list_jobs");
    expect(writes[0].sql).toContain("INSERT");
    expect(writes[1].sql).toContain("MERGE");
    expect(writes[1].sql).toContain("togari_structured_contacts");
    expect(writes[1].params.sourceTag).toBe("website-icp-list");
    expect(writes[1].sql).toContain("work_email = @email");
    expect(writes[1].sql).not.toMatch(/\bworkEmail\b/);
    expect(writes[2].sql).toContain("UPDATE");
    expect(writes[2].params.status).toBe("building");

    // The Clay push happened, carrying the passthrough envelope.
    const clayCall = getMockState().fetch.calls.find((c: any) =>
      c.url.includes("api.clay.com"),
    );
    expect(clayCall).toBeTruthy();
    const pushed = JSON.parse(clayCall.init.body);
    expect(pushed.job_id).toBe(res.json.job_id);
    expect(pushed.row_id).toBe(res.json.job_id);
    expect(pushed.icp_description).toBe("multi-site dental groups in the Midwest");
    expect(pushed.requester_domain).toBe("acme.com");
    expect(pushed.target_titles).toBe("Founder / CEO, Revenue / RevOps");
    expect(pushed.callback_url).toContain("/webhooks/clay/icp-callback");
  });

  it("stores the ICP brief and target roles on the job", async () => {
    onFetch(CLAY_URL, () => ({}));
    const router = createWebsiteRouter();
    const res = await invoke(router, "POST", "/icp-request", VALID_REQUEST);
    expect(res.status).toBe(202);
    const writes = getMockState().bq.writes;
    expect(writes[0].params.icpDescription).toBe(
      "multi-site dental groups in the Midwest",
    );
    expect(writes[0].params.targetTitles).toEqual([
      "Founder / CEO",
      "Revenue / RevOps",
    ]);
    expect(writes[0].params.workEmail).toBe(true);
    expect(writes[0].params.companyDomain).toBe("acme.com");
  });

  it("returns 409 when the email has ever requested a list, ignoring case and +tags", async () => {
    queueBqRows([
      { job_id: "existing-job", status: "done", created_at: "2026-09-01T12:00:00Z" },
    ]);
    const router = createWebsiteRouter();
    const res = await invoke(router, "POST", "/icp-request", {
      ...VALID_REQUEST,
      email: "Jane+second-try@Acme.com",
      icp_description: "a completely different brief",
    });
    expect(res.status).toBe(409);
    expect(res.json.job_id).toBe("existing-job");
    expect(res.json.error).toBe("already_requested");
    expect(res.json.requested_at).toBe("2026-09-01T12:00:00Z");

    const lookup = getMockState().bq.queries[0];
    expect(lookup.sql).toContain("REGEXP_REPLACE(LOWER(email)");
    expect(lookup.sql).not.toContain("INTERVAL");
    expect(lookup.params.email).toBe("jane@acme.com");
    // Nothing recorded, nothing sent to Clay, no email.
    expect(getMockState().bq.writes.length).toBe(0);
    expect(getMockState().gmail.sends.length).toBe(0);
  });

  it("returns 429 when the global daily cap is reached", async () => {
    queueBqRows([]); // duplicate check → none
    queueBqRows([{ total: 100, for_email: 0 }]); // caps query
    const router = createWebsiteRouter();
    const res = await invoke(router, "POST", "/icp-request", VALID_REQUEST);
    expect(res.status).toBe(429);
    expect(res.json.error).toBe("daily_cap_reached");
  });

  it("marks the job failed (still 202) when the Clay push fails", async () => {
    // No fetch handler registered → stubbed fetch returns 500 → push fails.
    const router = createWebsiteRouter();
    const res = await invoke(router, "POST", "/icp-request", VALID_REQUEST);
    expect(res.status).toBe(202);
    const writes = getMockState().bq.writes;
    expect(writes[writes.length - 1].params.status).toBe("failed");
  });

  it("emails nothing and tells Slack to reach out when the Clay push fails", async () => {
    process.env.SLACK_WEBSITE_NOTIFY_WEBHOOK = "https://hooks.slack.test/x";
    const router = createWebsiteRouter();
    await invoke(router, "POST", "/icp-request", VALID_REQUEST);
    expect(getMockState().gmail.sends.length).toBe(0);
    const ping = getMockState().fetch.calls.find((c: any) => c.url.includes("hooks.slack.test"));
    expect(JSON.parse(ping.init.body).text).toContain("could not be sent to Clay");
    expect(JSON.parse(ping.init.body).text).toContain("Reach out personally");
    delete process.env.SLACK_WEBSITE_NOTIFY_WEBHOOK;
  });

  it("sends no email at intake: the list is the first email they get", async () => {
    process.env.SLACK_WEBSITE_NOTIFY_WEBHOOK = "https://hooks.slack.test/x";
    onFetch(CLAY_URL, () => ({}));
    const router = createWebsiteRouter();
    const res = await invoke(router, "POST", "/icp-request", VALID_REQUEST);
    expect(res.status).toBe(202);
    expect(getMockState().gmail.sends.length).toBe(0);
    // Slack hears once, when the list is sent or stuck, not on submit.
    const pinged = getMockState().fetch.calls.some((c: any) => c.url.includes("hooks.slack.test"));
    expect(pinged).toBe(false);
    delete process.env.SLACK_WEBSITE_NOTIFY_WEBHOOK;
  });

  it("respects the autosend kill switch at intake", async () => {
    process.env.ICP_AUTOSEND_ENABLED = "false";
    onFetch(CLAY_URL, () => ({}));
    const router = createWebsiteRouter();
    const res = await invoke(router, "POST", "/icp-request", VALID_REQUEST);
    expect(res.status).toBe(202);
    expect(getMockState().gmail.sends.length).toBe(0);
  });

  it("records a contact message and upserts a tagged lead", async () => {
    const router = createWebsiteRouter();
    const res = await invoke(router, "POST", "/contact", {
      full_name: "Sam Lee",
      email: "sam@example.org",
      message: "Interested in a healthcare data audit.",
    });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);

    const writes = getMockState().bq.writes;
    expect(writes.length).toBe(2);
    expect(writes[0].sql).toContain("website_contact_messages");
    expect(writes[1].sql).toContain("MERGE");
    expect(writes[1].params.sourceTag).toBe("website-contact");
  });

  it("rejects a contact message without a message body", async () => {
    const router = createWebsiteRouter();
    const res = await invoke(router, "POST", "/contact", {
      full_name: "Sam Lee",
      email: "sam@example.org",
      message: "",
    });
    expect(res.status).toBe(400);
  });

  it("returns status without PII for a known job", async () => {
    queueBqRows([
      {
        job_id: "job-1",
        status: "enriching",
        email: "jane@acme.com",
        company_domain: "acme.com",
        full_name: "Jane Smith",
      },
    ]);
    const router = createWebsiteRouter();
    const res = await invoke(router, "GET", "/icp-status/job-1", undefined);
    expect(res.status).toBe(200);
    expect(res.json.status).toBe("enriching");
    expect(res.json.email).toBeUndefined();
    expect(res.json.full_name).toBeUndefined();
  });
});

describe("scoreIcpLead", () => {
  const base = {
    full_name: "Jane Smith",
    email: "jane@acme.com",
    company: "Acme",
    company_domain: "acme.com",
    icp_description: "multi-site dental groups in the Midwest",
    target_titles: ["Founder / CEO"],
  };

  it("scores a complete brief from a matching work email at the top", () => {
    expect(scoreIcpLead(base)).toBe(100);
  });

  it("scores a personal-email lead lower", () => {
    expect(scoreIcpLead({ ...base, email: "jane@gmail.com" })).toBeLessThan(80);
  });

  it("scores a work email that doesn't match the stated company lower", () => {
    const mismatched = scoreIcpLead({ ...base, email: "jane@totallyunrelated.io" });
    expect(mismatched).toBeLessThan(scoreIcpLead(base));
  });

  it("scores a thin brief lower than a specific one", () => {
    expect(
      scoreIcpLead({ ...base, icp_description: "SaaS", target_titles: [] }),
    ).toBeLessThan(scoreIcpLead(base));
  });
});

describe("isWorkEmail", () => {
  it("treats free providers as personal", () => {
    expect(isWorkEmail("jane@gmail.com")).toBe(false);
    expect(isWorkEmail("jane@outlook.com")).toBe(false);
  });

  it("treats company domains as work addresses", () => {
    expect(isWorkEmail("jane@acme.com")).toBe(true);
  });
});
