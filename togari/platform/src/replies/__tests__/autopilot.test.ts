import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writes: Array<{ sql: string; params: Record<string, unknown> }> = [];
let queryRows: Array<Record<string, unknown>> = [];
let history: Array<Record<string, unknown>> = [];
let humanActions: Array<Record<string, unknown>> = [];
let humanLookupFails = false;
vi.mock("../../integrations/cl" + "ay/campaign-read", () => ({
  thread: async () =>
    history.map((message) => ({ messageId: "inbound", ...message })),
}));
vi.mock("../../bigquery/client", () => ({
  BigQueryClient: class {
    async executeWrite(sql: string, params: Record<string, unknown>) {
      writes.push({ sql, params });
      return { success: true, numDmlAffectedRows: "1" };
    }
    async executeQuery(sql: string) {
      if (sql.includes("reply_card_actions")) {
        if (humanLookupFails)
          throw new Error("warehouse temporarily unavailable");
        return { rows: humanActions };
      }
      return { rows: queryRows, totalRows: queryRows.length };
    }
  },
}));
const gmailSends: any[] = [];
vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: class {} },
    gmail: () => ({
      users: {
        messages: {
          send: async (r: any) => {
            gmailSends.push(r);
            return { data: { id: "g1" } };
          },
        },
      },
    }),
  },
}));

import {
  followUpDue,
  inSendWindow,
  returnDate,
  runAutopilot,
  sweepFollowups,
} from "../autopilot";
import { ReplyPreflightError } from "../delivery";
import * as clients from "../../agents/replybot/client-config";

const FORWARD = "https://clay.test/forward";
const BLOCK = "https://clay.test/block";
let hooks: Array<{ url: string; body: any }> = [];

