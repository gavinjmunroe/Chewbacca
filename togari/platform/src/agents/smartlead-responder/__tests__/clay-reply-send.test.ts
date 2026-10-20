/**
 * Serif's approved replies go back out through Clay, which sends them from
 * the campaign's own Smartsenders mailbox. Clay's "reply to lead in a
 * campaign" action is keyed on lead id + campaign id, so the whole point of
 * these tests is that those two survive every hop between the inbound
 * webhook and the click that sends: card → review thread → confirm.
 *
 * They are easy to drop. Each hop rebuilds its own button value rather than
 * forwarding the last one, and a dropped key doesn't fail loudly — it falls
 * back to the client's default send method and mails the prospect from the
 * wrong mailbox under the wrong persona.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { processSmartleadWebhook } from "../index";
import { handleSmartleadSlackAction } from "../slack-actions";
import { getMockState } from "../../../../tests/smoke/helpers";
import { getReplybotClient } from "../../replybot/client-config";

const CLAY_URL = "https://api.clay.com/v3/sources/webhook/test-reply-hook";

/** Slack/Clay calls made during a test, in order. */
let calls: Array<{ url: string; body: any }>;

function jsonOk(body: any = { ok: true, ts: "1700000000.000100" }) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as any);
}

beforeEach(() => {
  calls = [];
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.REPLYBOT_SERIF_CLAY_REPLY_URL = CLAY_URL;

  vi.stubGlobal("fetch", (url: any, init?: any) => {
    const u = String(url);
    let parsed: any = {};
    try {
      parsed = init?.body ? JSON.parse(init.body) : {};
    } catch {
      parsed = { raw: init?.body };
    }
    calls.push({ url: u, body: parsed });
    return jsonOk();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.REPLYBOT_SERIF_CLAY_REPLY_URL;
});

/** The value JSON on a card button with the given action_id. */
function buttonValue(cardBody: any, actionId: string): any {
  const actions = (cardBody.blocks || []).find(
    (b: any) => b.type === "actions",
  );
  const button = (actions?.elements || []).find(
    (e: any) => e.action_id === actionId,
  );
  return button ? JSON.parse(button.value) : null;
}

/** An upstream-drafted Serif reply, as Perplexity would POST it. */
const SERIF_PAYLOAD = {
  to_email: "cfo@examplehealth.com",
  to_name: "Dana Reyes",
  company_name: "Example Health",
  from_email: "rafiq@serif-outreach.com",
  subject: "Re: payer rate data",
  text: "Interesting, can you send pricing?",
  lead_id: 4821,
  campaign_id: 907,
  message_id: "<abc@mail.example.com>",
  sentiment: "positive",
  draft_subject: "Re: payer rate data",
  draft_body: "Happy to walk through it.\n\nRafiq",
};

describe("Serif replies route back through Clay", () => {
  it("stamps the Clay route and both keys onto the card", async () => {
    await processSmartleadWebhook(SERIF_PAYLOAD, "serif");

    const card = calls.find((c) => c.url.includes("chat.postMessage"));
    expect(card, "a Slack card should have been posted").toBeTruthy();

    const value = buttonValue(card!.body, "smartlead_send");
    expect(value.leadId).toBe(4821);
    expect(value.campaignId).toBe(907);
    expect(value.sendVia).toBe("clay");
  });

  it("shows the campaign mailbox, not the configured sender", async () => {
    await processSmartleadWebhook(SERIF_PAYLOAD, "serif");
    const card = calls.find((c) => c.url.includes("chat.postMessage"))!;
    const text = JSON.stringify(card.body);

    expect(text).toContain("rafiq@serif-outreach.com");
    expect(text).not.toContain("Ready to send from arham@serifhealth.com");
  });

  it("offers no Gmail draft button, which would file into the wrong mailbox", async () => {
    await processSmartleadWebhook(SERIF_PAYLOAD, "serif");
    const card = calls.find((c) => c.url.includes("chat.postMessage"))!;
    expect(buttonValue(card.body, "smartlead_draft")).toBeNull();
  });

  it("sends on the first press, straight to Clay with both keys", async () => {
    await processSmartleadWebhook(SERIF_PAYLOAD, "serif");
    const card = calls.find((c) => c.url.includes("chat.postMessage"))!;
    const sendValue = buttonValue(card.body, "smartlead_send");

    calls = [];
    await handleSmartleadSlackAction({
      user: { id: "U123", username: "arham" },
      channel: { id: "C0BAL9JV0E5" },
      message: { ts: "1700000000.000100", blocks: [] },
      response_url: "https://hooks.slack.test/respond",
      actions: [
        { action_id: "smartlead_send", value: JSON.stringify(sendValue) },
      ],
    });

    // No confirm step: the card already showed the draft, so the press is the
    // decision. What still matters is that both keys reach Clay — without them
    // the send refuses rather than answering from the wrong mailbox.
    const sent = calls.find((c) => c.url.includes("clay.com"));
    expect(sent, "should have posted to the Clay reply webhook").toBeTruthy();
    expect(sent!.body.lead_id).toBe(4821);
    expect(sent!.body.campaign_id).toBe(907);
  });

  it("POSTs lead and campaign ids to Clay on confirm, and sends no email", async () => {
    await processSmartleadWebhook(SERIF_PAYLOAD, "serif");
    const card = calls.find((c) => c.url.includes("chat.postMessage"))!;
    const confirmValue = {
      ...buttonValue(card.body, "smartlead_send"),
      draftBody: "Edited by Arham before sending.\n\nRafiq",
    };

    calls = [];
    await handleSmartleadSlackAction({
      user: { id: "U123", username: "arham" },
      channel: { id: "C0BAL9JV0E5" },
      message: { ts: "1700000000.000100", blocks: [] },
      response_url: "https://hooks.slack.test/respond",
      actions: [
        {
          action_id: "smartlead_confirm_send",
          value: JSON.stringify(confirmValue),
        },
      ],
    });

    const clay = calls.find((c) => c.url === CLAY_URL);
    expect(clay, "the reply should have been handed to Clay").toBeTruthy();
    expect(clay!.body.lead_id).toBe(4821);
    expect(clay!.body.campaign_id).toBe(907);
    expect(clay!.body.email).toBe("cfo@examplehealth.com");
    expect(clay!.body.body).toContain("Edited by Arham");

    // Nothing may reach Gmail — that would be the wrong mailbox entirely.
    expect(calls.some((c) => c.url.includes("gmail.googleapis.com"))).toBe(
      false,
    );
  });

  it("refuses to send when the campaign keys are missing rather than falling back to Gmail", async () => {
    await processSmartleadWebhook(
      { ...SERIF_PAYLOAD, lead_id: 0, campaign_id: 0 },
      "serif",
    );
    const card = calls.find((c) => c.url.includes("chat.postMessage"))!;
    const value = buttonValue(card.body, "smartlead_send");

    // No ids to stamp, so the card cannot claim the Clay route.
    expect(value.leadId).toBeUndefined();
    expect(value.campaignId).toBeUndefined();

    calls = [];
    await handleSmartleadSlackAction({
      user: { id: "U123", username: "arham" },
      channel: { id: "C0BAL9JV0E5" },
      message: { ts: "1700000000.000100", blocks: [] },
      response_url: "https://hooks.slack.test/respond",
      actions: [
        { action_id: "smartlead_confirm_send", value: JSON.stringify(value) },
      ],
    });

    expect(calls.some((c) => c.url === CLAY_URL)).toBe(false);
    expect(calls.some((c) => c.url.includes("gmail.googleapis.com"))).toBe(
      false,
    );
  });
});

describe("Perplexity output can be passed through unsplit", () => {
  /**
   * Perplexity returns its JSON as a string inside
   * choices[0].message.content. Clay can forward that verbatim instead of
   * picking it apart in formula columns, so these cover what a model
   * actually wraps around its JSON.
   *
   * The inner JSON is built with JSON.stringify rather than written by
   * hand: a draft has newlines before the signoff, and hand-escaping those
   * inside a string inside a string is how you end up testing malformed
   * input by accident.
   */
  const base = {
    to_email: "cfo@examplehealth.com",
    to_name: "Dana Reyes",
    from_email: "rafiq@serif-outreach.com",
    text: "Interesting, can you send pricing?",
    lead_id: 4821,
    campaign_id: 907,
  };

  async function cardFor(payload: any) {
    calls = [];
    await processSmartleadWebhook(payload, "serif");
    return calls.find((c) => c.url.includes("chat.postMessage"));
  }

  it("parses a bare JSON string", async () => {
    const card = await cardFor({
      ...base,
      draft_json: JSON.stringify({
        sentiment: "positive",
        draft_subject: "Re: rates",
        draft_body: "Happy to help.\n\nRafiq",
        reason: "asked for pricing",
      }),
    });
    expect(card).toBeTruthy();
    const text = JSON.stringify(card!.body);
    expect(text).toContain("Happy to help.");
    expect(text).toContain("Quick Reply Needed"); // positive → send-ready
  });

  it("parses JSON wrapped in code fences and prose", async () => {
    const inner = JSON.stringify({
      sentiment: "negative",
      draft_body: "No worries at all.\n\nRafiq",
    });
    const card = await cardFor({
      ...base,
      draft_json: `Here is the reply:\n\`\`\`json\n${inner}\n\`\`\``,
    });
    expect(card).toBeTruthy();
    expect(JSON.stringify(card!.body)).toContain("No worries at all.");
  });

  it("drops an out-of-office without posting a card", async () => {
    const card = await cardFor({
      ...base,
      draft_json: JSON.stringify({
        sentiment: "ooo",
        draft_body: "I am away until Monday.",
      }),
    });
    expect(card).toBeUndefined();
  });

  it("ignores unparseable output rather than blanking a good draft", async () => {
    const card = await cardFor({
      ...base,
      draft_json: "the model returned no json at all",
      sentiment: "positive",
      draft_body: "Top-level draft survived.\n\nRafiq",
    });
    expect(card).toBeTruthy();
    expect(JSON.stringify(card!.body)).toContain("Top-level draft survived.");
  });
});

describe("first-touch outreach routing", () => {
  const ENV = "REPLYBOT_SERIF_CLAY_OUTREACH_URL";
  afterEach(() => {
    delete process.env[ENV];
  });

  it("keeps outreach on Gmail until the Clay webhook is configured", async () => {
    delete process.env[ENV];
    const { getReplybotClient } = await import("../../replybot/client-config");
    const serif = getReplybotClient("serif")!;
    // The switch is the variable, not a deploy — nothing breaks in the gap
    // before Clay's side exists.
    expect(serif.clayOutreachWebhookUrlEnv).toBe(ENV);
    expect(process.env[ENV]).toBeUndefined();
  });

  it("routes outreach to Clay once it is set", async () => {
    process.env[ENV] = "https://api.clay.com/v3/sources/webhook/outreach-test";
    const { getReplybotClient } = await import("../../replybot/client-config");
    const serif = getReplybotClient("serif")!;
    expect(process.env[serif.clayOutreachWebhookUrlEnv!]).toContain("clay.com");
  });
});

describe("Serif reply cards have their own channel", () => {
  it("posts a reply card to the replies channel, not the form-fills one", async () => {
    await processSmartleadWebhook(SERIF_PAYLOAD, "serif");
    const card = calls.find((c) => c.url.includes("chat.postMessage"))!;
    expect(card.body.channel).toBe("C0C272SGCLD");
    expect(card.body.channel).not.toBe("C0BAL9JV0E5");
  });

  it("keeps the test client in the test channel, despite spreading from serif", async () => {
    calls = [];
    await processSmartleadWebhook(SERIF_PAYLOAD, "serif_test");
    const card = calls.find((c) => c.url.includes("chat.postMessage"))!;
    expect(card.body.channel).toBe("C0C14UKEEUR");
  });
});

// The campaign calendar counts a reply as waiting until its card is sent,
// skipped or marked done, so every one of those clicks is recorded.
describe("Serif card clicks feed the campaign calendar", () => {
  const cardActions = () =>
    getMockState().bq.writes.filter((w: any) =>
      String(w.sql).includes("reply_card_actions"),
    );

  async function press(actionId: string) {
    await processSmartleadWebhook(SERIF_PAYLOAD, "serif");
    const card = calls.find((c) => c.url.includes("chat.postMessage"))!;
    const value = buttonValue(card.body, "smartlead_send");
    calls = [];
    await handleSmartleadSlackAction({
      user: { id: "U123", username: "arham" },
      channel: { id: "C0BAL9JV0E5" },
      message: { ts: "1700000000.000100", blocks: card.body.blocks },
      response_url: "https://hooks.slack.test/respond",
      actions: [{ action_id: actionId, value: JSON.stringify(value) }],
    });
  }

  it("offers Skip, no reply next to Send", async () => {
    await processSmartleadWebhook(SERIF_PAYLOAD, "serif");
    const card = calls.find((c) => c.url.includes("chat.postMessage"))!;
    expect(buttonValue(card.body, "replybot_fit_bad")).not.toBeNull();
  });

  it("records a send against the prospect and campaign", async () => {
    await press("smartlead_send");
    expect(calls.some((c) => c.url.includes("clay.com"))).toBe(true);
    expect(cardActions()).toHaveLength(1);
    expect(cardActions()[0].params).toMatchObject({
      clientId: "serif",
      lead: "cfo@examplehealth.com",
      campaignId: "907",
      action: "sent",
      byUser: "arham",
    });
  });

  it("records a skip and sends nothing", async () => {
    await press("replybot_fit_bad");
    expect(calls.some((c) => c.url.includes("clay.com"))).toBe(false);
    expect(cardActions()[0].params).toMatchObject({
      lead: "cfo@examplehealth.com",
      action: "skipped",
    });
  });
  it("persists a skip even when the client has no campaign calendar", async () => {
    const client = getReplybotClient("serif")!;
    const previous = client.campaignCalendar;
    delete client.campaignCalendar;
    try {
      await press("replybot_fit_bad");
      expect(cardActions()[0].params).toMatchObject({ action: "skipped" });
      expect(cardActions()[0].params.inReplyTo).toBeTruthy();
    } finally {
      client.campaignCalendar = previous;
    }
  });
});
