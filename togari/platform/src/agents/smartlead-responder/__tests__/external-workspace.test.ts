/**
 * A client whose cards live in its own Slack workspace (slackTeamId) has
 * every card call made with that workspace's token: the post, the thread
 * reply after a send, and the Edit modal, whose trigger_id is only valid for
 * the install the click came through. Clients without slackTeamId keep
 * SLACK_BOT_TOKEN exactly as before.
 *
 * A card that can't post there is invisible to BMA, so that failure has to
 * surface as an alert in the home workspace.
 *
 * Serif stands in as the external client: no client has slackTeamId yet, and
 * the routing doesn't depend on which one it is.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { processSmartleadWebhook } from '../index';
import { handleSmartleadSlackAction } from '../slack-actions';
import { getReplybotClient } from '../../replybot/client-config';
import {
  __resetMasterKeyCacheForTests,
  __setSecretsBackendForTests,
  type SecretsBackend,
} from '../../../secrets/tenantSecrets';
import {
  _resetSlackInstallationCache,
  saveSlackInstallation,
} from '../../../transports/slack/installations';

const HOME_TOKEN = 'xoxb-home';
const EXTERNAL_TOKEN = 'xoxb-serif-workspace';
const ALERT_CHANNEL = 'CALERTS';

/** Slack/Clay calls made during a test: url, bearer token, parsed body. */
let calls: Array<{ url: string; token?: string; body: any }>;
/** Per-method Slack response overrides, e.g. to fail a post. */
let slackResponses: Record<string, any>;

function jsonOk(body: any) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as any);
}

function memoryBackend(): SecretsBackend {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    async query({ query, params = {} }) {
      const key = `${params.tenant_id}|${params.key_name}`;
      if (query.trim().toUpperCase().startsWith('SELECT')) {
        const row = rows.get(key);
        return [row ? [row] : []];
      }
      rows.set(key, { ...params });
      return [[]];
    },
  };
}

const serif = getReplybotClient('serif')!;

beforeEach(async () => {
  calls = [];
  slackResponses = {};
  process.env.SLACK_BOT_TOKEN = HOME_TOKEN;
  process.env.PERPLEXITY_ALERT_SLACK_CHANNEL = ALERT_CHANNEL;
  process.env.REPLYBOT_SERIF_CLAY_REPLY_URL = 'https://api.clay.com/v3/sources/webhook/test';
  process.env.TENANT_SECRETS_MASTER_KEY = crypto.randomBytes(32).toString('hex');
  __resetMasterKeyCacheForTests();
  __setSecretsBackendForTests(memoryBackend());
  _resetSlackInstallationCache();

  vi.stubGlobal('fetch', (url: any, init?: any) => {
    const u = String(url);
    let body: any = {};
    try {
      body = init?.body ? JSON.parse(init.body) : {};
    } catch {
      body = { raw: init?.body };
    }
    const auth = init?.headers?.Authorization as string | undefined;
    calls.push({ url: u, token: auth?.replace(/^Bearer /, ''), body });
    const method = u.match(/slack\.com\/api\/([\w.]+)/)?.[1];
    return jsonOk((method && slackResponses[method]) || { ok: true, ts: '1700000000.000100' });
  });

  await saveSlackInstallation({
    teamId: 'TSERIF',
    teamName: 'Serif Health',
    enterpriseId: null,
    appId: 'A123',
    botToken: EXTERNAL_TOKEN,
    botUserId: 'UBOT',
    scope: 'chat:write',
    installerUserId: null,
    clientId: 'serif',
    installedAt: '2026-10-05T00:00:00.000Z',
  });
  serif.slackTeamId = 'TSERIF';
});

afterEach(() => {
  delete serif.slackTeamId;
  vi.unstubAllGlobals();
  __setSecretsBackendForTests(null);
  _resetSlackInstallationCache();
  delete process.env.PERPLEXITY_ALERT_SLACK_CHANNEL;
  delete process.env.REPLYBOT_SERIF_CLAY_REPLY_URL;
});

const PAYLOAD = {
  to_email: 'cfo@examplehealth.com',
  to_name: 'Dana Reyes',
  from_email: 'rafiq@serif-outreach.com',
  subject: 'Re: payer rate data',
  text: 'Interesting, can you send pricing?',
  lead_id: 4821,
  campaign_id: 907,
  message_id: '<abc@mail.example.com>',
  sentiment: 'positive',
  draft_subject: 'Re: payer rate data',
  draft_body: 'Happy to walk through it.\n\nRafiq',
};

