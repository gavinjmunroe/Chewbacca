/**
 * Send the deck: an upload in the modal becomes a Togari link, a pasted link
 * is used as is, and either way the reply goes back through Clay carrying it.
 * 2026-10-09: three investors asked for decks in week one and each waited on
 * Jonah sending it by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saved: any[] = [];
vi.mock("../../../replies/decks", async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    getDeck: vi.fn(async () => null),
    saveDeck: vi.fn(async (...a: any[]) => {
      saved.push(["link", ...a]);
    }),
    saveDeckFile: vi.fn(async (...a: any[]) => {
      saved.push(["file", ...a]);
      return "https://togari.test/d/abc";
    }),
  };
});

import { handleDeckModalSubmit, DECK_MODAL_CALLBACK } from "../slack-actions";

const CLAY = "https://api.clay.com/v3/sources/webhook/test-zeutara-hook";
let posts: Array<{ url: string; body: any }>;
vi.mock("../../../integrations/clay/campaign-read", () => ({
  thread: async () => [
    { messageId: "inbound", type: "REPLY", time: "2026-10-14T18:00:00Z" },
    ...posts
      .filter((p) => p.url === CLAY)
      .map((p, i) => ({
        messageId: `sent-${i}`,
        type: "SENT",
        from: "jonah@zeutaraventures.com",
        subject: "Re: Qube",
        time: "2026-10-14T19:00:00Z",
        body: p.body.email_body || p.body.body || p.body.reply_body,
      })),
  ],
}));
vi.mock("../../../replies/conversation-cycle", () => ({
  scheduleConversationFollowup: async () => {},
}));
vi.mock("../../../replies/vantage-outbox", () => ({
  retainVantageReceipt: async (client: string, to: string, sent: any) => {
    const vantage = await import("../../../replies/vantage");
    if (vantage.vantageEnabled(client))
      await vantage.vantageLogSent({
        to_email: to,
        from_email: sent.from,
        subject: sent.subject,
        text: sent.body,
        sent_at: sent.time,
      });
  },
}));

function submit(values: any, user = "U0C7RCPJPM5") {
  return handleDeckModalSubmit({
    type: "view_submission",
    user: { id: user, username: "jonah" },
    view: {
      callback_id: DECK_MODAL_CALLBACK,
      private_metadata: JSON.stringify({
        clientId: "zeutara",
        company: "Qube",
        leadEmail: "gary@example.test",
        leadName: "Gary Z",
        campaignName: "Zeutara | Qube | Seed",
        channel: "C1",
        message_ts: "1.2",
        draftSubject: "Re: Qube",
        leadId: 11,
        campaignId: 22,
        sendVia: "clay",
      }),
      state: { values },
    },
  });
}

const body = {
  body_block: {
    body_input: {
      value: "Hi Gary,\n\nHere's the Qube deck: DECK_LINK\n\nJonah",
    },
  },
};

beforeEach(() => {
  saved.length = 0;
  posts = [];
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.REPLYBOT_ZEUTARA_CLAY_REPLY_URL = CLAY;
  vi.stubGlobal("fetch", (url: any, init?: any) => {
    posts.push({
      url: String(url),
      body: init?.body ? JSON.parse(init.body) : null,
    });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      text: async () => "{}",
    } as any);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.REPLYBOT_ZEUTARA_CLAY_REPLY_URL;
});

// Ryan, 2026-10-13: check Vantage "before it answers anyone and tell it what
// it sent after". The card path goes through sendReplyEmail like autopilot.
describe("send the deck, with Vantage on", () => {
  const VANTAGE =
    "https://vantage.zeutara.com/api/webhooks/clay-creature/togari";
  beforeEach(() => {
    process.env.VANTAGE_CREATURE_TOKEN = "t";
  });
  afterEach(() => {
    delete process.env.VANTAGE_CREATURE_TOKEN;
  });
  const pasted = {
    ...body,
    deck_url_block: { deck_url: { value: "https://docsend.com/view/q" } },
  };

  it("refuses a link Vantage didn't give, and sends nothing", async () => {
    const r = await submit(pasted);
    expect(r.response_action).toBe("errors");
    expect(posts.some((p) => p.url === `${VANTAGE}/context`)).toBe(true);
    expect(posts.some((p) => p.url === CLAY)).toBe(false);
  });

  it("sends Vantage's own link, then logs the send to Vantage", async () => {
    vi.stubGlobal("fetch", (url: any, init?: any) => {
      posts.push({
        url: String(url),
        body: init?.body ? JSON.parse(init.body) : null,
      });
      const data = String(url).endsWith("/context")
        ? { deck_url: "https://docsend.com/view/q", times: [], never_use: [] }
        : { ok: true };
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => data,
        text: async () => "{}",
        body: { cancel: async () => undefined },
        headers: new Headers(),
      } as any);
    });
    const r = await submit(pasted);
    expect(r).toEqual({ response_action: "clear" });
    const order = posts
      .map((p) => p.url)
      .filter((u) => u === CLAY || u.startsWith(VANTAGE));
    expect(order).toEqual([`${VANTAGE}/context`, CLAY, `${VANTAGE}/sent`]);
    expect(posts.find((p) => p.url === `${VANTAGE}/sent`)!.body).toMatchObject({
      to_email: "gary@example.test",
    });
  });
});

describe("send the deck", () => {
  // 2026-10-13: every uploaded deck's /d/ link 404ed and four investors got
  // one. An upload, or a pasted old /d/ link, must send nothing.
  it("refuses an upload or an old Togari /d/ link, and sends nothing", async () => {
    for (const values of [
      {
        ...body,
        deck_file_block: {
          deck_file: { files: [{ id: "F1", name: "Qube.pdf" }] },
        },
      },
      {
        ...body,
        deck_url_block: {
          deck_url: {
            value:
              "https://togari-bma-prod.up.railway.app/d/88cc0602c87bac5ff1340b4ce4e9a347",
          },
        },
      },
    ]) {
      const r = await submit(values);
      expect(r.response_action).toBe("errors");
    }
    expect(saved).toHaveLength(0);
    expect(posts.some((p) => p.url === CLAY)).toBe(false);
  });

  it("uses a pasted link when there is no upload", async () => {
    await submit({
      ...body,
      deck_url_block: { deck_url: { value: "https://docsend.com/view/q" } },
    });
    expect(saved[0].slice(0, 4)).toEqual([
      "link",
      "zeutara",
      "Qube",
      "https://docsend.com/view/q",
    ]);
    expect(posts.find((p) => p.url === CLAY)!.body.body).toContain(
      "https://docsend.com/view/q",
    );
  });

  it("refuses with neither, and sends nothing", async () => {
    const r = await submit(body);
    expect(r.response_action).toBe("errors");
    expect(posts.some((p) => p.url === CLAY)).toBe(false);
  });

  it("refuses anyone but the approver", async () => {
    const r = await submit(
      {
        ...body,
        deck_url_block: { deck_url: { value: "https://docsend.com/view/q" } },
      },
      "UMAGGIE",
    );
    expect(r.response_action).toBe("errors");
    expect(saved).toHaveLength(0);
    expect(posts.some((p) => p.url === CLAY)).toBe(false);
  });
});
