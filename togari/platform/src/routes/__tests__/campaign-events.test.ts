import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getMockState } from "../../../tests/smoke/helpers";
import { createCampaignEventsRouter } from "../campaign-events";

const TOKEN = "test-campaign-events-token";
const PREV = process.env.CAMPAIGN_EVENTS_TOKEN;
afterAll(() => {
  process.env.CAMPAIGN_EVENTS_TOKEN = PREV;
});

const EVENT = {
  event_id: "row_1",
  client_id: "serif",
  event_type: "Email Sent",
  campaign_id: "907",
  campaign_name: "Payer data | Health systems",
  lead_email: "cfo@examplehealth.com",
  occurred_at: "2026-10-13T14:02:00Z",
};

/** POST one body through the router, the way replies.test.ts does. */
function post(
  body: unknown,
  auth: string | null = `Bearer ${TOKEN}`,
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify(body));
    let sent = false;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "content-length": String(raw.length),
    };
    if (auth) headers.authorization = auth;
    const req: any = {
      method: "POST",
      url: "/",
      headers,
      socket: { remoteAddress: "127.0.0.1" },
      header(name: string) {
        return this.headers[name.toLowerCase()];
      },
      on(event: string, cb: (chunk?: any) => void) {
        if (event === "data" && !sent) {
          sent = true;
          cb(raw);
        }
        if (event === "end") cb();
        return this;
      },
      once() { return this; },
      removeListener() { return this; },
      pipe() { return this; },
      unpipe() { return this; },
      resume() { return this; },
      setEncoding() { return this; },
    };
    let status = 200;
    const res: any = {
      headersSent: false,
      status(code: number) { status = code; return this; },
      set() { return this; },
      setHeader() { return this; },
      getHeader() { return undefined; },
      json(payload: any) { resolve({ status, json: payload }); return this; },
      end() { resolve({ status, json: undefined }); return this; },
    };
    (createCampaignEventsRouter() as any).handle(req, res, (err: unknown) =>
      err ? reject(err) : resolve({ status, json: undefined }),
    );
  });
}

const inserts = () =>
  getMockState().bq.inserts.filter((i: any) => i.table === "campaign_events");

describe("POST /campaign-events", () => {
  beforeEach(() => {
    process.env.CAMPAIGN_EVENTS_TOKEN = TOKEN;
  });

  it("refuses a request without the token", async () => {
    expect((await post(EVENT, null)).status).toBe(401);
    expect((await post(EVENT, "Bearer wrong")).status).toBe(401);
    expect(inserts()).toHaveLength(0);
  });

  it("refuses everything when no token is configured", async () => {
    delete process.env.CAMPAIGN_EVENTS_TOKEN;
    expect((await post(EVENT)).status).toBe(500);
  });

  it("streams a send in, keyed on the event so Clay's retries collapse", async () => {
    const res = await post(EVENT);
    expect(res.status).toBe(201);
    expect(inserts()).toHaveLength(1);
    const [row] = inserts()[0].rows;
    expect(row.insertId).toBe("serif:row_1");
    expect(row.json).toMatchObject({
      client_id: "serif",
      event_type: "sent",
      campaign_id: "907",
    });
  });

  it("stores a reply's outcome and never its text", async () => {
    const res = await post({
      ...EVENT,
      event_id: "row_2",
      event_type: "Reply Received",
      reply_text: "Please remove me from your list, my inbox is full.",
    });
    expect(res.status).toBe(201);
    const { json } = inserts()[0].rows[0];
    expect(json.outcome).toBe("opt_out");
    expect(JSON.stringify(json)).not.toContain("inbox is full");
  });

  it("answers 200 for an open, so Clay doesn't retry it, and stores nothing", async () => {
    const res = await post({ ...EVENT, event_type: "Email Opened" });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ stored: false, reason: "not_counted" });
    expect(inserts()).toHaveLength(0);
  });

  it("skips Clay's placeholder rows so they never draw a bar", async () => {
    const res = await post({ ...EVENT, lead_email: "alex@example.com", campaign_name: "Example campaign" });
    expect(res.json).toEqual({ stored: false, reason: "sample_row" });
    const status = await post({
      ...EVENT,
      event_type: "CAMPAIGN_STATUS_CHANGED",
      lead_email: "",
      campaign_id: "123456",
      campaign_name: "Example campaign",
    });
    expect(status.json).toEqual({ stored: false, reason: "sample_row" });
    expect(inserts()).toHaveLength(0);
  });

  it("refuses a client it doesn't know, or one without a calendar", async () => {
    expect((await post({ ...EVENT, client_id: "nobody" })).json.error).toBe(
      "unknown_client_id",
    );
    expect((await post({ ...EVENT, client_id: "amber" })).json.error).toBe(
      "no_campaign_calendar",
    );
    expect(inserts()).toHaveLength(0);
  });

  it("refuses a row with no event id", async () => {
    const res = await post({ ...EVENT, event_id: "" });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_payload");
  });
});
