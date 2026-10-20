import { describe, it, expect, beforeEach } from "vitest";
import { queueBqRows, getMockState, onFetch } from "../../../../tests/smoke/helpers";
import { createIcpCallbackRouter } from "../icp-callback";
import {
  composeListEmail,
} from "../../../icp/email";
import type { IcpJob } from "../../../icp/types";

const KEY = "test-icp-callback-key";

// getGmailClient needs parseable base64 credentials; the JWT itself is mocked.
const FAKE_CREDS = Buffer.from(
  JSON.stringify({ client_email: "svc@test.iam", private_key: "fake-key" }),
).toString("base64");

function invoke(
  router: ReturnType<typeof createIcpCallbackRouter>,
  body: unknown,
  authHeader = `Bearer ${KEY}`,
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify(body));
    let dataEmitted = false;
    const req: any = {
      method: "POST",
      url: "/icp-callback",
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

/** A job row as BigQuery would return it (JSON columns come back as strings). */
function jobRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    job_id: "job-1",
    status: "building",
    full_name: "Jane Smith",
    email: "jane@acme.com",
    company: "Acme",
    company_domain: "acme.com",
    company_description: "revenue cycle software for dental groups",
    industry: "Healthcare",
    icp_description: "multi-site dental groups in the Midwest",
    company_size: "51–200",
    target_titles: ["Founder / CEO"],
    dnc_suppressed: false,
    work_email: true,
    lead_score: 100,
    list_data: null,
    list_size: null,
    clay_status: null,
    ...overrides,
  };
}

const FOUND_CALLBACK = {
  job_id: "job-1",
  row_id: "job-1",
  clay_status: "found",
  rows: [
    {
      company_name: "Northside Dental Group",
      company_domain: "northsidedental.com",
      employee_count: 180,
      location: "Chicago, IL",
      contact_name: "Dana Reyes",
      contact_title: "VP Revenue Operations",
      contact_email: "dana@northsidedental.com",
      contact_linkedin: "https://linkedin.com/in/danareyes",
      signal: "Opened a third location last quarter",
    },
    {
      company_name: "Lakeshore Family Dental",
      company_domain: "lakeshorefd.com",
      employee_count: 90,
      location: "Milwaukee, WI",
      contact_name: "Sam Ortiz",
      contact_title: "Director of Growth",
      contact_email: "sam.ortiz@lakeshorefd.com",
    },
    {
      // An account Clay found but couldn't verify an email for.
      company_name: "Prairie Smiles",
      company_domain: "prairiesmiles.com",
      contact_name: "Lee Park",
      contact_title: "COO",
    },
  ],
};

/** Decode the Gmail raw message the fake recorded. */
function sentRaw(index = 0): string {
  const send = getMockState().gmail.sends[index];
  return Buffer.from(send.requestBody.raw, "base64url").toString();
}

/** Pull the CSV attachment back out of a multipart/mixed message. */
function attachedCsv(raw: string): string {
  const part = raw.split('filename="icp-list.csv"')[1];
  const b64 = part.split("\r\n\r\n")[1].split("\r\n--")[0].replace(/\r\n/g, "");
  return Buffer.from(b64, "base64").toString("utf-8");
}