function slackCalls(method: string) {
  return calls.filter((c) => c.url.includes(`slack.com/api/${method}`));
}

function cardButton(card: any, actionId: string): any {
  const actions = (card.body.blocks || []).find((b: any) => b.type === 'actions');
  const button = (actions?.elements || []).find((e: any) => e.action_id === actionId);
  return JSON.parse(button.value);
}

async function postCard() {
  await processSmartleadWebhook(PAYLOAD, 'serif');
  const card = slackCalls('chat.postMessage')[0];
  expect(card, 'a card should have been posted').toBeTruthy();
  return card;
}

describe("a client in its own Slack workspace", () => {
  it("posts its cards with that workspace's token", async () => {
    const card = await postCard();
    expect(card.token).toBe(EXTERNAL_TOKEN);
  });

  it("threads the send confirmation with that workspace's token", async () => {
    const card = await postCard();
    calls = [];

    await handleSmartleadSlackAction({
      user: { id: 'U123', username: 'arham', team_id: 'TSERIF' },
      team: { id: 'TSERIF' },
      channel: { id: card.body.channel },
      message: { ts: '1700000000.000100', blocks: [] },
      response_url: 'https://hooks.slack.test/respond',
      actions: [{ action_id: 'smartlead_send', value: JSON.stringify(cardButton(card, 'smartlead_send')) }],
    });

    expect(calls.some((c) => c.url.includes('clay.com'))).toBe(true);
    const thread = slackCalls('chat.postMessage');
    expect(thread).toHaveLength(1);
    expect(thread[0].token).toBe(EXTERNAL_TOKEN);
  });

  it("opens the Edit modal with that workspace's token", async () => {
    const card = await postCard();
    calls = [];

    await handleSmartleadSlackAction({
      user: { id: 'U123', username: 'arham', team_id: 'TSERIF' },
      team: { id: 'TSERIF' },
      trigger_id: 'trig-1',
      channel: { id: card.body.channel },
      message: { ts: '1700000000.000100', blocks: [] },
      response_url: 'https://hooks.slack.test/respond',
      actions: [{ action_id: 'smartlead_edit_modal', value: JSON.stringify(cardButton(card, 'smartlead_edit_modal')) }],
    });

    const opened = slackCalls('views.open');
    expect(opened).toHaveLength(1);
    expect(opened[0].token).toBe(EXTERNAL_TOKEN);
  });

  it('alerts the home workspace when a card cannot post there', async () => {
    slackResponses['chat.postMessage'] = { ok: false, error: 'not_in_channel' };

    await processSmartleadWebhook(PAYLOAD, 'serif');

    const alert = slackCalls('chat.postMessage').find((c) => c.body.channel === ALERT_CHANNEL);
    expect(alert, 'an urgent alert should have been posted').toBeTruthy();
    expect(alert!.token).toBe(HOME_TOKEN);
    expect(alert!.body.text).toContain('Serif Health');
    expect(alert!.body.text).toContain('not_in_channel');
  });

  it('alerts the home workspace when the workspace was never installed', async () => {
    serif.slackTeamId = 'TNOTINSTALLED';

    await processSmartleadWebhook(PAYLOAD, 'serif');

    const posts = slackCalls('chat.postMessage');
    expect(posts.every((c) => c.token === HOME_TOKEN)).toBe(true);
    expect(posts.map((c) => c.body.channel)).toEqual([ALERT_CHANNEL]);
    expect(posts[0].body.text).toContain("isn't installed");
  });
});

describe('a client in the home workspace', () => {
  it('keeps posting with SLACK_BOT_TOKEN and raises no alert on failure', async () => {
    delete serif.slackTeamId;
    slackResponses['chat.postMessage'] = { ok: false, error: 'channel_not_found' };

    await processSmartleadWebhook(PAYLOAD, 'serif');

    const posts = slackCalls('chat.postMessage');
    expect(posts).toHaveLength(1);
    expect(posts[0].token).toBe(HOME_TOKEN);
    expect(posts[0].body.channel).not.toBe(ALERT_CHANNEL);
  });
});
