/**
 * BMA's two personas send approved replies back through Clay, so the reply
 * leaves the campaign's own sending mailbox rather than sagar@ or maggie@
 * over Gmail. Mechanically the same route Serif uses (see
 * clay-reply-send.test.ts); these cover what is different about BMA:
 *
 *  - Two personas on one company, each with its own Clay webhook env var.
 *    A crossed wire here would answer a prospect as the wrong person.
 *  - BMA is the only client with the job-posting placement strategy, so it
 *    is the only client that ever sees an ambiguous SWE/BizOps card. That
 *    card re-drafts before it sends, which is an extra hop for the route
 *    stamp to fall out of — and it did.
 *  - BMA drafts with Claude rather than arriving pre-drafted, so the
 *    classifier call is stubbed here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { processSmartleadWebhook } from '../index';
import { handleSmartleadSlackAction } from '../slack-actions';

const AMBER_URL = 'https://api.clay.com/v3/sources/webhook/test-amber-hook';
const BMA_URL = 'https://api.clay.com/v3/sources/webhook/test-bma-hook';

let calls: Array<{ url: string; body: any }>;

/** What Claude returns. Overridden per test for the ambiguous track. */
let claudeReply: Record<string, unknown>;

function jsonOk(body: any = { ok: true, ts: '1700000000.000100' }) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as any);
}

