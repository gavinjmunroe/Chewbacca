import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-10-13: the Clay feeder had delivered 36 of 91 repliers. The poller
// reads the inbox itself, and must never hand Togari a reply twice.
const replies: any[] = [];
const threads: Record<string, any[]> = {};
const already = new Set<string>();
vi.mock("../../integrations/cl" + "ay/campaign-read", () => ({
  inboxReplies: async () => replies,
  thread: async (_c: string, _w: string, cam: number, lead: number) =>
    threads[`${cam}:${lead}`] || [],
}));
// The poller's own handed-over record lives in BigQuery; here it is a Set.
const handed = new Set<string>();
vi.mock("../../bigquery/client", () => ({
  BigQueryClient: class {
    async executeQuery(_sql: string, p: any) {
      return {
        rows: handed.has(`${p.from}|${p.lastReply}`) ? [{ hit: 1 }] : [],
      };
    }
    async executeWrite(_sql: string, p: any) {
      handed.add(`${p.from}|${p.lastReply}`);
      return {};
    }
  },
}));
vi.mock("../store", () => ({
  hasReplyFromSince: async (_c: string, from: string) => already.has(from),
  pendingResults: async () => [],
  reconcileResultState: async () => {},
}));

import { pollClient } from "../inbox-poller";

const client = {
  clientId: "zeutara",
  live: { clayWorkspaceId: "1", campaignPrefix: "Zeutara |" },
} as any;
const NOW = Date.parse("2026-10-14T07:00:00Z");
const posts: any[] = [];

function reply(
  email: string,
  lastSent: string,
  lastReply: string,
  category = 0,
  campaign = "Zeutara | Qube Finance | Seed",
) {
  const id = replies.length + 1;
  replies.push({
    leadEmail: email,
    campaignName: campaign,
    emailCampaignId: id,
    emailLeadId: id,
    lastSent,
    lastReply,
    category,
  });
  threads[`${id}:${id}`] = [
    {
      type: "SENT",
      from: "jonah@zeutara.info",
      messageId: `<sent-${id}@x>`,
      subject: "Question",
      body: "Hi",
      time: lastSent,
    },
    {
      type: "REPLY",
      from: email,
      messageId: `<r-${id}@y>`,
      subject: "RE: Question",
      body: "Send the deck please",
      time: lastReply,
    },
  ];
}

beforeEach(() => {
  replies.length = 0;
  posts.length = 0;
  already.clear();
  handed.clear();
  process.env.REPLIES_INGEST_TOKEN = "t";
  vi.stubGlobal("fetch", async (url: string, init: any) => {
    posts.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 201 } as any;
  });
});

describe("inbox poller", () => {
  it("hands Togari a fresh reply it never saw, keyed on our email's message id", async () => {
    reply("a@fund.vc", "2026-10-13T18:00:00Z", "2026-10-13T19:00:00Z");
    const r = await pollClient(client, { now: NOW });
    expect(r.posted).toBe(1);
    expect(posts[0].body).toMatchObject({
      row_id: "<r-1@y>",
      from: "a@fund.vc",
      lead_id: 1,
      campaign_id: 1,
      client_id: "zeutara",
      body: "Send the deck please",
    });
  });

  it("skips a reply Togari already holds, from any source", async () => {
    reply("a@fund.vc", "2026-10-13T18:00:00Z", "2026-10-13T19:00:00Z");
    already.add("a@fund.vc");
    expect((await pollClient(client, { now: NOW })).posted).toBe(0);
  });

  // 2026-10-14: Togari deleted Teresa's handled "No" and the next poll handed
  // it over again. A reply goes over once, whatever happens to its row.
  it("never hands the same reply over twice, even after Togari deletes the row", async () => {
    reply("teresa@sp.com", "2026-10-13T18:00:00Z", "2026-10-13T19:13:30Z");
    expect((await pollClient(client, { now: NOW })).posted).toBe(1);
    expect((await pollClient(client, { now: NOW })).posted).toBe(0);
  });

  it("skips a thread we already answered", async () => {
    reply("a@fund.vc", "2026-10-13T20:00:00Z", "2026-10-13T19:00:00Z");
    expect((await pollClient(client, { now: NOW })).posted).toBe(0);
  });

  it("leaves old settled auto-replies alone but still takes an old open question", async () => {
    reply("ooo@fund.vc", "2026-10-01T18:00:00Z", "2026-10-02T19:00:00Z", 6);
    reply("q@fund.vc", "2026-10-01T18:00:00Z", "2026-10-02T19:00:00Z", 2);
    const r = await pollClient(client, { now: NOW });
    expect(posts.map((p) => p.body.from)).toEqual(["q@fund.vc"]);
    expect(r.posted).toBe(1);
  });

  it("ignores other clients' campaigns, and a dry run sends nothing", async () => {
    reply(
      "x@fund.vc",
      "2026-10-13T18:00:00Z",
      "2026-10-13T19:00:00Z",
      0,
      "Serif | Something",
    );
    reply("a@fund.vc", "2026-10-13T18:00:00Z", "2026-10-13T19:00:00Z");
    const r = await pollClient(client, { now: NOW, dryRun: true });
    expect(r.would.map((w) => w.from)).toEqual(["a@fund.vc"]);
    expect(posts).toHaveLength(0);
  });

  // Switching Serif on (2026-10-16) must not post its old open replies as cards.
  it("hands over nothing from before the client's pollSince", async () => {
    reply("old@payer.org", "2026-10-01T18:00:00Z", "2026-10-02T19:00:00Z", 2);
    reply("new@payer.org", "2026-10-13T18:00:00Z", "2026-10-13T19:00:00Z");
    const serif = {
      clientId: "serif",
      clay: {
        workspaceId: "2",
        pollReplies: true,
        pollSince: "2026-10-10T00:00:00Z",
      },
    } as any;
    const r = await pollClient(serif, { now: NOW });
    expect(posts.map((p) => p.body.from)).toEqual(["new@payer.org"]);
    expect(posts[0].body.client_id).toBe("serif");
    expect(r.posted).toBe(1);
  });

  // BMA, 2026-10-16: Claude drafts its cards, so replies go to its own webhook.
  it("posts to the client's replybot webhook with its key when intake is replybot", async () => {
    reply("cto@acme.com", "2026-10-13T18:00:00Z", "2026-10-13T19:00:00Z", 0, "BMA | Voice AI");
    process.env.REPLYBOT_BMA_WEBHOOK_SECRET = "k";
    const bma = {
      clientId: "bma",
      webhookSecretEnv: "REPLYBOT_BMA_WEBHOOK_SECRET",
      clay: { workspaceId: "3", campaignPrefix: "BMA |", pollReplies: true, intake: "replybot" },
    } as any;
    const calls: any[] = [];
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return { ok: true, status: 200 } as any;
    });
    expect((await pollClient(bma, { now: NOW })).posted).toBe(1);
    expect(calls[0].url).toMatch(/\/replybot\/bma\/webhook$/);
    expect(calls[0].headers["x-replybot-key"]).toBe("k");
    expect(calls[0].body).toMatchObject({
      to_email: "cto@acme.com",
      campaign_name: "BMA | Voice AI",
      text: "Send the deck please",
      original_outbound: "Hi",
      campaign_id: 1,
      lead_id: 1,
    });
  });
});
