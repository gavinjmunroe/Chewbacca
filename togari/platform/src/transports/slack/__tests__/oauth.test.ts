/**
 * The install state is the only thing standing between the callback and a
 * token for a workspace nobody meant to connect, so these pin down that a
 * forged, altered or stale one is refused, and that the authorize URL asks
 * for no more than the reply cards need.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildInstallUrl,
  signInstallState,
  slackRedirectUri,
  verifyInstallState,
  SLACK_INSTALL_BOT_SCOPES,
} from '../oauth';

beforeEach(() => {
  process.env.SLACK_CLIENT_ID = '111.222';
  process.env.SLACK_CLIENT_SECRET = 'test-client-secret';
  delete process.env.TOGARI_PUBLIC_BASE_URL;
});

afterEach(() => {
  delete process.env.SLACK_CLIENT_ID;
  delete process.env.SLACK_CLIENT_SECRET;
});

describe('install state', () => {
  it('round-trips the client id', () => {
    expect(verifyInstallState(signInstallState('zeutara'))).toEqual({ ok: true, clientId: 'zeutara' });
  });

  it('is different every time, so one leaked link says nothing about the next', () => {
    expect(signInstallState('zeutara')).not.toBe(signInstallState('zeutara'));
  });

  it('refuses a missing state (Slack shareable URL installs carry none)', () => {
    expect(verifyInstallState(undefined)).toEqual({ ok: false, reason: 'missing' });
  });

  it('refuses a state whose payload was edited to another client', () => {
    const [, signature] = signInstallState('zeutara').split('.');
    const forged = Buffer.from(JSON.stringify({ c: 'serif', e: Date.now() + 60_000, n: 'x' })).toString('base64url');
    expect(verifyInstallState(`${forged}.${signature}`)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a state signed with a different secret', () => {
    const state = signInstallState('zeutara');
    process.env.SLACK_CLIENT_SECRET = 'some-other-secret';
    expect(verifyInstallState(state)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a state past its 72 hours', () => {
    const issued = Date.now();
    const state = signInstallState('zeutara', issued);
    expect(verifyInstallState(state, issued + 71 * 3600_000).ok).toBe(true);
    expect(verifyInstallState(state, issued + 73 * 3600_000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses garbage', () => {
    expect(verifyInstallState('not-a-state')).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyInstallState('a.b.c')).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('buildInstallUrl', () => {
  it('asks for the card scopes only, with no user token', () => {
    const url = new URL(buildInstallUrl('zeutara'));
    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(url.searchParams.get('client_id')).toBe('111.222');
    expect(url.searchParams.get('scope')).toBe(SLACK_INSTALL_BOT_SCOPES.join(','));
    expect(url.searchParams.get('scope')).not.toContain('app_mentions');
    expect(url.searchParams.has('user_scope')).toBe(false);
    expect(verifyInstallState(url.searchParams.get('state')!)).toEqual({ ok: true, clientId: 'zeutara' });
  });

  it('redirects to the production callback unless the base URL is overridden', () => {
    const url = new URL(buildInstallUrl('zeutara'));
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://togari-bma-prod.up.railway.app/slack/oauth_callback',
    );

    process.env.TOGARI_PUBLIC_BASE_URL = 'https://staging.example.com/';
    expect(slackRedirectUri()).toBe('https://staging.example.com/slack/oauth_callback');
    delete process.env.TOGARI_PUBLIC_BASE_URL;
  });

  it('fails loudly without the client id', () => {
    delete process.env.SLACK_CLIENT_ID;
    expect(() => buildInstallUrl('zeutara')).toThrow(/SLACK_CLIENT_ID/);
  });
});