describe("createIcpCallbackRouter — /webhooks/clay/icp-callback", () => {
  beforeEach(() => {
    process.env.ICP_CALLBACK_KEY = KEY;
    process.env.ICP_AUTOSEND_ENABLED = "true";
    process.env.GCP_PROJECT_ID = "test-project";
    process.env.GCP_CREDENTIALS_BASE64 = FAKE_CREDS;
    delete process.env.ICP_EMAIL_SENDER;
    delete process.env.ICP_EMAIL_BCC;
    delete process.env.ICP_LIST_BCC;
  });

  it("rejects a callback without the key", async () => {
    const router = createIcpCallbackRouter();
    const res = await invoke(router, FOUND_CALLBACK, "Bearer wrong");
    expect(res.status).toBe(401);
  });

  it("rejects a malformed payload", async () => {
    const router = createIcpCallbackRouter();
    const res = await invoke(router, { job_id: "job-1" });
    expect(res.status).toBe(400);
  });

  it("404s an unknown job without crashing", async () => {
    // getJob SELECT returns no rows.
    const router = createIcpCallbackRouter();
    const res = await invoke(router, FOUND_CALLBACK);
    expect(res.status).toBe(404);
    expect(res.json.error).toBe("unknown_job");
  });

  it("emails the requester a CSV of the people found, from Maggie, with her copied", async () => {
    queueBqRows([jobRow()]);
    const router = createIcpCallbackRouter();
    const res = await invoke(router, FOUND_CALLBACK);

    expect(res.status).toBe(200);
    expect(res.json.status).toBe("done");

    expect(getMockState().gmail.sends.length).toBe(1);
    const raw = sentRaw();
    expect(raw).toContain("To: jane@acme.com");
    expect(raw).toContain("From: Blue Modern Advisory <maggie@bluemodernadvisory.com>");
    expect(raw).toContain("Bcc: maggie@bluemodernadvisory.com");
    expect(raw).toContain("Subject: Your BMA ICP List is Ready");
    expect(raw).toContain("multipart/mixed");

    const csv = attachedCsv(raw);
    expect(csv).toContain('"Name","Title","Company"');
    expect(csv).toContain('"Dana Reyes","VP Revenue Operations","Northside Dental Group"');
    // Emails are masked in the free sample, in the CSV and the body alike.
    expect(csv).toContain('"d***@northsidedental.com"');
    expect(csv).toContain('"s***@lakeshorefd.com"');
    expect(csv).not.toContain("dana@northsidedental.com");
    expect(raw).not.toContain("dana@northsidedental.com");
    // No verified email, no place in the list.
    expect(csv).not.toContain("Lee Park");

    const writes = getMockState().bq.writes;
    // claim → stamp the list email → keep the people as leads
    expect(writes.length).toBe(3);
    expect(writes[0].sql).toContain("processed_at IS NULL");
    expect(writes[0].params.status).toBe("done");
    // Everything Clay returned is kept on the job for review.
    expect(writes[0].params.listSize).toBe(3);
    expect(writes[1].sql).toContain("list_emailed_at");
    expect(writes[1].params.messageId).toBe("msg_123");
  });

  it("keeps the people found as tagged leads without touching existing contacts", async () => {
    queueBqRows([jobRow()]);
    const router = createIcpCallbackRouter();
    await invoke(router, FOUND_CALLBACK);

    const merge = getMockState().bq.writes[2];
    expect(merge.sql).toContain("togari_structured_contacts");
    expect(merge.sql).toContain("WHEN NOT MATCHED THEN INSERT");
    expect(merge.sql).not.toContain("WHEN MATCHED");
    expect(merge.sql).toContain("'website-icp-sourced'");
    // The live table is snake_case; camelCase columns fail at runtime.
    expect(merge.sql).toContain("work_email");
    expect(merge.sql).toContain("current_title");
    expect(merge.sql).not.toMatch(/\bworkEmail\b|\bfullName\b|\bcurrentCompany\b/);
    expect(merge.params.contacts).toHaveLength(2);
    expect(merge.params.contacts[0].email).toBe("dana@northsidedental.com");
    const detail = JSON.parse(merge.params.contacts[0].detail);
    expect(detail.sourced_for_job).toBe("job-1");
    expect(detail.requested_by).toBe("jane@acme.com");
    expect(detail.title).toBe("VP Revenue Operations");
  });

  it("sends at most 10 people, each with a distinct email", async () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({
      company_name: `Dental Group ${i}`,
      contact_name: `Person ${i}`,
      contact_email: `person${i}@group${i}.com`,
    }));
    rows.splice(1, 0, { company_name: "Dupe", contact_name: "Dupe", contact_email: "PERSON0@group0.com" });
    queueBqRows([jobRow()]);
    const router = createIcpCallbackRouter();
    await invoke(router, { ...FOUND_CALLBACK, rows });

    const csv = attachedCsv(sentRaw());
    const dataLines = csv.trim().split("\r\n").slice(1);
    expect(dataLines).toHaveLength(10);
    expect(csv).not.toContain("Dupe");
    expect(getMockState().bq.writes[2].params.contacts).toHaveLength(10);
  });

  it("pings us internally when a list goes out", async () => {
    process.env.SLACK_WEBSITE_NOTIFY_WEBHOOK = "https://hooks.slack.test/icp";
    onFetch("hooks.slack.test", () => ({ ok: true }));
    queueBqRows([jobRow()]);
    const router = createIcpCallbackRouter();
    await invoke(router, FOUND_CALLBACK);
    await new Promise((r) => setTimeout(r, 10));

    const ping = getMockState().fetch.calls.find((c: any) =>
      c.url.includes("hooks.slack.test"),
    );
    expect(ping).toBeTruthy();
    expect(JSON.parse(ping.init.body).text).toContain("ICP form submitted, list sent* to Jane Smith at Acme (jane@acme.com)");
    delete process.env.SLACK_WEBSITE_NOTIFY_WEBHOOK;
  });

  it("still sends the list when Clay finishes after the stall alert", async () => {
    queueBqRows([jobRow({ status: "stalled" })]);
    const router = createIcpCallbackRouter();
    const res = await invoke(router, FOUND_CALLBACK);
    expect(res.status).toBe(200);
    expect(res.json.status).toBe("done");
    expect(getMockState().gmail.sends.length).toBe(1);
    expect(sentRaw()).toContain("Subject: Your BMA ICP List is Ready");
  });

  it("still sends a list that arrives after the give-up alert", async () => {
    queueBqRows([jobRow({ status: "timed_out" })]);
    const router = createIcpCallbackRouter();
    const res = await invoke(router, FOUND_CALLBACK);
    expect(res.json.status).toBe("done");
    expect(getMockState().gmail.sends.length).toBe(1);
  });

  it("treats a duplicate callback as already_processed and never re-sends", async () => {
    queueBqRows([jobRow({ status: "done" })]);
    const router = createIcpCallbackRouter();
    const res = await invoke(router, FOUND_CALLBACK);

    expect(res.status).toBe(200);
    expect(res.json.status).toBe("already_processed");
    expect(getMockState().gmail.sends.length).toBe(0);
    // Only the duplicate-counter UPDATE ran.
    const writes = getMockState().bq.writes;
    expect(writes.length).toBe(1);
    expect(writes[0].sql).toContain("callback_count");
  });

  it("emails nothing and tells Slack to reach out when nobody came back with a verified email", async () => {
    process.env.SLACK_WEBSITE_NOTIFY_WEBHOOK = "https://hooks.slack.test/x";
    queueBqRows([jobRow()]);
    const router = createIcpCallbackRouter();
    const res = await invoke(router, {
      ...FOUND_CALLBACK,
      rows: [FOUND_CALLBACK.rows[2]],
    });

    expect(res.status).toBe(200);
    expect(res.json.status).toBe("no_matches");
    expect(getMockState().gmail.sends.length).toBe(0);
    // Only the claim; no email to stamp and no leads to keep.
    const writes = getMockState().bq.writes;
    expect(writes.length).toBe(1);
    expect(writes.some((w: any) => w.sql.includes("MERGE"))).toBe(false);
    const ping = getMockState().fetch.calls.find((c: any) => c.url.includes("hooks.slack.test"));
    expect(JSON.parse(ping.init.body).text).toContain("Reach out personally");
    delete process.env.SLACK_WEBSITE_NOTIFY_WEBHOOK;
  });

  it("emails nothing when Clay reports nothing found", async () => {
    queueBqRows([jobRow()]);
    const router = createIcpCallbackRouter();
    const res = await invoke(router, {
      job_id: "job-1",
      row_id: "job-1",
      clay_status: "not_found",
      rows: [],
    });

    expect(res.status).toBe(200);
    expect(res.json.status).toBe("no_matches");
    expect(getMockState().gmail.sends.length).toBe(0);
  });

  it("holds the list when autosend is off, but still keeps the leads", async () => {
    process.env.ICP_AUTOSEND_ENABLED = "false";
    queueBqRows([jobRow()]);
    const router = createIcpCallbackRouter();
    const res = await invoke(router, FOUND_CALLBACK);

    expect(res.json.status).toBe("done_unsent");
    expect(getMockState().gmail.sends.length).toBe(0);
    const writes = getMockState().bq.writes;
    expect(writes[1].params.status).toBe("done_unsent");
    expect(writes[2].sql).toContain("MERGE");
  });

  it("marks the job failed when the list email can't be sent", async () => {
    delete process.env.GCP_CREDENTIALS_BASE64;
    delete process.env.GOOGLE_CREDENTIALS_BASE64;
    queueBqRows([jobRow()]);
    const router = createIcpCallbackRouter();
    const res = await invoke(router, FOUND_CALLBACK);

    expect(res.status).toBe(200);
    expect(res.json.status).toBe("failed");
    const writes = getMockState().bq.writes;
    expect(writes[1].params.status).toBe("failed");
    expect(writes[1].params.error).toBe("list email send failed");
  });

  it("accepts nulls for fields Clay couldn't fill", async () => {
    queueBqRows([jobRow()]);
    const router = createIcpCallbackRouter();
    const res = await invoke(router, {
      ...FOUND_CALLBACK,
      rows: [
        {
          ...FOUND_CALLBACK.rows[0],
          employee_count: null,
          location: null,
          contact_linkedin: null,
          signal: null,
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.json.status).toBe("done");
    const csv = attachedCsv(sentRaw());
    expect(csv).toContain('"Dana Reyes","VP Revenue Operations","Northside Dental Group","northsidedental.com","d***@northsidedental.com","","",""');
  });

  it("accepts the whole payload sent as a JSON-encoded string", async () => {
    queueBqRows([jobRow()]);
    const router = createIcpCallbackRouter();
    const res = await invoke(router, JSON.stringify(FOUND_CALLBACK));

    expect(res.status).toBe(200);
    expect(res.json.status).toBe("done");
  });

  it("rejects a string body that isn't JSON", async () => {
    const router = createIcpCallbackRouter();
    const res = await invoke(router, "not json at all");
    expect(res.status).toBe(400);
  });

  it("accepts rows sent as a JSON string (Clay formula columns)", async () => {
    queueBqRows([jobRow()]);
    const router = createIcpCallbackRouter();
    const res = await invoke(router, {
      job_id: "job-1",
      row_id: "job-1",
      clay_status: "found",
      rows: JSON.stringify([FOUND_CALLBACK.rows[0]]),
    });

    expect(res.status).toBe(200);
    expect(res.json.status).toBe("done");
    expect(getMockState().bq.writes[0].params.listSize).toBe(1);
  });
});

const CTX = {
  job_id: "job-1",
  full_name: "Jane Smith",
  email: "jane@acme.com",
  industry: "Healthcare",
  icp_description: "multi-site dental groups in the Midwest",
  company_size: "51–200",
  target_titles: ["Founder / CEO"],
};

function noEmDashes(email: { subject: string; textBody: string; htmlBody: string }) {
  expect(email.subject).not.toContain("—");
  expect(email.textBody).not.toContain("—");
  expect(email.htmlBody).not.toContain("—");
}

describe("composeListEmail", () => {
  const contacts = [
    {
      name: "Dana Reyes",
      title: "VP Revenue Operations",
      company: "Northside Dental Group",
      company_domain: "northsidedental.com",
      email: "dana@northsidedental.com",
      linkedin: "https://www.linkedin.com/in/danareyes",
      location: "Chicago, IL",
      employee_count: "180",
    },
  ];

  it("hides work emails but links LinkedIn, and signs off as the company", () => {
    const email = composeListEmail(CTX, contacts);
    expect(email.htmlBody).toContain("d***@northsidedental.com");
    expect(email.htmlBody).not.toContain("dana@northsidedental.com");
    expect(email.htmlBody).toContain('href="https://www.linkedin.com/in/danareyes"');
    expect(email.htmlBody).not.toContain("Maggie");
    // Logo top right of the header; the sign-off is the site link itself.
    expect(email.htmlBody).toContain('src="https://www.bluemodernadvisory.com/bmaicon.png"');
    expect(email.htmlBody).toContain('<a href="https://www.bluemodernadvisory.com" style="color:#1f4e73;text-decoration:none">Blue Modern Advisory</a>');
    expect(email.textBody).not.toContain("Maggie");
  });

  it("falls back gracefully with no name", () => {
    expect(composeListEmail({ ...CTX, full_name: null }, contacts).textBody).toContain("Hi there,");
  });

  it("previews the people, plays the brief back, and attaches the CSV", () => {
    const email = composeListEmail(CTX, contacts);
    expect(email.subject).toBe("Your BMA ICP List is Ready");
    expect(email.textBody).toContain("Dana Reyes, VP Revenue Operations, Northside Dental Group");
    expect(email.textBody).toContain("multi-site dental groups in the Midwest");
    expect(email.textBody).toContain("just reply to this email");
    expect(email.attachment.filename).toBe("icp-list.csv");
    expect(String(email.attachment.content)).toContain("d***@northsidedental.com");
    expect(String(email.attachment.content)).not.toContain("dana@northsidedental.com");
    expect(email.htmlBody).not.toContain("calendly.com");
    noEmDashes(email);
  });
});