beforeEach(() => {
  calls = [];
  claudeReply = {
    sentiment: 'interested',
    draftSubject: 'Re: your posting',
    draftBody: 'Happy to help.\n\nSagar',
    reasoning: 'Asked for a call.',
    track: null,
  };

  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  process.env.REPLYBOT_AMBER_CLAY_REPLY_URL = AMBER_URL;
  process.env.REPLYBOT_BMA_CLAY_REPLY_URL = BMA_URL;

  vi.stubGlobal('fetch', (url: any, init?: any) => {
    const u = String(url);
    let parsed: any = {};
    try {
      parsed = init?.body ? JSON.parse(init.body) : {};
    } catch {
      parsed = { raw: init?.body };
    }
    calls.push({ url: u, body: parsed });

    if (u.includes('api.anthropic.com')) {
      return jsonOk({ content: [{ type: 'text', text: JSON.stringify(claudeReply) }] });
    }
    return jsonOk();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.REPLYBOT_AMBER_CLAY_REPLY_URL;
  delete process.env.REPLYBOT_BMA_CLAY_REPLY_URL;
});

function buttonValue(cardBody: any, actionId: string): any {
  const actions = (cardBody.blocks || []).find((b: any) => b.type === 'actions');
  const button = (actions?.elements || []).find((e: any) => e.action_id === actionId);
  return button ? JSON.parse(button.value) : null;
}

function lastCard() {
  return calls.filter((c) => c.url.includes('chat.postMessage')).pop();
}

const REPLY = {
  to_email: 'hiring@acme.com',
  to_name: 'Dana Reyes',
  company_name: 'Acme',
  lead_title: 'VP Engineering',
  from_email: 'sagar@amber-outreach.com',
  subject: 'Re: your open roles',
  text: 'Sure, happy to chat. Call me Tuesday.',
  lead_id: 5150,
  campaign_id: 311,
  message_id: '<abc@mail.acme.com>',
};

describe.each([
  { clientId: 'amber', persona: 'Sagar', url: AMBER_URL, otherUrl: BMA_URL, channel: 'C0BR33EHKK6' },
  { clientId: 'bma', persona: 'Maggie', url: BMA_URL, otherUrl: AMBER_URL, channel: 'C0BMYM752MQ' },
])('$clientId replies route through Clay', ({ clientId, url, otherUrl, channel }) => {
  it('stamps the Clay route and both campaign keys onto the card', async () => {
    await processSmartleadWebhook(REPLY, clientId);

    const value = buttonValue(lastCard()!.body, 'smartlead_send');
    expect(value.leadId).toBe(5150);
    expect(value.campaignId).toBe(311);
    expect(value.sendVia).toBe('clay');
  });

  it('drops the Gmail draft button, which would file into the wrong mailbox', async () => {
    await processSmartleadWebhook(REPLY, clientId);
    expect(buttonValue(lastCard()!.body, 'smartlead_draft')).toBeNull();
  });

  it('POSTs to its own Clay webhook and never the other persona\'s', async () => {
    await processSmartleadWebhook(REPLY, clientId);
    const sendValue = buttonValue(lastCard()!.body, 'smartlead_send');

    calls = [];
    await handleSmartleadSlackAction({
      user: { id: 'U123', username: 'maggie' },
      channel: { id: channel },
      message: { ts: '1700000000.000100', blocks: [] },
      response_url: 'https://hooks.slack.test/respond',
      actions: [{ action_id: 'smartlead_confirm_send', value: JSON.stringify(sendValue) }],
    });

    const clay = calls.find((c) => c.url === url);
    expect(clay, 'reply should have been handed to this persona\'s Clay hook').toBeTruthy();
    expect(clay!.body.lead_id).toBe(5150);
    expect(clay!.body.campaign_id).toBe(311);
    expect(clay!.body.email).toBe('hiring@acme.com');
    expect(clay!.body.client_id).toBe(clientId);

    expect(calls.some((c) => c.url === otherUrl)).toBe(false);
    expect(calls.some((c) => c.url.includes('gmail.googleapis.com'))).toBe(false);
  });

  it('refuses to send without the campaign keys rather than falling back to Gmail', async () => {
    await processSmartleadWebhook({ ...REPLY, lead_id: 0, campaign_id: 0 }, clientId);
    const value = buttonValue(lastCard()!.body, 'smartlead_send');
    expect(value.leadId).toBeUndefined();

    calls = [];
    await handleSmartleadSlackAction({
      user: { id: 'U123', username: 'maggie' },
      channel: { id: channel },
      message: { ts: '1700000000.000100', blocks: [] },
      response_url: 'https://hooks.slack.test/respond',
      actions: [{ action_id: 'smartlead_confirm_send', value: JSON.stringify(value) }],
    });

    expect(calls.some((c) => c.url === url)).toBe(false);
    expect(calls.some((c) => c.url.includes('gmail.googleapis.com'))).toBe(false);
  });
});

describe('job-posting ambiguous track keeps the Clay route across the re-draft', () => {
  const JOB_POSTING_REPLY = {
    ...REPLY,
    campaign_name: 'Job Posting Outreach Q3',
    text: 'We are hiring, tell me more.',
  };

  beforeEach(() => {
    // Ambiguous track: the card offers SWE / BizOps buttons instead of a
    // draft, and the send only happens after a re-draft.
    claudeReply = {
      sentiment: 'interested',
      draftSubject: 'Re: your open roles',
      draftBody: 'Tell me a bit more about the role.\n\nSagar',
      reasoning: 'Role type unclear.',
      track: 'ambiguous',
    };
  });

  it('stamps the route onto the ambiguous card itself', async () => {
    await processSmartleadWebhook(JOB_POSTING_REPLY, 'amber');
    const card = lastCard()!;

    const swe = buttonValue(card.body, 'smartlead_ambig_swe');
    expect(swe, 'the ambiguous card should offer a SWE track button').toBeTruthy();
    expect(swe.sendVia).toBe('clay');
    expect(swe.leadId).toBe(5150);
    expect(swe.campaignId).toBe(311);
  });

  it('carries the route through the track click onto the confirm button', async () => {
    await processSmartleadWebhook(JOB_POSTING_REPLY, 'amber');
    const swe = buttonValue(lastCard()!.body, 'smartlead_ambig_swe');

    // Track chosen: re-draft with the placement profiles, post a review.
    claudeReply = { ...claudeReply, track: 'swe' };
    calls = [];
    await handleSmartleadSlackAction({
      user: { id: 'U123', username: 'sagar' },
      channel: { id: 'C0BR33EHKK6' },
      message: { ts: '1700000000.000100', blocks: [] },
      response_url: 'https://hooks.slack.test/respond',
      actions: [{ action_id: 'smartlead_ambig_swe', value: JSON.stringify(swe) }],
    });

    const confirm = buttonValue(lastCard()!.body, 'smartlead_confirm_send');
    expect(confirm, 'a review card should have been posted').toBeTruthy();
    expect(confirm.sendVia).toBe('clay');
    expect(confirm.leadId).toBe(5150);
    expect(confirm.campaignId).toBe(311);
  });

  it('sends the re-drafted reply through Clay, not Gmail', async () => {
    await processSmartleadWebhook(JOB_POSTING_REPLY, 'amber');
    const swe = buttonValue(lastCard()!.body, 'smartlead_ambig_swe');

    claudeReply = { ...claudeReply, track: 'swe' };
    calls = [];
    await handleSmartleadSlackAction({
      user: { id: 'U123', username: 'sagar' },
      channel: { id: 'C0BR33EHKK6' },
      message: { ts: '1700000000.000100', blocks: [] },
      response_url: 'https://hooks.slack.test/respond',
      actions: [{ action_id: 'smartlead_ambig_swe', value: JSON.stringify(swe) }],
    });
    const confirm = buttonValue(lastCard()!.body, 'smartlead_confirm_send');

    calls = [];
    await handleSmartleadSlackAction({
      user: { id: 'U123', username: 'sagar' },
      channel: { id: 'C0BR33EHKK6' },
      message: { ts: '1700000000.000100', blocks: [] },
      response_url: 'https://hooks.slack.test/respond',
      actions: [{ action_id: 'smartlead_confirm_send', value: JSON.stringify(confirm) }],
    });

    const clay = calls.find((c) => c.url === AMBER_URL);
    expect(clay, 'the re-drafted reply should go through Clay').toBeTruthy();
    expect(clay!.body.lead_id).toBe(5150);
    expect(clay!.body.campaign_id).toBe(311);
    // The placement profiles are injected during the re-draft, so this is
    // also a check that we send the re-drafted body and not the original.
    expect(clay!.body.body).toContain('linkedin.com/in/');
    expect(calls.some((c) => c.url.includes('gmail.googleapis.com'))).toBe(false);
  });
});
