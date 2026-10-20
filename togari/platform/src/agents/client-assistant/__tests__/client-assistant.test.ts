/**
 * Jonah talks to Togari in #zeutara-cold-replies (2026-10-10). Questions are
 * answered from Zeutara's data only; actions run only for approvers and the team.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: any[] = [];
// The link check really fetches; here a docsend.com link opens and nothing else does.
vi.mock("../../../replies/auto-send", async (orig) => {
  const real = (await orig()) as any;
  return {
    ...real,
    linkProblem: (b: string) =>
      real.linkProblem(b, async (u: string) =>
        u.startsWith("https://docsend.com/"),
      ),
  };
});
vi.mock("../../smartlead-responder/slack-actions", () => ({
  sendReplyEmail: vi.fn(async (_c: any, m: any) => {
    sent.push(m);
  }),
}));
vi.mock("../../../transports/slack/installations", () => ({
  slackBotTokenFor: vi.fn(async () => "xoxb-test"),
}));
vi.mock("../../../replies/decks", async (orig) => ({
  ...((await orig()) as any),
  getDeck: vi.fn(async () => "https://docsend.com/view/qube"),
  saveDeck: vi.fn(async () => undefined),
}));
const queries: any[] = [];
let parkedRows: any[] = [];
const writes: any[] = [];
const pending = new Map<string, any>();
vi.mock("../../../bigquery/client", () => ({
  BigQueryClient: class {
    async executeQuery(sql: string, params: any) {
      queries.push({ sql, params });
      if (/FROM .*assistant_pending/.test(sql)) {
        const r = pending.get(params.pid);
        return { rows: r ? [r] : [] };
      }
      if (/FROM .*reply_followups/.test(sql) && /waiting_on_principal/.test(sql))
        return /COUNT\(\*\)/.test(sql)
          ? { rows: [{ n: parkedRows.length }] }
          : { rows: parkedRows.map((r) => ({ ...r })) };
      if (/FROM .*reply_items/.test(sql))
        return {
          rows: [
            {
              row_id: "r1",
              from_address: "gary.zimmerman@sixtreesventures.com",
              lead_name: "Gary Zimmerman",
              lead_company: "Six Trees",
              campaign: "Zeutara | Qube Finance | Seed",
              subject: "Re: Qube",
              body: "Do you have a deck?",
              email_thread_id: "<t1>",
              lead_id: 11,
              campaign_id: 22,
              category: null,
            },
          ],
        };
      return { rows: [] };
    }
    async executeWrite(sql: string, params: any) {
      writes.push({ sql, params });
      if (/INSERT INTO .*assistant_pending/.test(sql))
        pending.set(params.pid, {
          id: params.pid,
          client_id: params.cid,
          tool: params.tool,
          input: params.input,
          status: "pending",
          created_at: new Date().toISOString(),
        });
      if (/UPDATE .*assistant_pending/.test(sql) && pending.has(params.pid)) {
        const r = pending.get(params.pid);
        if (/status = 'pending'/.test(sql)) {
          if (r.status !== "pending") return { numDmlAffectedRows: "0" };
          r.status = params.st;
          return { numDmlAffectedRows: "1" };
        }
        r.status = "done";
      }
      return { numDmlAffectedRows: "1" };
    }
  },
}));

import {
  handleAssistantAction,
  handleClientMention,
  handleClientMessage,
} from "..";
import {
  clientForSlack,
  getReplybotClient,
} from "../../replybot/client-config";

let claudeTurns: any[];
let slackPosts: any[];
beforeEach(() => {
  sent.length = 0;
  queries.length = 0;
  writes.length = 0;
  parkedRows = [];
  slackPosts = [];
  process.env.ANTHROPIC_API_KEY = "test";
  vi.stubGlobal("fetch", async (url: any, init?: any) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    if (u.includes("api.anthropic.com")) {
      const next = claudeTurns.shift() || {
        content: [{ type: "text", text: "Done." }],
      };
      (next as any).__tools = body.tools?.map((t: any) => t.name);
      lastTools = body.tools?.map((t: any) => t.name) || [];
      lastSystem = body.system || "";
      lastMessages = JSON.stringify(body.messages || []);
      return { ok: true, json: async () => next } as any;
    }
    if (u.includes("conversations.replies"))
      return {
        ok: true,
        json: async () => ({ ok: true, messages: threadMessages }),
      } as any;
    if (u.includes("users.lookupByEmail"))
      return {
        ok: true,
        json: async () => ({ ok: true, user: { id: "UCALEB" } }),
      } as any;
    slackPosts.push({ url: u, body });
    return {
      ok: true,
      json: async () => ({ ok: true, ts: "2.2", channel: { id: "D1" } }),
    } as any;
  });
});
afterEach(() => vi.unstubAllGlobals());
let lastTools: string[] = [];
let lastSystem = "";
let lastMessages = "";
let threadMessages: any[] = [];

const zeutara = () => getReplybotClient("zeutara")!;
const ev = (user: string, text: string) => ({
  user,
  channel: "C0C7RGTR7J8",
  ts: "1.1",
  text: `<@UTOGARI> ${text}`,
});

describe("client assistant", () => {
  it("routes the client channel and the client to their own assistant", () => {
    expect(clientForSlack("C0C7RGTR7J8")?.clientId).toBe("zeutara");
    expect(clientForSlack("CSOMEWHERE", "U0C7RCPJPM5")?.clientId).toBe(
      "zeutara",
    );
    expect(clientForSlack("CSOMEWHERE", "URANDOM")).toBeNull();
  });

  it("proposes the deck send as a card, and sends only when Jonah taps Do it", async () => {
    claudeTurns = [
      {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "send_deck",
            input: { who: "Gary Zimmerman" },
          },
        ],
      },
      {
        content: [
          {
            type: "text",
            text: "Tap Do it to send Gary the Qube Finance deck.",
          },
        ],
      },
    ];
    await handleClientMention(
      zeutara(),
      ev("U0C7RCPJPM5", "send Gary the Qube deck"),
    );
    expect(sent).toHaveLength(0);
    const card = slackPosts.find(
      (p) => p.url.includes("chat.postMessage") && p.body.blocks,
    );
    expect(JSON.stringify(card.body.blocks)).toContain(
      "gary.zimmerman@sixtreesventures.com",
    );
    expect(JSON.stringify(card.body.blocks)).toContain(
      "https://docsend.com/view/qube",
    );
    const pid = card.body.blocks[1].elements[0].value;
    // Someone else taps it: nothing.
    await handleAssistantAction({
      actions: [{ action_id: "assistant_confirm", value: pid }],
      user: { id: "USTRANGER" },
      channel: { id: "C0C7RGTR7J8" },
      message: { ts: "2.2" },
    });
    expect(sent).toHaveLength(0);
    await handleAssistantAction({
      actions: [{ action_id: "assistant_confirm", value: pid }],
      user: { id: "U0C7RCPJPM5" },
      channel: { id: "C0C7RGTR7J8" },
      message: { ts: "2.2" },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("gary.zimmerman@sixtreesventures.com");
    expect(sent[0].body).toContain("https://docsend.com/view/qube");
    // A second tap does nothing.
    await handleAssistantAction({
      actions: [{ action_id: "assistant_confirm", value: pid }],
      user: { id: "U0C7RCPJPM5" },
      channel: { id: "C0C7RGTR7J8" },
      message: { ts: "2.2" },
    });
    expect(sent).toHaveLength(1);
  });

  it("ignores a tap from a different message, and refuses a reply too long to show in full", async () => {
    claudeTurns = [
      {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "send_deck",
            input: { who: "Gary Zimmerman" },
          },
        ],
      },
      { content: [{ type: "text", text: "Tap Do it." }] },
    ];
    await handleClientMention(
      zeutara(),
      ev("U0C7RCPJPM5", "send Gary the deck"),
    );
    const card = slackPosts.find(
      (p) => p.url.includes("chat.postMessage") && p.body.blocks,
    );
    const pid = card.body.blocks[1].elements[0].value;
    await handleAssistantAction({
      actions: [{ action_id: "assistant_confirm", value: pid }],
      user: { id: "U0C7RCPJPM5" },
      channel: { id: "C0C7RGTR7J8" },
      message: { ts: "9.9" },
    });
    expect(sent).toHaveLength(0);

    slackPosts = [];
    claudeTurns = [
      {
        content: [
          {
            type: "tool_use",
            id: "t2",
            name: "reply_to_investor",
            input: { who: "Gary Zimmerman", body: "x".repeat(3000) },
          },
        ],
      },
      { content: [{ type: "text", text: "Too long." }] },
    ];
    await handleClientMention(zeutara(), ev("U0C7RCPJPM5", "reply to Gary"));
    expect(slackPosts.some((p) => p.body.blocks)).toBe(false);
  });

  // 2026-10-13: four investors got a dead Togari /d/ deck link.
  it("never proposes a deck send whose link does not open", async () => {
    const decks = await import("../../../replies/decks");
    (decks.getDeck as any).mockResolvedValueOnce(
      "https://togari-bma-prod.up.railway.app/d/88cc0602c87bac5ff1340b4ce4e9a347",
    );
    claudeTurns = [
      {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "send_deck",
            input: { who: "Gary Zimmerman" },
          },
        ],
      },
      { content: [{ type: "text", text: "That link is dead." }] },
    ];
    await handleClientMention(
      zeutara(),
      ev("U0C7RCPJPM5", "send Gary the Qube deck"),
    );
    expect(slackPosts.some((p) => p.body.blocks)).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("scopes every query to the client", async () => {
    claudeTurns = [
      {
        content: [
          { type: "tool_use", id: "t1", name: "list_replies", input: {} },
        ],
      },
      { content: [{ type: "text", text: "Gary asked for the deck." }] },
    ];
    await handleClientMention(zeutara(), ev("U0C7RCPJPM5", "who replied?"));
    expect(queries.length).toBeGreaterThan(0);
    // The schema read checks a column exists and holds no client data.
    for (const q of queries.filter((q) => !/INFORMATION_SCHEMA/.test(q.sql)))
      expect(q.params.id ?? q.params.clientId).toBe("zeutara");
  });

  it("turns an action a reply asked for into a card nobody has tapped, never an act", async () => {
    claudeTurns = [
      {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "blocklist",
            input: { email: "jonah@zeutara.com" },
          },
        ],
      },
      { content: [{ type: "text", text: "Gary asked for the deck." }] },
    ];
    process.env.REPLYBOT_ZEUTARA_CLAY_BLOCKLIST_URL =
      "https://clay.test/blocklist";
    await handleClientMention(
      zeutara(),
      ev("U0C7RCPJPM5", "what did Gary say?"),
    );
    expect(slackPosts.some((p) => p.url.includes("clay.test"))).toBe(false);
    delete process.env.REPLYBOT_ZEUTARA_CLAY_BLOCKLIST_URL;
  });

  it("saves a deck link only after a tap", async () => {
    claudeTurns = [
      {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "save_deck",
            input: { company: "Qube Finance", link: "https://evil.test/deck" },
          },
        ],
      },
      { content: [{ type: "text", text: "ok" }] },
    ];
    const decks = await import("../../../replies/decks");
    (decks.saveDeck as any).mockClear();
    await handleClientMention(
      zeutara(),
      ev("U0C7RCPJPM5", "what did Gary say?"),
    );
    expect((decks.saveDeck as any).mock.calls).toHaveLength(0);
  });

  it("never offers actions to someone who is not an approver or the team", async () => {
    claudeTurns = [
      {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "send_deck",
            input: { who: "Gary" },
          },
        ],
      },
      { content: [{ type: "text", text: "I cannot do that." }] },
    ];
    await handleClientMention(zeutara(), ev("USTRANGER", "send Gary the deck"));
    expect(lastTools).not.toContain("send_deck");
    expect(sent).toHaveLength(0);
  });
});

// Move 4 (2026-10-13): the brief and the principal's name come from the
// registry. Zeutara's brief is the exact text that lived in this file before.
describe("client assistant reads the client from the registry", () => {
  it("keeps Zeutara's brief byte for byte", async () => {
    const { clientBrief } = await import("..");
    const { createHash } = await import("crypto");
    const brief = clientBrief("zeutara");
    expect(createHash("sha256").update(brief).digest("hex")).toBe(
      "5e035e62c6006ed558a17a1ac48e30f02b6c52b50cc3bea3440ba1af46a19e17",
    );
    expect(zeutara().brief).toBe(brief);
  });

  it("writes in the client's own principal's voice", async () => {
    const { actTools } = await import("..");
    const voiceOf = (c: any) =>
      actTools(c).find((t: any) => t.name === "reply_to_investor")!.description;
    expect(voiceOf(zeutara())).toContain("in Jonah's voice when asked to");
    const pat = {
      ...zeutara(),
      clientId: "harborline",
      replyCopy: { principal: "Pat", clientName: "Harborline" },
    };
    expect(voiceOf(pat)).toContain("in Pat's voice when asked to");
    expect(voiceOf(pat)).not.toContain("Jonah");
    const none = { ...zeutara(), clientId: "other", replyCopy: undefined };
    expect(voiceOf(none)).not.toContain("Jonah");
    expect(clientForSlackNoBrief()).toBe("");
  });
});

function clientForSlackNoBrief() {
  // A client with no brief field gets an empty brief, never Zeutara's.
  return getReplybotClient("serif")?.brief ?? "";
}

// 2026-10-17: the repair loop parked follow-ups for Jonah and tagged him, but
// nothing read his answer back. Now the assistant knows every parked row, turns
// his one-line answer into a card, and the tap clears the row.
describe("answers Jonah gives to replies Togari is holding", () => {
  const tap = (pid: string) =>
    handleAssistantAction({
      actions: [{ action_id: "assistant_confirm", value: pid }],
      user: { id: "U0C7RCPJPM5" },
      channel: { id: "C0C7RGTR7J8" },
      message: { ts: "2.2" },
    });
  const cardPid = () => {
    const card = slackPosts.find(
      (p) => p.url.includes("chat.postMessage") && p.body.blocks,
    );
    return card?.body.blocks[1].elements[0].value as string | undefined;
  };

  it("tells the model what is waiting, and a tapped reply clears the parked row", async () => {
    parkedRows = [
      {
        lead_name: "Gary Zimmerman",
        lead_email: "gary.zimmerman@sixtreesventures.com",
        need: "booking_slots",
        need_text: "He asked for times next week.",
      },
    ];
    claudeTurns = [
      {
        content: [
          { type: "tool_use", id: "t0", name: "waiting_on_you", input: {} },
        ],
      },
      {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "reply_to_investor",
            input: {
              who: "Gary Zimmerman",
              body: "Hi Gary, Tuesday at 2pm or Wednesday at 10am Eastern both work. Which is better?\n\nJonah",
            },
          },
        ],
      },
      { content: [{ type: "text", text: "Tap Do it to send Gary the times." }] },
    ];
    await handleClientMention(
      zeutara(),
      ev("U0C7RCPJPM5", "gary tue 2 or wed 10 eastern"),
    );
    // The system prompt carries only the count; the rows come back as a
    // tool result, the channel investor text always uses.
    expect(lastSystem).toContain("holding 1 reply");
    expect(lastSystem).not.toContain("sixtreesventures");
    expect(lastMessages).toContain("gary.zimmerman@sixtreesventures.com");
    expect(lastMessages).toContain("booking_slots");
    expect(sent).toHaveLength(0);
    await tap(cardPid()!);
    expect(sent).toHaveLength(1);
    const unpark = writes.find((w) =>
      /UPDATE .*reply_followups.*SET status = 'sent'/s.test(w.sql),
    );
    expect(unpark?.params).toEqual({
      id: "zeutara",
      email: "gary.zimmerman@sixtreesventures.com",
    });
  });

  it("never proposes a drafted answer that still has a placeholder", async () => {
    claudeTurns = [
      {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "reply_to_investor",
            input: { who: "Gary Zimmerman", body: "Hi Gary, [NEED: times] works for us.\n\nJonah" },
          },
        ],
      },
      { content: [{ type: "text", text: "Which times?" }] },
    ];
    await handleClientMention(zeutara(), ev("U0C7RCPJPM5", "answer gary"));
    expect(cardPid()).toBeUndefined();
  });

  it("closes a reply handled outside email only after a tap", async () => {
    claudeTurns = [
      {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "mark_handled",
            input: { who: "Gary Zimmerman", how: "Filled in his intake form" },
          },
        ],
      },
      { content: [{ type: "text", text: "Tap Do it to close Gary." }] },
    ];
    await handleClientMention(
      zeutara(),
      ev("U0C7RCPJPM5", "I filled out gary's form"),
    );
    const closed = () =>
      writes.filter((w) => /INSERT INTO .*reply_card_actions/.test(w.sql));
    expect(closed()).toHaveLength(0);
    await tap(cardPid()!);
    expect(sent).toHaveLength(0);
    expect(closed()).toHaveLength(1);
    expect(closed()[0].params).toMatchObject({
      clientId: "zeutara",
      lead: "gary.zimmerman@sixtreesventures.com",
      action: "done",
      inReplyTo: "<t1>",
    });
  });
});

// Caleb, 2026-10-17: "Jonah and Ryan shouldn't have to @ Togari to talk to
// togari". A small model decides whether a plain message is for Togari.
describe("plain messages in the client channel", () => {
  const plain = (text: string, thread_ts?: string) => ({
    user: "U0C7RCPJPM5",
    channel: "C0C7RGTR7J8",
    ts: "3.3",
    thread_ts,
    text,
  });
  const yes = { content: [{ type: "text", text: "yes" }] };
  const no = { content: [{ type: "text", text: "no" }] };

  it("answers a reply under Togari's held-reply post, with that post as context", async () => {
    threadMessages = [
      {
        ts: "1.0",
        bot_id: "B1",
        text: "Jonah, Togari is holding its follow-up to Gary Zimmerman until you send times you can meet.",
      },
    ];
    claudeTurns = [
      yes,
      {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "reply_to_investor",
            input: {
              who: "Gary Zimmerman",
              body: "Hi Gary, Tuesday at 2pm Eastern works. Does that suit you?\n\nJonah",
            },
          },
        ],
      },
      { content: [{ type: "text", text: "Tap Do it." }] },
    ];
    await handleClientMessage(zeutara(), plain("tue 2pm eastern", "1.0"), "UTOGARI");
    expect(lastMessages).toContain("holding its follow-up to Gary");
    expect(slackPosts.some((p) => p.body.blocks)).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("stays quiet when people are talking to each other", async () => {
    threadMessages = [];
    claudeTurns = [no];
    await handleClientMessage(zeutara(), plain("Ryan, call at 3?"), "UTOGARI");
    expect(claudeTurns).toHaveLength(0);
    expect(slackPosts.filter((p) => p.url.includes("chat.postMessage"))).toHaveLength(0);
  });

  it("leaves an @Togari message to the mention event, so it never answers twice", async () => {
    claudeTurns = [yes];
    await handleClientMessage(zeutara(), plain("<@UTOGARI> who replied?"), "UTOGARI");
    expect(claudeTurns).toHaveLength(1);
    expect(slackPosts).toHaveLength(0);
  });
});
