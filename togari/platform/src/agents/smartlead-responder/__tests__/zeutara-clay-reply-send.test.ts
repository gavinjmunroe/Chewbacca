/**
 * Zeutara's investor replies are drafted on Zeutara's own Perplexity seat and
 * sent back through Clay from whichever of Jonah's mailboxes the investor
 * wrote to. Mechanically the Serif route (see clay-reply-send.test.ts); these
 * cover what is different about Zeutara:
 *
 *  - Clay is the only send method. There is no Gmail grant on zeutara.com, so
 *    a card missing its campaign keys must refuse, not fall back.
 *  - The voice bans em dashes, and the drafts come from Perplexity, not
 *    Claude. The ban used to apply only to Claude drafts.
 *  - Cards post in #zeutara-cold-replies in our workspace with our token. They used
 *    to live in Zeutara's own workspace, so the test keeps that install around
 *    and checks its token is never used.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import { processSmartleadWebhook } from "../index";
import { handleSmartleadSlackAction, sendReplyEmail } from "../slack-actions";
import { getReplybotClient } from "../../replybot/client-config";
import { perplexityAccountForClient } from "../../../perplexity/config";
import { buildTaskMessage } from "../../../perplexity/task-message";
import type { ReplyItemRow } from "../../../replies/store";
import { ReplyPreflightError } from "../../../replies/delivery";
import {
  getMockState,
  queueBqWriteAffected,
} from "../../../../tests/smoke/helpers";
import {
  __resetMasterKeyCacheForTests,
  __setSecretsBackendForTests,
  type SecretsBackend,
} from "../../../secrets/tenantSecrets";
import {
  _resetSlackInstallationCache,
  saveSlackInstallation,
} from "../../../transports/slack/installations";

const ZEUTARA_URL = "https://api.clay.com/v3/sources/webhook/test-zeutara-hook";
const NATIVE_URL =
  "https://api.clay.com/v3/workspaces/1372623/clay-sequencer/master-inbox/reply";
const SERIF_URL = "https://api.clay.com/v3/sources/webhook/test-serif-hook";
const HOME_TOKEN = "xoxb-home";
const ZEUTARA_TOKEN = "xoxb-zeutara-workspace";

let calls: Array<{ url: string; token?: string; body: any }>;
let latestInboundTime: string;
let latestInboundId = "inbound";
let latestInboundBody = "";
let blankProviderBody = false;
vi.mock("../../../integrations/clay/campaign-read", () => ({
  ContinuationRefused: class ContinuationRefused extends Error {},
  replyInThread: async (
    _tenant: string,
    _workspace: string,
    _campaign: number,
    _lead: number,
    parent: string,
    to: string,
    body: string,
  ) => {
    calls.push({ url: NATIVE_URL, body: { body, parent, to } });
  },
  thread: async () => [
    {
      messageId: latestInboundId,
      type: "REPLY",
      time: latestInboundTime,
      body: latestInboundBody,
    },
    ...calls
      .filter((c) => c.url === ZEUTARA_URL || c.url === NATIVE_URL)
      .map((c, i) => ({
        messageId: `sent-${i}`,
        type: "SENT",
        from: "jonah+campaign@zeutaraventures.com",
        time: i === 0 ? "2026-10-14T19:00:00Z" : "2026-10-14T21:00:00Z",
        subject: "Re: Question",
        body: blankProviderBody
          ? ""
          : c.body.email_body || c.body.body || c.body.reply_body,
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

function jsonOk(body: any = { ok: true, ts: "1700000000.000100" }) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as any);
}

/** tenant_secrets in memory, so the workspace install can be stored and read. */
function memoryBackend(): SecretsBackend {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    async query({ query, params = {} }) {
      const key = `${params.tenant_id}|${params.key_name}`;
      if (query.trim().toUpperCase().startsWith("SELECT")) {
        const row = rows.get(key);
        return [row ? [row] : []];
      }
      rows.set(key, { ...params });
      return [[]];
    },
  };
}