beforeEach(() => {
  delete process.env.REPLYBOT_ZEUTARA_NATIVE_CONTINUATION;
  delete process.env.VANTAGE_CREATURE_TOKEN;
  hooks = [];
  writes.length = 0;
  gmailSends.length = 0;
  queryRows = [];
  history = [];
  humanActions = [];
  humanLookupFails = false;
  process.env.REPLYBOT_ZEUTARA_CLAY_FORWARD_URL = FORWARD;
  process.env.REPLYBOT_ZEUTARA_CLAY_BLOCKLIST_URL = BLOCK;
  process.env.GCP_CREDENTIALS_BASE64 = Buffer.from(
    JSON.stringify({ client_email: "sa@x", private_key: "k" }),
  ).toString("base64");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any) => {
      hooks.push({ url, body: JSON.parse(init.body) });
      return new Response('{"success":true}', { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.VANTAGE_CREATURE_TOKEN;
  vi.unstubAllGlobals();
});

const base = {
  row_id: "r1",
  from: "partner@fund.vc",
  sender_account: "jonah@zeutaramedia.info",
  campaign: "Zeutara | Ivy | Pre-seed investors | Jonah list",
  lead_id: 7001,
  campaign_id: 42,
  lead_name: "Priya Nair",
  received_at: "2026-10-06T18:00:00Z",
};

describe("server autopilot", () => {
  it.each([
    "Please send all correspondence to my new email address: p@newfund.vc",
    "I've left. Please contact colleague@newfund.vc",
  ])(
    "retains an unvalidated Zeutara forward as a handoff when Vantage is enabled",
    async (body) => {
      process.env.VANTAGE_CREATURE_TOKEN = "test-token";
      const result = await runAutopilot({ ...base, body }, "zeutara");
      expect(result.outcome).toBe("handoff");
      expect(["new_address", "referral"]).toContain(result.kind);
      expect(hooks).toEqual([]);
      expect(result.forwardedTo).toBeUndefined();
    },
  );
  it("keeps failed forwarding delivery open for repair without sending", async () => {
    const result = await runAutopilot(
      {
        ...base,
        body: "Delivery failure: Your message wasn't delivered to referral@fund.com",
      },
      "zeutara",
    );
    expect(result).toEqual({ outcome: "handoff", kind: "delivery_failure" });
    expect(hooks).toEqual([]);
    expect(gmailSends).toEqual([]);
  });
  it("blocklists an unsubscribe and never drafts it", async () => {
    const r = await runAutopilot(
      { ...base, body: "Please unsubscribe" } as any,
      "zeutara",
    );
    expect(r.outcome).toBe("handled");
    expect(hooks).toEqual([{ url: BLOCK, body: { email: "partner@fund.vc" } }]);
  });

  it("forwards the thread to a new address from the same lead", async () => {
    const r = await runAutopilot(
      {
        ...base,
        body: "Please send all correspondence to my new email address: p@newfund.vc",
      } as any,
      "zeutara",
    );
    expect(r.outcome).toBe("handled");
    expect(hooks[0].url).toBe(FORWARD);
    expect(hooks[0].body).toMatchObject({
      campaign_id: "42",
      lead_id: "7001",
      to_email: "p@newfund.vc",
    });
  });

  it("leaves a reply naming too many people for a person", async () => {
    const many = Array.from({ length: 6 }, (_, i) => `p${i}@fund.vc`).join(
      ", ",
    );
    const r = await runAutopilot(
      { ...base, body: `I've left. Please contact ${many}` } as any,
      "zeutara",
    );
    expect(r.outcome).toBe("continue");
    expect(hooks).toHaveLength(0);
  });

  it("schedules one follow-up for an out-of-office, two business days after the return", async () => {
    const r = await runAutopilot(
      {
        ...base,
        body: "I am out of the office until Thursday, October 15th.",
      } as any,
      "zeutara",
    );
    expect(r.outcome).toBe("handled");
    const insert = writes.find((w) => w.sql.includes("INSERT INTO"));
    expect(insert?.params.dueAt).toBe("2026-10-19T14:00:00.000Z");
  });

  it("logs a pass without sending anything", async () => {
    const r = await runAutopilot(
      { ...base, body: "Not a fit for us. Good luck." } as any,
      "zeutara",
    );
    expect(r.outcome).toBe("handled");
    expect(hooks).toHaveLength(0);
  });

  it("does not turn a funding condition into an out-of-office schedule", async () => {
    const result = await runAutopilot(
      {
        ...base,
        body: "Happy to chat once they identify a lead, until then I have to pass",
      } as any,
      "zeutara",
    );
    expect(result.outcome).toBe("continue");
    expect(writes.some((w) => w.sql.includes("INSERT INTO"))).toBe(false);
  });

  it("sends a question on to Perplexity", async () => {
    const r = await runAutopilot(
      { ...base, body: "What is their LTM revenue?" } as any,
      "zeutara",
    );
    expect(r.outcome).toBe("continue");
  });

  it("copies a Qube reply to Jonah from Blue Modern, whatever kind it is", async () => {
    await runAutopilot(
      {
        ...base,
        campaign: "Zeutara | Qube Finance | Seed investors",
        body: "Not a fit for us.",
      } as any,
      "zeutara",
    );
    expect(gmailSends).toHaveLength(1);
    const raw = Buffer.from(
      gmailSends[0].requestBody.raw,
      "base64url",
    ).toString();
    expect(raw).toContain("To: jonah@zeutara.com");
    expect(raw).toContain("From: Caleb Newton <caleb@bluemodernadvisory.com>");
  });

  it("does nothing at all for a client without an autopilot", async () => {
    const r = await runAutopilot(
      { ...base, body: "Please unsubscribe" } as any,
      "zeutara_test",
    );
    expect(r.outcome).toBe("continue");
    expect(hooks).toHaveLength(0);
  });
});

describe("dates", () => {
  const replied = new Date("2026-10-06T18:00:00Z");
  it("reads US, German and French return dates and week counts", () => {
    expect(
      returnDate("back Tuesday 10/27", replied).toISOString().slice(0, 10),
    ).toBe("2026-10-27");
    expect(
      returnDate("Ab Montag, 12.10.2026 bin ich wieder im Büro", replied)
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-10-12");
    expect(
      returnDate("Je suis absent du 03/10 au 10/10", replied)
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-10-10");
    expect(
      returnDate("traveling for next 3 weeks", replied)
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-10-27");
  });
  it("skips the weekend counting business days", () => {
    expect(followUpDue(new Date("2026-10-09T12:00:00Z")).toISOString()).toBe(
      "2026-10-13T14:00:00.000Z",
    );
  });
  it("only sends on weekday mornings Pacific", () => {
    expect(inSendWindow(new Date("2026-10-09T15:00:00Z"))).toBe(true); // Fri 8am PT
    expect(inSendWindow(new Date("2026-10-09T22:00:00Z"))).toBe(false); // Fri 3pm PT
    expect(inSendWindow(new Date("2026-10-10T15:00:00Z"))).toBe(false); // Sat
  });
});

describe("follow-up sweep", () => {
  it.each([
    ["scheduled", false],
    ["retry_1", false],
    ["retry_2", false],
    ["scheduled", true],
  ] as const)(
    "routes Zeutara cycle work from %s with native continuation enabled=%s",
    async (status, enabled) => {
      if (enabled) process.env.REPLYBOT_ZEUTARA_NATIVE_CONTINUATION = "1";
      history = [
        {
          type: "REPLY",
          time: "2026-10-05T18:00:00Z",
          body: "What is their revenue?",
        },
        {
          type: "SENT",
          time: "2026-10-06T17:00:00Z",
          body: "I'll confirm the details.",
        },
      ];
      queryRows = [
        {
          id: "cycle:1:current",
          client_id: "zeutara",
          status,
          lead_id: 7001,
          campaign_id: 42,
          lead_email: "person@example.com",
          thread_id: "prior-send",
          created_at: "2026-10-06T18:00:00Z",
        },
      ];
      const send = vi.fn(async () => {
        if (!enabled) await fetch(FORWARD, { method: "POST", body: "{}" });
      });
      expect(await sweepFollowups(send, new Date("2026-10-09T15:00:00Z"))).toBe(
        enabled ? 1 : 0,
      );
      if (enabled) {
        expect(send).toHaveBeenCalledOnce();
        expect(writes.at(-1)?.sql).toContain("status = 'sent'");
        expect(hooks).toEqual([]);
        return;
      }
      expect(send).not.toHaveBeenCalled();
      expect(hooks).toEqual([]);
      expect(writes.at(-1)?.sql).toContain("status = 'handoff_required'");
      expect(writes.at(-1)?.params.id).toBe("cycle:1:current");
      expect(
        writes.some(
          (write) =>
            write.sql.includes("SET status = @status") &&
            (write.params.status === "delivery_unknown" ||
              String(write.params.status).startsWith("retry_")),
        ),
      ).toBe(false);
    },
  );
  it.each(["newer pass", "human closure"])(
    "cancels Zeutara cycle work after %s before transport containment",
    async (reason) => {
      history = [
        {
          type: "REPLY",
          time: "2026-10-05T18:00:00Z",
          body: "What is their revenue?",
        },
        {
          type: "SENT",
          time: "2026-10-06T17:00:00Z",
          body: "I'll confirm the details.",
        },
      ];
      if (reason === "newer pass")
        history.push({
          type: "REPLY",
          time: "2026-10-08T18:00:00Z",
          body: "Not a fit for us.",
        });
      else humanActions = [{ reply_thread_id: "inbound" }];
      queryRows = [
        {
          id: "cycle:1:closed",
          client_id: "zeutara",
          status: "scheduled",
          lead_id: 7001,
          campaign_id: 42,
          lead_email: "person@example.com",
          created_at: "2026-10-06T18:00:00Z",
        },
      ];
      const send = vi.fn(async () => {});
      expect(await sweepFollowups(send, new Date("2026-10-09T15:00:00Z"))).toBe(
        0,
      );
      expect(send).not.toHaveBeenCalled();
      expect(writes.at(-1)?.sql).toContain("status = 'cancelled'");
      expect(
        writes.some((write) =>
          write.sql.includes("status = 'handoff_required'"),
        ),
      ).toBe(false);
    },
  );
  it("preserves another client's cycle transport", async () => {
    const other = {
      ...clients.getReplybotClient("zeutara")!,
      clientId: "other-client",
      live: undefined,
    };
    vi.spyOn(clients, "getReplybotClient").mockReturnValue(other);
    queryRows = [
      {
        id: "cycle:1:other",
        client_id: "other-client",
        status: "scheduled",
        lead_id: 1,
        campaign_id: 2,
        lead_email: "person@example.com",
      },
    ];
    const send = vi.fn(async () => {});
    expect(await sweepFollowups(send, new Date("2026-10-09T15:00:00Z"))).toBe(
      1,
    );
    expect(send).toHaveBeenCalledOnce();
    expect(writes.at(-1)?.sql).toContain("status = 'sent'");
  });
  it("retries a failed human-decision lookup and sends after the lookup recovers", async () => {
    history = [
      {
        type: "REPLY",
        time: "2026-10-05T18:00:00Z",
        body: "I am out of the office until October 6",
      },
    ];
    queryRows = [
      {
        id: "zeutara:r1",
        client_id: "zeutara",
        lead_id: 7001,
        campaign_id: 42,
        lead_email: "person@example.com",
        status: "scheduled",
        created_at: "2026-10-06T18:00:00Z",
      },
    ];
    const send = vi.fn();
    humanLookupFails = true;
    expect(await sweepFollowups(send, new Date("2026-10-09T15:00:00Z"))).toBe(
      0,
    );
    expect(send).not.toHaveBeenCalled();
    expect(writes.at(-1)?.params.status).toBe("retry_1");
    queryRows[0].status = "retry_1";
    humanLookupFails = false;
    expect(await sweepFollowups(send, new Date("2026-10-09T15:00:00Z"))).toBe(
      1,
    );
    expect(send).toHaveBeenCalledOnce();
  });
  it("cancels a due nudge after a human skip instead of retrying it", async () => {
    history = [
      {
        type: "REPLY",
        time: "2026-10-05T18:00:00Z",
        body: "I am out of the office until October 6",
      },
    ];
    humanActions = [{ reply_thread_id: "inbound" }];
    queryRows = [
      {
        id: "zeutara:r1",
        client_id: "zeutara",
        lead_id: 7001,
        campaign_id: 42,
        lead_email: "person@example.com",
        status: "scheduled",
        created_at: "2026-10-06T18:00:00Z",
      },
    ];
    const send = vi.fn();
    expect(await sweepFollowups(send, new Date("2026-10-09T15:00:00Z"))).toBe(
      0,
    );
    expect(send).not.toHaveBeenCalled();
    expect(writes.at(-1)?.sql).toContain("status = 'cancelled'");
  });
  it("retries a proven pre-send failure but holds ambiguous delivery", async () => {
    history = [
      {
        type: "REPLY",
        time: "2026-10-05T18:00:00Z",
        body: "I am out of the office until October 6",
      },
    ];
    queryRows = [
      {
        id: "zeutara:r1",
        client_id: "zeutara",
        lead_id: 7001,
        campaign_id: 42,
        lead_email: "person@example.com",
        status: "scheduled",
        created_at: "2026-10-06T18:00:00Z",
      },
    ];
    await sweepFollowups(async () => {
      throw new ReplyPreflightError("Context unavailable before send");
    }, new Date("2026-10-09T15:00:00Z"));
    expect(writes.at(-1)?.params.status).toBe("retry_1");
    queryRows[0].status = "retry_2";
    await sweepFollowups(async () => {
      throw new ReplyPreflightError("Still unavailable");
    }, new Date("2026-10-09T15:00:00Z"));
    expect(writes.at(-1)?.params.status).toBe("retry_exhausted");
    await sweepFollowups(async () => {
      throw new Error("Connection lost after request");
    }, new Date("2026-10-09T15:00:00Z"));
    expect(writes.at(-1)?.params.status).toBe("delivery_unknown");
  });
  it("sends a due follow-up in the thread through the Clay send and marks it sent", async () => {
    history = [
      {
        type: "REPLY",
        time: "2026-10-05T18:00:00Z",
        body: "I am out of the office until October 6",
      },
    ];
    queryRows = [
      {
        id: "zeutara:r1",
        client_id: "zeutara",
        lead_id: 7001,
        campaign_id: 42,
        lead_email: "partner@fund.vc",
        lead_name: "Priya Nair",
        thread_id: "<t1>",
        created_at: "2026-10-06T18:00:00Z",
      },
    ];
    const sent: any[] = [];
    const n = await sweepFollowups(async (_c, msg) => {
      sent.push(msg);
    }, new Date("2026-10-09T15:00:00Z"));
    expect(n).toBe(1);
    expect(sent[0]).toMatchObject({
      to: "partner@fund.vc",
      leadId: 7001,
      campaignId: 42,
      sendVia: "clay",
    });
    expect(sent[0].body).toContain("Hi Priya");
    expect(writes.some((w) => w.sql.includes("status = 'sent'"))).toBe(true);
  });

  it("sends nothing outside the morning window", async () => {
    queryRows = [
      {
        id: "x",
        client_id: "zeutara",
        lead_id: 1,
        campaign_id: 2,
        lead_email: "a@b.c",
        lead_name: "A",
        thread_id: null,
      },
    ];
    const n = await sweepFollowups(async () => {
      throw new Error("should not send");
    }, new Date("2026-10-09T22:00:00Z"));
    expect(n).toBe(0);
  });
});
