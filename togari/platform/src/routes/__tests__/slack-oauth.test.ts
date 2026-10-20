/**
 * GET /slack/oauth_callback. The order of checks is the point: a bad state is
 * refused before the code is ever exchanged, so an install nobody started
 * leaves no token behind, and the page a person sees never shows the token.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onFetch, getMockState } from '../../../tests/smoke/helpers';

const saved: any[] = [];
vi.mock('../../transports/slack/installations', () => ({
  saveSlackInstallation: vi.fn(async (inst: any) => {
    saved.push(inst);
  }),
}));

import { createSlackOAuthRouter } from '../slack-oauth';
import { signInstallState } from '../../transports/slack/oauth';
import { _resetBotUserIdCache, _setHomeTeamIdForTests } from '../../transports/slack/bot-identity';
import { saveSlackInstallation } from '../../transports/slack/installations';

interface FakeRes {
  statusCode: number;
  body: string;
  contentType?: string;
  status(code: number): FakeRes;
  type(t: string): FakeRes;
  send(b: string): FakeRes;
}

function makeRes(): FakeRes {
  return {
    statusCode: 200,
    body: '',
    status(code) {
      this.statusCode = code;
      return this;
    },
    type(t) {
      this.contentType = t;
      return this;
    },
    send(b) {
      this.body = b;
      return this;
    },
  };
}

async function callback(query: Record<string, string>): Promise<FakeRes> {
  const router: any = createSlackOAuthRouter();
  const layer = router.stack.find((l: any) => l.route?.path === '/oauth_callback' && l.route.methods.get);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const res = makeRes();
  await handler({ method: 'GET', query }, res, () => {});
  return res;
}

const ACCESS_OK = {
  ok: true,
  app_id: 'A123',
  access_token: 'xoxb-zeutara-secret',
  token_type: 'bot',
  scope: 'chat:write,channels:history,groups:history',
  bot_user_id: 'UBOT',
  team: { id: 'TZEUTARA', name: 'Zeutara' },
  enterprise: null,
  is_enterprise_install: false,
  authed_user: { id: 'UJONAH' },
};

function exchangeCalls() {
  return getMockState().fetch.calls.filter((c: any) => c.url.includes('oauth.v2.access'));
}

beforeEach(() => {
  saved.length = 0;
  vi.mocked(saveSlackInstallation).mockClear();
  process.env.SLACK_CLIENT_ID = '111.222';
  process.env.SLACK_CLIENT_SECRET = 'test-client-secret';
  _setHomeTeamIdForTests('THOME');
});

afterEach(() => {
  delete process.env.SLACK_CLIENT_ID;
  delete process.env.SLACK_CLIENT_SECRET;
  _resetBotUserIdCache();
});

describe('GET /slack/oauth_callback', () => {
  it('exchanges the code, stores the install, and shows the team id but never the token', async () => {
    onFetch('slack.com/api/oauth.v2.access', ACCESS_OK);

    const res = await callback({ code: 'c0de', state: signInstallState('zeutara') });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('TZEUTARA');
    expect(res.body).not.toContain('xoxb-');

    const body = new URLSearchParams(exchangeCalls()[0].init.body);
    expect(body.get('code')).toBe('c0de');
    expect(body.get('redirect_uri')).toBe('https://togari-bma-prod.up.railway.app/slack/oauth_callback');

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      teamId: 'TZEUTARA',
      teamName: 'Zeutara',
      botToken: 'xoxb-zeutara-secret',
      botUserId: 'UBOT',
      clientId: 'zeutara',
      installerUserId: 'UJONAH',
    });
  });

  it("refuses a missing state without exchanging the code (Slack's shareable URL)", async () => {
    const res = await callback({ code: 'c0de' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('shareable URL');
    expect(exchangeCalls()).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  it('refuses a forged state without exchanging the code', async () => {
    const state = signInstallState('zeutara');
    process.env.SLACK_CLIENT_SECRET = 'a-different-secret';
    const res = await callback({ code: 'c0de', state });
    expect(res.statusCode).toBe(400);
    expect(exchangeCalls()).toHaveLength(0);
  });

  it('says so when the link has expired', async () => {
    const state = signInstallState('zeutara', Date.now() - 73 * 3600_000);
    const res = await callback({ code: 'c0de', state });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('expired');
    expect(exchangeCalls()).toHaveLength(0);
  });

  it('reports a cancelled approval and stores nothing', async () => {
    const res = await callback({ error: 'access_denied', state: signInstallState('zeutara') });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('access_denied');
    expect(exchangeCalls()).toHaveLength(0);
  });

  it("passes on Slack's refusal and stores nothing", async () => {
    onFetch('slack.com/api/oauth.v2.access', { ok: false, error: 'invalid_code' });
    const res = await callback({ code: 'stale', state: signInstallState('zeutara') });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('invalid_code');
    expect(saved).toHaveLength(0);
  });

  it('refuses an org-wide Enterprise Grid install', async () => {
    onFetch('slack.com/api/oauth.v2.access', {
      ...ACCESS_OK,
      team: null,
      is_enterprise_install: true,
      enterprise: { id: 'E1', name: 'Org' },
    });
    const res = await callback({ code: 'c0de', state: signInstallState('zeutara') });
    expect(res.statusCode).toBe(400);
    expect(saved).toHaveLength(0);
  });

  it('stores nothing for the home workspace, whose token lives in SLACK_BOT_TOKEN', async () => {
    onFetch('slack.com/api/oauth.v2.access', { ...ACCESS_OK, team: { id: 'THOME', name: 'Amber Intelligence' } });
    const res = await callback({ code: 'c0de', state: signInstallState('bma') });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('SLACK_BOT_TOKEN');
    expect(saved).toHaveLength(0);
  });

  it('tells the installer to retry when the token could not be saved', async () => {
    onFetch('slack.com/api/oauth.v2.access', ACCESS_OK);
    vi.mocked(saveSlackInstallation).mockRejectedValueOnce(new Error('bq down'));
    const res = await callback({ code: 'c0de', state: signInstallState('zeutara') });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('xoxb-');
  });
});
