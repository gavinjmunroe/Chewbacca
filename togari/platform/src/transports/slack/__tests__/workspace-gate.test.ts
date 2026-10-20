/**
 * The BMA assistant (mentions, confirm cards, reminders, proposal email) must
 * not answer a client workspace that installed Togari for its reply cards,
 * and must keep answering everything it answered before, Slack Connect
 * traffic through the home install included.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { getMockState } from '../../../../tests/smoke/helpers';
import { isHomeWorkspaceEvent, isHomeWorkspaceInteraction } from '../workspace-gate';
import { _resetBotUserIdCache, _setHomeTeamIdForTests } from '../bot-identity';
import { slackEventsHandler } from '../index';

beforeEach(() => {
  _setHomeTeamIdForTests('THOME');
});

afterEach(() => {
  _resetBotUserIdCache();
});

describe('isHomeWorkspaceEvent', () => {
  it('accepts an event delivered through the home install', async () => {
    expect(await isHomeWorkspaceEvent({ team_id: 'THOME', authorizations: [{ team_id: 'THOME' }] })).toBe(true);
  });

  it('goes by the install, so another org posting in a home Slack Connect channel is unchanged', async () => {
    expect(await isHomeWorkspaceEvent({ team_id: 'TOTHER', authorizations: [{ team_id: 'THOME' }] })).toBe(true);
  });

  it("rejects an event delivered through a client workspace's install", async () => {
    expect(await isHomeWorkspaceEvent({ team_id: 'TZEUTARA', authorizations: [{ team_id: 'TZEUTARA' }] })).toBe(false);
  });

  it('falls back to team_id when authorizations is absent', async () => {
    expect(await isHomeWorkspaceEvent({ team_id: 'TZEUTARA' })).toBe(false);
    expect(await isHomeWorkspaceEvent({ team_id: 'THOME' })).toBe(true);
  });

  it("fails open when the home team couldn't be resolved", async () => {
    _setHomeTeamIdForTests(null);
    getMockState().fetch.handlers.push({
      match: (u: string) => u.includes('auth.test'),
      response: () => ({ ok: false, error: 'ratelimited' }),
    });
    expect(await isHomeWorkspaceEvent({ team_id: 'TZEUTARA' })).toBe(true);
  });
});

describe('isHomeWorkspaceInteraction', () => {
  it('accepts a home member, even in a channel hosted by another org', async () => {
    expect(await isHomeWorkspaceInteraction({ user: { team_id: 'THOME' }, team: { id: 'TOTHER' } })).toBe(true);
    expect(await isHomeWorkspaceInteraction({ user: { team_id: 'THOME' }, team: { id: 'THOME' } })).toBe(true);
  });

  it('rejects a click from a client workspace', async () => {
    expect(await isHomeWorkspaceInteraction({ user: { team_id: 'TZEUTARA' }, team: { id: 'TZEUTARA' } })).toBe(false);
  });
});

describe('slackEventsHandler', () => {
  function signedRequest(envelope: any) {
    const body = JSON.stringify(envelope);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature =
      'v0=' +
      crypto
        .createHmac('sha256', process.env.SLACK_SIGNING_SECRET!)
        .update(`v0:${timestamp}:${body}`)
        .digest('hex');
    return {
      method: 'POST',
      path: '/slack/events',
      body,
      headers: {
        'content-type': 'application/json',
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature,
      },
    };
  }

  function res() {
    return {
      statusCode: 0,
      headersSent: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json() {
        this.headersSent = true;
        return this;
      },
    };
  }

  function mention(teamId: string, eventId: string) {
    return {
      type: 'event_callback',
      team_id: teamId,
      authorizations: [{ team_id: teamId }],
      event_id: eventId,
      event: { type: 'app_mention', user: 'U1', channel: 'C1', ts: '1.0', text: '<@UBOT> what deals closed?' },
    };
  }

  it('acks a mention from a client workspace and does nothing with it', async () => {
    const r = res();
    await slackEventsHandler(signedRequest(mention('TZEUTARA', 'Ev-ext')) as any, r as any);
    expect(r.statusCode).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getMockState().fetch.calls).toHaveLength(0);
  });

  it('still hands a home-workspace mention to the assistant', async () => {
    const r = res();
    await slackEventsHandler(signedRequest(mention('THOME', 'Ev-home')) as any, r as any);
    expect(r.statusCode).toBe(200);

    // Whatever the assistant reaches for first, it reaches for something.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const touched = getMockState().fetch.calls.length + getMockState().bq.queries.length;
    expect(touched).toBeGreaterThan(0);
  });
});
