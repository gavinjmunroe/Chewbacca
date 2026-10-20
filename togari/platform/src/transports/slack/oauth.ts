/**
 * @togari/transports/slack — OAuth install into another workspace
 *
 * Togari's home workspace never goes through this: its token is
 * SLACK_BOT_TOKEN, copied from the app dashboard. This is only for putting a
 * client's reply cards into the client's own Slack workspace.
 *
 * The flow:
 *   1. `scripts/slack-install-link.ts <clientId>` mints an authorize URL with a
 *      signed `state` (buildInstallUrl).
 *   2. An admin of the client's workspace opens it and approves.
 *   3. Slack redirects to GET /slack/oauth_callback, which checks the state,
 *      exchanges the code (exchangeInstallCode) and stores the bot token
 *      (installations.ts).
 *
 * The state is signed rather than stored: there's no Redis in production and
 * there may be more than one replica, so the callback has to be able to check
 * it without having seen it before. Signing with SLACK_CLIENT_SECRET also
 * means only someone holding the secret can mint a link. Slack's own
 * "shareable URL" carries no state, so installs started from it are refused
 * and we never hold tokens for workspaces nobody meant to connect.
 */

import crypto from 'node:crypto';

// The bot only posts cards, updates them and replies in their threads.
// history is for re-reading a card after an Edit & Send (see
// replaceOriginalWithStatusViaUpdate); groups: covers a private channel.
// Deliberately no app_mentions:read, so the workspace never even sends us
// mention events, and no user scopes.
export const SLACK_INSTALL_BOT_SCOPES = ['chat:write', 'channels:history', 'groups:history'];

const STATE_TTL_MS = 72 * 60 * 60 * 1000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} not set — see docs/SLACK_EXTERNAL_WORKSPACE.md`);
  return value;
}

export function slackRedirectUri(): string {
  const base = (
    process.env.TOGARI_PUBLIC_BASE_URL || 'https://togari-bma-prod.up.railway.app'
  ).replace(/\/+$/, '');
  return `${base}/slack/oauth_callback`;
}

function sign(payload: string): string {
  return crypto
    .createHmac('sha256', requireEnv('SLACK_CLIENT_SECRET'))
    .update(`slack-install-state:${payload}`)
    .digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function signInstallState(clientId: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ c: clientId, e: now + STATE_TTL_MS, n: crypto.randomBytes(12).toString('hex') }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export type InstallStateCheck =
  | { ok: true; clientId: string }
  | { ok: false; reason: 'missing' | 'malformed' | 'bad_signature' | 'expired' };

export function verifyInstallState(state: string | undefined, now = Date.now()): InstallStateCheck {
  if (!state) return { ok: false, reason: 'missing' };
  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [payload, signature] = parts;
  if (!safeEqual(signature, sign(payload))) return { ok: false, reason: 'bad_signature' };

  let parsed: { c?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof parsed.c !== 'string' || typeof parsed.e !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (parsed.e < now) return { ok: false, reason: 'expired' };
  return { ok: true, clientId: parsed.c };
}

/** The link an admin of the client's workspace opens to install Togari. */
export function buildInstallUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv('SLACK_CLIENT_ID'),
    scope: SLACK_INSTALL_BOT_SCOPES.join(','),
    redirect_uri: slackRedirectUri(),
    state: signInstallState(clientId),
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

/** The parts of Slack's oauth.v2.access response we use. */
export interface OAuthV2AccessResponse {
  ok: boolean;
  error?: string;
  app_id?: string;
  access_token?: string;
  token_type?: string;
  scope?: string;
  bot_user_id?: string;
  team?: { id: string; name: string } | null;
  enterprise?: { id: string; name: string } | null;
  is_enterprise_install?: boolean;
  authed_user?: { id?: string };
}

/**
 * Trade the callback's one-time code for the workspace's bot token. The code
 * lasts ten minutes, so this runs inside the callback request. redirect_uri
 * has to match the one in the authorize URL.
 */
export async function exchangeInstallCode(code: string): Promise<OAuthV2AccessResponse> {
  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('SLACK_CLIENT_ID'),
      client_secret: requireEnv('SLACK_CLIENT_SECRET'),
      code,
      redirect_uri: slackRedirectUri(),
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Slack oauth.v2.access HTTP ${response.status}`);
  }
  return (await response.json()) as OAuthV2AccessResponse;
}