beforeEach(async () => {
  delete process.env.REPLYBOT_ZEUTARA_NATIVE_CONTINUATION;
  calls = [];
  latestInboundTime = "2026-10-14T18:00:00Z";
  latestInboundId = "inbound";
  latestInboundBody = "";
  blankProviderBody = false;
  process.env.SLACK_BOT_TOKEN = HOME_TOKEN;
  process.env.REPLYBOT_ZEUTARA_CLAY_REPLY_URL = ZEUTARA_URL;
  process.env.REPLYBOT_SERIF_CLAY_REPLY_URL = SERIF_URL;

  vi.stubGlobal("fetch", (url: any, init?: any) => {
    const u = String(url);
    let parsed: any = {};
    try {
      parsed = init?.body ? JSON.parse(init.body) : {};
    } catch {
      parsed = { raw: init?.body };
    }
    const auth = init?.headers?.Authorization as string | undefined;
    calls.push({ url: u, token: auth?.replace(/^Bearer /, ""), body: parsed });
    if (u.endsWith("/togari/context"))
      return jsonOk({ deck_url: null, times: [], never_use: [] });
    return jsonOk();
  });

  process.env.TENANT_SECRETS_MASTER_KEY = crypto
    .randomBytes(32)
    .toString("hex");
  __resetMasterKeyCacheForTests();
  __setSecretsBackendForTests(memoryBackend());
  _resetSlackInstallationCache();
  await saveSlackInstallation({
    // Zeutara's own workspace, where its cards used to post. Kept installed so
    // the tests prove the live client no longer reaches for that token.
    teamId: "T0C08A77X2T",
    teamName: "Zeutara",
    enterpriseId: null,
    appId: "A123",
    botToken: ZEUTARA_TOKEN,
    botUserId: "UBOT",
    scope: "chat:write",
    installerUserId: null,
    clientId: "zeutara",
    installedAt: "2026-10-05T00:00:00.000Z",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __setSecretsBackendForTests(null);
  _resetSlackInstallationCache();
  delete process.env.REPLYBOT_ZEUTARA_CLAY_REPLY_URL;
  delete process.env.REPLYBOT_SERIF_CLAY_REPLY_URL;
  delete process.env.ZEUTARA_REPLY_GUIDE_URL;
  delete process.env.VANTAGE_CREATURE_TOKEN;
});

async function stubObservedVantage(verdict: "NOT_A_FIT" | null = null) {
  process.env.VANTAGE_CREATURE_TOKEN = "test-token";
  const vantage = await import("../../../replies/vantage");
  vi.spyOn(vantage, "vantageContext").mockResolvedValue({
    deckUrl: null,
    times: [],
    neverUse: ["Example Client"],
    policy: {
      hasDeck: true,
      hasOnePager: true,
      materialDelivery: "vantage_attachments",
      timesSuit: "reply owner only",
      bookingUrl: null,
      verdict,
      answered: null,
      neverNameClient: true,
    },
  });
}

it.each(["Re: Quick chat", "Re: Tuesday October 20"])(
  "permits a neutral pass reply with inherited subject %s",
  async (subject) => {
    await stubObservedVantage("NOT_A_FIT");
    await sendReplyEmail(getReplybotClient("zeutara")!, {
      to: "partner@fund.vc",
      subject,
      body: "Thanks for letting me know.",
      leadId: 7001,
      campaignId: 42,
      sendVia: "clay",
    });
    expect(calls.filter((call) => call.url === ZEUTARA_URL)).toHaveLength(1);
  },
);

it.each(["onepager", "one pager", "one-pager", "deck", "memo", "file"])(
  "keeps a provider %s request open across direct send callers",
  async (material) => {
    await stubObservedVantage();
    latestInboundBody = `Could I see your ${material}?`;
    await expect(
      sendReplyEmail(getReplybotClient("zeutara")!, {
        to: "partner@fund.vc",
        subject: "Re: Question",
        body: "Thanks for getting back to me.",
        leadId: 7001,
        campaignId: 42,
        sendVia: "clay",
      }),
    ).rejects.toThrow("Vantage owns material");
    expect(calls.filter((call) => call.url === ZEUTARA_URL)).toHaveLength(0);
  },
);

it("still refuses prohibited subject names and actual body meeting offers", async () => {
  await stubObservedVantage("NOT_A_FIT");
  for (const msg of [
    { subject: "Re: Example Client", body: "Thanks for letting me know." },
    { subject: "Re: Question", body: "Could we have a quick chat?" },
  ])
    await expect(
      sendReplyEmail(getReplybotClient("zeutara")!, {
        ...msg,
        to: "partner@fund.vc",
        leadId: 7001,
        campaignId: 42,
        sendVia: "clay",
      }),
    ).rejects.toThrow("Not sent");
  expect(calls.filter((call) => call.url === ZEUTARA_URL)).toHaveLength(0);
});

it.each([
  "<p>Could I <strong>see</strong> your one-pager?</p>",
  "<div>Could&nbsp;I <span><b>see</b></span> your &#111;ne&#45;pager?</div>",
  "<p>Could I see your one-pager?</p><blockquote><p>Thanks, not a fit.</p></blockquote>",
])(
  "normalizes formatted provider material requests before any send: %s",
  async (body) => {
    await stubObservedVantage();
    latestInboundBody = body;
    await expect(
      sendReplyEmail(getReplybotClient("zeutara")!, {
        to: "partner@fund.vc",
        subject: "Re: Question",
        body: "Thanks for getting back to me.",
        leadId: 7001,
        campaignId: 42,
        sendVia: "clay",
      }),
    ).rejects.toThrow("Vantage owns material");
    expect(calls.filter((call) => call.url === ZEUTARA_URL)).toHaveLength(0);
  },
);

it.each([
  "<p>Thanks for letting me know.</p><blockquote><p>Could I see your one-pager?</p></blockquote>",
  '<p>Thanks for letting me know.</p><div class="gmail_quote"><p>Could I see your one-pager?</p></div>',
])(
  "does not treat quoted material history as a current request",
  async (body) => {
    await stubObservedVantage();
    latestInboundBody = body;
    await sendReplyEmail(getReplybotClient("zeutara")!, {
      to: "partner@fund.vc",
      subject: "Re: Question",
      body: "Thanks for letting me know.",
      leadId: 7001,
      campaignId: 42,
      sendVia: "clay",
    });
    expect(calls.filter((call) => call.url === ZEUTARA_URL)).toHaveLength(1);
  },
);

function buttonValue(cardBody: any, actionId: string): any {
  const actions = (cardBody.blocks || []).find(
    (b: any) => b.type === "actions",
  );
  const button = (actions?.elements || []).find(
    (e: any) => e.action_id === actionId,
  );
  return button ? JSON.parse(button.value) : null;
}

/** The payload every button on a card carries, whichever buttons it shows. */
function cardValue(cardBody: any): any {
  const actions = (cardBody.blocks || []).find(
    (b: any) => b.type === "actions",
  );
  return JSON.parse(actions.elements[0].value);
}

const JONAH = "U0C7RCPJPM5";

function lastCard() {
  return calls.filter((c) => c.url.includes("chat.postMessage")).pop();
}

async function press(
  actionId: string,
  value: any,
  channel: string,
  userId = JONAH,
) {
  await handleSmartleadSlackAction({
    user: { id: userId, username: userId === JONAH ? "jonah" : "someone" },
    channel: { id: channel },
    message: { ts: "1700000000.000100", blocks: [] },
    response_url: "https://hooks.slack.test/respond",
    actions: [{ action_id: actionId, value: JSON.stringify(value) }],
  });
}

/** What POST /replies/result hands the responder for a positive verdict. */
const VERDICT = {
  to_email: "partner@fund.vc",
  to_name: "Priya Nair",
  lead_title: "Partner",
  company_name: "Northfield Ventures",
  from_email: "jonah@zeutaraventures.com",
  subject: "Re: Question",
  campaign_name: "Vertocol - Seed",
  text: "Interesting. Can you send the deck?",
  message_id: "<inv-1@mail.fund.vc>",
  lead_id: 7001,
  campaign_id: 42,
  sentiment: "interested",
  draft_body:
    "Thanks Priya — happy to send it over.\n\nWould a call with the founder next week be useful?\n\nJonah",
  reason: "Asked for the deck.",
  upstream_classified_only: true,
};

const LIVE_CHANNEL = getReplybotClient("zeutara")!.slackChannelId;

describe("Zeutara replies route through Clay", () => {
  it.each(["0", "1"])(
    "sends an initial out-of-office follow-up natively only with native flag %s on",
    async (flag) => {
      process.env.REPLYBOT_ZEUTARA_NATIVE_CONTINUATION = flag;
      await sendReplyEmail(getReplybotClient("zeutara")!, {
        to: "partner@fund.vc",
        subject: "Re: Question",
        body: "Welcome back. Jonah",
        leadId: 7001,
        campaignId: 42,
        sendVia: "clay",
        inReplyTo: "inbound",
        followupAttempt: 0,
      });
      // 2026-10-16: the workflow route sent Akbar a blank email.
      const native = flag === "1";
      expect(calls.filter((c) => c.url === ZEUTARA_URL)).toHaveLength(
        native ? 0 : 1,
      );
      expect(calls.filter((c) => c.url === NATIVE_URL)).toHaveLength(
        native ? 1 : 0,
      );
    },
  );
  it("continues the exact sent parent through native inbox, without another workflow call", async () => {
    const message = {
      to: "partner@fund.vc",
      subject: "Re: Question",
      body: "Here is the information you requested. Jonah",
      leadId: 7001,
      campaignId: 42,
      sendVia: "clay" as const,
    };
    await sendReplyEmail(getReplybotClient("zeutara")!, message);
    process.env.REPLYBOT_ZEUTARA_NATIVE_CONTINUATION = "1";
    await sendReplyEmail(getReplybotClient("zeutara")!, {
      ...message,
      body: "Any questions about the information I sent? Jonah",
      inReplyTo: "sent-0",
      followupAttempt: 1,
    });
    expect(calls.filter((c) => c.url === ZEUTARA_URL)).toHaveLength(1);
    expect(calls.filter((c) => c.url === NATIVE_URL)).toHaveLength(1);
    expect(calls.find((c) => c.url === NATIVE_URL)?.body.parent).toBe("sent-0");
    delete process.env.REPLYBOT_ZEUTARA_NATIVE_CONTINUATION;
  });
  it("refuses an empty body before any delivery request", async () => {
    await expect(
      sendReplyEmail(getReplybotClient("zeutara")!, {
        to: "partner@fund.vc",
        subject: "Re: Question",
        body: "<p> </p>",
        leadId: 7001,
        campaignId: 42,
        sendVia: "clay",
        inReplyTo: "inbound",
      }),
    ).rejects.toBeInstanceOf(ReplyPreflightError);
    expect(
      calls.filter((c) => c.url === ZEUTARA_URL || c.url === NATIVE_URL),
    ).toHaveLength(0);
  });
  it("names a blank provider send instead of calling it pending", async () => {
    // 2026-10-16: "Reply sent successfully" for Akbar, and the SENT had no body.
    blankProviderBody = true;
    await expect(
      sendReplyEmail(getReplybotClient("zeutara")!, {
        to: "partner@fund.vc",
        subject: "Re: Question",
        body: "Welcome back. Jonah",
        leadId: 7001,
        campaignId: 42,
        sendVia: "clay",
      }),
    ).rejects.toThrow(/EMPTY email/);
  });
  it("answers an inbound natively, never through the workflow that refuses second answers", async () => {
    // 2026-10-16: Ethan Austin's question sat unanswered after the workflow
    // returned "Already replied to this lead".
    process.env.REPLYBOT_ZEUTARA_NATIVE_CONTINUATION = "1";
    await sendReplyEmail(getReplybotClient("zeutara")!, {
      to: "partner@fund.vc",
      subject: "Re: Question",
      body: "It is the Chicago dating app from my first note. Jonah",
      leadId: 7001,
      campaignId: 42,
      sendVia: "clay",
      inReplyTo: "inbound",
      requireUnanswered: true,
    });
    expect(calls.filter((c) => c.url === ZEUTARA_URL)).toHaveLength(0);
    expect(calls.filter((c) => c.url === NATIVE_URL)).toHaveLength(1);
    expect(calls.find((c) => c.url === NATIVE_URL)?.body.parent).toBe(
      "inbound",
    );
    delete process.env.REPLYBOT_ZEUTARA_NATIVE_CONTINUATION;
  });
  it("serializes overlapping manual and recovery calls before either reads history", async () => {
    queueBqWriteAffected(1);
    queueBqWriteAffected(0);
    const message = {
      to: "partner@fund.vc",
      subject: "Re: Question",
      body: "Here is the information you asked for. Jonah",
      leadId: 7001,
      campaignId: 42,
      sendVia: "clay" as const,
    };
    const outcomes = await Promise.allSettled([
      sendReplyEmail(getReplybotClient("zeutara")!, message),
      sendReplyEmail(getReplybotClient("zeutara")!, message),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    expect(calls.filter((call) => call.url === ZEUTARA_URL)).toHaveLength(1);
  });

  it("refuses an automated answer to an older inbound before delivery", async () => {
    latestInboundId = "newer-inbound";
    await expect(
      sendReplyEmail(getReplybotClient("zeutara")!, {
        to: "partner@fund.vc",
        subject: "Re: Question",
        body: "An answer to the earlier question. Jonah",
        leadId: 7001,
        campaignId: 42,
        sendVia: "clay",
        inReplyTo: "older-inbound",
        requireUnanswered: true,
      }),
    ).rejects.toThrow("latest inbound");
    expect(calls.filter((call) => call.url === ZEUTARA_URL)).toHaveLength(0);
  });
  it("rechecks follow-up ownership after a newer inbound arrives", async () => {
    const message = {
      to: "partner@fund.vc",
      subject: "Re: Question",
      body: "Here is the requested information. Jonah",
      leadId: 7001,
      campaignId: 42,
      sendVia: "clay" as const,
    };
    await sendReplyEmail(getReplybotClient("zeutara")!, message);
    latestInboundTime = "2026-10-14T20:00:00Z";
    latestInboundId = "newer-inbound";
    await expect(
      sendReplyEmail(getReplybotClient("zeutara")!, {
        ...message,
        body: "Following up on the next step. Jonah",
        inReplyTo: "sent-0",
        followupAttempt: 1,
      }),
    ).rejects.toThrow("Conversation advanced");
    expect(calls.filter((call) => call.url === ZEUTARA_URL)).toHaveLength(1);
  });
  it("refuses a stale recovery draft even when its wording differs", async () => {
    const message = {
      to: "partner@fund.vc",
      subject: "Re: Question",
      body: "Here is the information you asked for. Jonah",
      leadId: 7001,
      campaignId: 42,
      sendVia: "clay" as const,
      inReplyTo: "inbound",
    };
    await sendReplyEmail(getReplybotClient("zeutara")!, message);
    await expect(
      sendReplyEmail(getReplybotClient("zeutara")!, {
        ...message,
        body: "A different answer. Jonah",
        requireUnanswered: true,
      }),
    ).rejects.toThrow("already present");
    expect(calls.filter((call) => call.url === ZEUTARA_URL)).toHaveLength(1);
  });
  it("allows a manual fulfillment after an earlier acknowledgment", async () => {
    const message = {
      to: "partner@fund.vc",
      subject: "Re: Question",
      body: "The deck's coming, I'll send it over shortly. Jonah",
      leadId: 7001,
      campaignId: 42,
      sendVia: "clay" as const,
    };
    await sendReplyEmail(getReplybotClient("zeutara")!, message);
    await sendReplyEmail(getReplybotClient("zeutara")!, {
      ...message,
      body: "Here's the deck: https://example.com/deck.pdf Jonah",
    });
    expect(calls.filter((call) => call.url === ZEUTARA_URL)).toHaveLength(2);
  });
  it("allows the same information when the investor asks again in a newer reply", async () => {
    const message = {
      to: "partner@fund.vc",
      subject: "Re: Question",
      body: "Here is the information you asked for. Jonah",
      leadId: 7001,
      campaignId: 42,
      sendVia: "clay" as const,
    };
    await sendReplyEmail(getReplybotClient("zeutara")!, message);
    latestInboundTime = "2026-10-14T20:00:00Z";
    await sendReplyEmail(getReplybotClient("zeutara")!, message);
    expect(calls.filter((call) => call.url === ZEUTARA_URL)).toHaveLength(2);
  });
  it("refuses a second send of a reply already confirmed in the provider thread", async () => {
    const message = {
      to: "partner@fund.vc",
      subject: "Re: Question",
      body: "Here is the information you asked for. Jonah",
      leadId: 7001,
      campaignId: 42,
      sendVia: "clay" as const,
    };
    await sendReplyEmail(getReplybotClient("zeutara")!, message);
    await expect(
      sendReplyEmail(getReplybotClient("zeutara")!, message),
    ).rejects.toThrow("already present");
    expect(calls.filter((call) => call.url === ZEUTARA_URL)).toHaveLength(1);
  });
  it("joins #zeutara-cold-replies and posts again when Togari was never invited", async () => {
    let posts = 0;
    vi.stubGlobal("fetch", (url: any, init?: any) => {
      const u = String(url);
      const body = init?.body ? JSON.parse(init.body) : {};
      calls.push({
        url: u,
        token: init?.headers?.Authorization?.replace(/^Bearer /, ""),
        body,
      });
      if (
        u.includes("chat.postMessage") &&
        body.channel === "C0C7RGTR7J8" &&
        posts++ === 0
      ) {
        return jsonOk({ ok: false, error: "not_in_channel" });
      }
      return jsonOk();
    });
    await processSmartleadWebhook(VERDICT, "zeutara");
    const join = calls.find((c) => c.url.includes("conversations.join"));
    expect(join?.body.channel).toBe("C0C7RGTR7J8");
    expect(
      calls.filter(
        (c) =>
          c.url.includes("chat.postMessage") &&
          c.body.channel === "C0C7RGTR7J8",
      ),
    ).toHaveLength(2);
  });

  it("posts in #zeutara-cold-replies in our workspace, with our token", async () => {
    await processSmartleadWebhook(VERDICT, "zeutara");
    const card = lastCard()!;
    expect(card.body.channel).toBe("C0C7RGTR7J8");
    expect(card.token).toBe(HOME_TOKEN);
    expect(card.token).not.toBe(ZEUTARA_TOKEN);
  });

  it("stamps the Clay route and keys onto the card", async () => {
    await processSmartleadWebhook(VERDICT, "zeutara");
    const card = lastCard()!;

    const value = cardValue(card.body);
    expect(value.clientId).toBe("zeutara");
    expect(value.leadId).toBe(7001);
    expect(value.campaignId).toBe(42);
    expect(value.sendVia).toBe("clay");
  });

  it("uses the Perplexity draft and never calls Claude", async () => {
    await processSmartleadWebhook(VERDICT, "zeutara");
    expect(calls.some((c) => c.url.includes("api.anthropic.com"))).toBe(false);
    expect(cardValue(lastCard()!.body).draftBody).toContain(
      "happy to send it over",
    );
  });

  it("strips em dashes from the Perplexity draft", async () => {
    await processSmartleadWebhook(VERDICT, "zeutara");
    const draft = cardValue(lastCard()!.body).draftBody;
    expect(draft).not.toMatch(/[—–]/);
    expect(draft).toContain("Thanks Priya, happy to send it over.");
  });

  it("offers no Gmail draft button", async () => {
    await processSmartleadWebhook(VERDICT, "zeutara");
    expect(buttonValue(lastCard()!.body, "smartlead_draft")).toBeNull();
  });

  it("POSTs to Zeutara's Clay webhook, and never Serif's or Gmail", async () => {
    await processSmartleadWebhook(VERDICT, "zeutara");
    const value = cardValue(lastCard()!.body);

    calls = [];
    await press("smartlead_send", value, LIVE_CHANNEL);

    const clay = calls.find((c) => c.url === ZEUTARA_URL);
    expect(
      clay,
      "reply should have been handed to Zeutara's Clay hook",
    ).toBeTruthy();
    expect(clay!.body.lead_id).toBe(7001);
    expect(clay!.body.campaign_id).toBe(42);
    expect(clay!.body.email).toBe("partner@fund.vc");
    expect(clay!.body.client_id).toBe("zeutara");
    expect(clay!.body.in_reply_to).toBe("<inv-1@mail.fund.vc>");

    expect(calls.some((c) => c.url === SERIF_URL)).toBe(false);
    expect(calls.some((c) => c.url.includes("gmail.googleapis.com"))).toBe(
      false,
    );
  });

  it("posts a card for conditional later requests when automatic sending is unavailable", async () => {
    await processSmartleadWebhook(
      {
        ...VERDICT,
        text: "Happy to chat once they identify a lead, until then I have to pass",
        draft_body:
          "Thanks, I will come back when a lead investor is in place. Jonah",
        sentiment: "needs_review",
      },
      "zeutara",
      { skipAutoSend: true, throwOnError: true },
    );
    expect(lastCard()).toBeTruthy();
  });

  it("logs the actual Clay sender and receipt time to Vantage", async () => {
    process.env.VANTAGE_CREATURE_TOKEN = "test-token";
    await processSmartleadWebhook(VERDICT, "zeutara");
    const value = cardValue(lastCard()!.body);

    calls = [];
    await press("smartlead_send", value, LIVE_CHANNEL);

    const logged = calls.find((c) => c.url.endsWith("/togari/sent"));
    expect(logged?.body).toMatchObject({
      to_email: "partner@fund.vc",
      from_email: "jonah+campaign@zeutaraventures.com",
      sent_at: "2026-10-14T19:00:00Z",
    });
  });

  it("keeps confirmed delivery unresolved when Vantage logging fails", async () => {
    process.env.VANTAGE_CREATURE_TOKEN = "test-token";
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", (url: any, init?: any) => {
      if (String(url).endsWith("/togari/sent")) {
        return Promise.resolve({ ok: false, status: 503 } as Response);
      }
      return original(url, init);
    });
    await expect(
      sendReplyEmail(getReplybotClient("zeutara")!, {
        to: "partner@fund.vc",
        subject: "Re: Question",
        body: "Here is the information you requested. Jonah",
        leadId: 7001,
        campaignId: 42,
        sendVia: "clay",
      }),
    ).rejects.toThrow("Vantage log awaits recovery");
    expect(calls.filter((call) => call.url === ZEUTARA_URL)).toHaveLength(1);
  });

  it("refuses to send without the campaign keys, with no Gmail to fall back to", async () => {
    await processSmartleadWebhook(
      { ...VERDICT, lead_id: 0, campaign_id: 0 },
      "zeutara",
    );
    const value = cardValue(lastCard()!.body);

    calls = [];
    await press("smartlead_send", value, LIVE_CHANNEL);

    expect(calls.some((c) => c.url === ZEUTARA_URL)).toBe(false);
    expect(calls.some((c) => c.url.includes("gmail.googleapis.com"))).toBe(
      false,
    );
  });
});

describe("Zeutara fit review: Jonah rules on every reply first", () => {
  const responses = () =>
    calls.filter((c) => c.url === "https://hooks.slack.test/respond");
  const refusals = () =>
    calls.filter(
      (c) =>
        c.url.includes("chat.postMessage") &&
        String(c.body.text).startsWith("🚫"),
    );

  it("opens with Good fit / Not a fit and no send button", async () => {
    await processSmartleadWebhook(
      { ...VERDICT, text: "What is their LTM revenue?" },
      "zeutara",
    );
    const card = lastCard()!.body;
    expect(buttonValue(card, "replybot_fit_good")).not.toBeNull();
    expect(buttonValue(card, "replybot_fit_bad")).not.toBeNull();
    expect(buttonValue(card, "smartlead_send")).toBeNull();
    expect(buttonValue(card, "smartlead_edit_modal")).toBeNull();
  });

  it("manual-review cards get the same two buttons", async () => {
    await processSmartleadWebhook(
      { ...VERDICT, sentiment: "other", reason: "Portal submission." },
      "zeutara",
    );
    const card = lastCard()!.body;
    // A deck request leads with Send the deck instead of the fit button.
    expect(
      buttonValue(card, "replybot_fit_good") ??
        buttonValue(card, "replybot_deck"),
    ).not.toBeNull();
    expect(buttonValue(card, "smartlead_send")).toBeNull();
  });

  it("refuses a fit call from anyone but Jonah", async () => {
    await processSmartleadWebhook(VERDICT, "zeutara");
    const value = cardValue(lastCard()!.body);
    calls = [];
    await press("replybot_fit_good", value, LIVE_CHANNEL, "UMAGGIE");
    expect(responses()).toHaveLength(0);
    expect(refusals()).toHaveLength(1);
  });

  it("refuses a send from anyone but Jonah, even on an old card", async () => {
    await processSmartleadWebhook(VERDICT, "zeutara");
    const value = cardValue(lastCard()!.body);
    calls = [];
    await press("smartlead_send", value, LIVE_CHANNEL, "UMAGGIE");
    expect(calls.some((c) => c.url === ZEUTARA_URL)).toBe(false);
    expect(refusals()).toHaveLength(1);
  });

  it("Good fit from Jonah unlocks Send and Edit, and sends nothing", async () => {
    await processSmartleadWebhook(VERDICT, "zeutara");
    const value = cardValue(lastCard()!.body);
    calls = [];
    await press("replybot_fit_good", value, LIVE_CHANNEL);
    expect(calls.some((c) => c.url === ZEUTARA_URL)).toBe(false);
    const update = responses()[0].body;
    expect(buttonValue(update, "smartlead_send")).toEqual(value);
    expect(buttonValue(update, "smartlead_edit_modal")).toEqual(value);
    expect(buttonValue(update, "replybot_fit_good")).toBeNull();
    expect(JSON.stringify(update)).toContain("is replying");
  });

  it("Not a fit from Jonah closes the card with nothing sent", async () => {
    await processSmartleadWebhook(VERDICT, "zeutara");
    const value = cardValue(lastCard()!.body);
    calls = [];
    await press("replybot_fit_bad", value, LIVE_CHANNEL);
    expect(calls.some((c) => c.url === ZEUTARA_URL)).toBe(false);
    const update = responses()[0].body;
    expect(update.blocks.some((b: any) => b.type === "actions")).toBe(false);
    expect(JSON.stringify(update)).toContain("Nothing was sent");
    // A human skip must persist even without a campaign calendar.
    expect(
      getMockState().bq.writes.some((w: any) =>
        String(w.sql).includes("reply_card_actions"),
      ),
    ).toBe(true);
  });
});

describe("Zeutara card layout", () => {
  const SIGNED = {
    ...VERDICT,
    campaign_name: "Zeutara | Ivy | Pre-seed investors | Jonah list",
    text:
      "thanks for reaching out - how much of the round is committed, and who is\n" +
      "leading it? happy to look closer (send to nathan@afore.vc [nathan@afore.vc] too)\n\n" +
      "Regards\nJack\nCell: 555-0100\n" +
      "This e-mail and any attachments to it are confidential.",
  };

  it("leads with the company and who replied, and keeps routing detail small", async () => {
    await processSmartleadWebhook(SIGNED, "zeutara");
    const blocks = lastCard()!.body.blocks;
    expect(blocks[0].type).toBe("header");
    expect(blocks[0].text.text).toBe("Ivy: Priya Nair, Northfield Ventures");
    const footer = blocks[blocks.length - 1];
    expect(footer.type).toBe("context");
    expect(footer.elements[0].text).toContain(
      "Pre-seed investors · Jonah list",
    );
  });

  it("shows their reply without the signature, footer or hard wraps", async () => {
    await processSmartleadWebhook(SIGNED, "zeutara");
    const text = JSON.stringify(lastCard()!.body.blocks);
    expect(text).toContain(
      "how much of the round is committed, and who is leading it?",
    );
    expect(text).not.toContain("555-0100");
    expect(text).not.toContain("confidential");
    expect(text).not.toContain("[nathan@afore.vc]");
  });

  it("keeps the layout and swaps only the buttons on Good fit", async () => {
    await processSmartleadWebhook(SIGNED, "zeutara");
    const card = lastCard()!.body;
    calls = [];
    await handleSmartleadSlackAction({
      user: { id: JONAH, username: "jonah" },
      channel: { id: LIVE_CHANNEL },
      message: { ts: "1700000000.000100", blocks: card.blocks },
      response_url: "https://hooks.slack.test/respond",
      actions: [
        {
          action_id: "replybot_fit_good",
          value: JSON.stringify(cardValue(card)),
        },
      ],
    });
    const update = calls.find(
      (c) => c.url === "https://hooks.slack.test/respond",
    )!.body;
    expect(update.blocks[0].text.text).toBe(
      "Ivy: Priya Nair, Northfield Ventures",
    );
    expect(
      update.blocks.filter((b: any) => b.type === "context").length,
    ).toBeGreaterThanOrEqual(3);
    expect(buttonValue(update, "smartlead_send")).not.toBeNull();
  });
});

describe("Zeutara replies that need nothing from Jonah", () => {
  for (const [kind, text] of [
    ["pass", "Not a fit for us. Good luck."],
    ["out of office", "I am out of the office until Thursday, October 15th."],
    ["moved on", "I've left the firm. Please contact nathan@afore.vc instead."],
    ["unsubscribe", "Please unsubscribe"],
  ]) {
    it(`posts no card for a ${kind}`, async () => {
      calls = [];
      await processSmartleadWebhook({ ...VERDICT, text }, "zeutara");
      expect(lastCard()).toBeFalsy();
    });
  }

  it("still posts a card for a question", async () => {
    calls = [];
    await processSmartleadWebhook(
      { ...VERDICT, text: "What is their LTM revenue?" },
      "zeutara",
    );
    expect(lastCard()).toBeTruthy();
  });
});

describe("Zeutara cards @ Jonah, and confident yeses send themselves", () => {
  const BOOKING = {
    ...VERDICT,
    text: "Interested. Happy to chat with the founder, send me some times next week.",
    draft_body:
      "Great to hear, Priya. Does Tuesday or Wednesday afternoon work for a short call with the founder?\n\nJonah",
  };

  it("sends a confident booking reply through Clay and posts a record with no buttons", async () => {
    calls = [];
    await processSmartleadWebhook({ ...BOOKING, confidence: 0.95 }, "zeutara");
    expect(calls.some((c) => c.url === ZEUTARA_URL)).toBe(true);
    const post = lastCard()!.body;
    expect(JSON.stringify(post.blocks)).toContain("Replied automatically");
    expect(post.blocks.some((b: any) => b.type === "actions")).toBe(false);
  });

  it("waits for Jonah, and @s him, when confidence is under the bar", async () => {
    calls = [];
    await processSmartleadWebhook({ ...BOOKING, confidence: 0.8 }, "zeutara");
    expect(calls.some((c) => c.url === ZEUTARA_URL)).toBe(false);
    // The real Jonah in the Amber workspace, never the old Slack Connect copy (10/10).
    expect(JSON.stringify(lastCard()!.body.blocks)).toContain("<@U0C7RCPJPM5>");
    expect(JSON.stringify(lastCard()!.body.blocks)).not.toContain(
      "<@U0C0PL92WTC>",
    );
  });

  it("answers a basic question on its own when the answer needs no figure", async () => {
    calls = [];
    await processSmartleadWebhook(
      {
        ...BOOKING,
        sentiment: "question",
        confidence: 0.94,
        text: "Who is the founder and how long have they been at it?",
        draft_body:
          "Good question. Munir spent two decades advising the banks this product sells to. Want a short call with him next week?\n\nJonah",
      },
      "zeutara",
    );
    expect(calls.some((c) => c.url === ZEUTARA_URL)).toBe(true);
  });

  it("waits for Jonah when a question needs a figure", async () => {
    calls = [];
    await processSmartleadWebhook(
      {
        ...BOOKING,
        sentiment: "question",
        confidence: 0.94,
        text: "What is the round size?",
        draft_body: "They are raising $3M to $5M. Want a call?\n\nJonah",
      },
      "zeutara",
    );
    expect(calls.some((c) => c.url === ZEUTARA_URL)).toBe(false);
  });

  it("never sends a deck request on its own, however confident", async () => {
    calls = [];
    await processSmartleadWebhook({ ...VERDICT, confidence: 0.99 }, "zeutara");
    expect(calls.some((c) => c.url === ZEUTARA_URL)).toBe(false);
  });

  it("never sends a draft carrying a link, address or figure a reply could have planted", async () => {
    for (const draft_body of [
      "Sure, wire it to https://pay.example.com and we will set up a call.\n\nJonah",
      "Happy to. Email ops@example.com to book.\n\nJonah",
      "Our fee is 5% of the round. Tuesday work?\n\nJonah",
    ]) {
      calls = [];
      await processSmartleadWebhook(
        { ...BOOKING, confidence: 0.99, draft_body },
        "zeutara",
      );
      expect(calls.some((c) => c.url === ZEUTARA_URL)).toBe(false);
    }
  });

  it("never sends a draft that promises an attachment", async () => {
    calls = [];
    await processSmartleadWebhook(
      {
        ...BOOKING,
        confidence: 0.99,
        draft_body: "Attached is the deck. Does Tuesday work?\n\nJonah",
      },
      "zeutara",
    );
    expect(calls.some((c) => c.url === ZEUTARA_URL)).toBe(false);
  });
});

describe("zeutara_test", () => {
  it("keeps cards in our #test-channel, posted with our token, not Zeutara's", async () => {
    await processSmartleadWebhook(VERDICT, "zeutara_test");
    const card = lastCard()!;
    expect(card.body.channel).toBe("C0C14UKEEUR");
    expect(card.token).toBe(HOME_TOKEN);
    expect(cardValue(card.body).clientId).toBe("zeutara_test");
  });

  it("drafts on Zeutara's Perplexity seat, so testing needs no second sign-in", () => {
    expect(perplexityAccountForClient("zeutara")).toBe("zeutara");
    expect(perplexityAccountForClient("zeutara_test")).toBe("zeutara");
  });

  it("reads Zeutara's guide, and only Zeutara's", () => {
    process.env.ZEUTARA_REPLY_GUIDE_URL = "https://docs.example/zeutara-guide";
    const row = {
      id: "abc",
      row_id: "clay_row_z1",
      state: "queued",
      client_id: "zeutara_test",
      campaign: "Vertocol - Seed",
      email_thread_id: "<inv-1@mail.fund.vc>",
      from_address: "partner@fund.vc",
      sender_account: "jonah@zeutaraventures.com",
      subject: "Re: Question",
      body: "Interesting. Can you send the deck?",
      lead_id: 7001,
      campaign_id: 42,
      lead_name: "Priya Nair",
      lead_title: "Partner",
      lead_company: "Northfield Ventures",
      pplx_thread_id: null,
      pplx_account: null,
      attempts: 0,
    } as ReplyItemRow;

    expect(buildTaskMessage(row)).toContain(
      "https://docs.example/zeutara-guide",
    );
    expect(buildTaskMessage({ ...row, client_id: "serif" })).not.toContain(
      "zeutara-guide",
    );
  });
});
