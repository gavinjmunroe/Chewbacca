/**
 * @togari/transports/slack — User (xoxp) token client
 *
 * Companion to the bot token used everywhere else in this transport.
 * SLACK_BOT_TOKEN (xoxb-) acts as @Togari; SLACK_USER_TOKEN (xoxp-) acts
 * as the human who installed the app. Reach for the user token ONLY for
 * the handful of Slack APIs a bot token cannot call — search.messages,
 * for instance, or posting/editing as a real person rather than the bot.
 * Everything else should keep using the bot token: the user token carries
 * that person's full access, so its blast radius is much larger.
 *
 * The token is NOT obtained through an OAuth callback. This is a
 * single-workspace internal app: Slack hands you the User OAuth Token on
 * the app's "OAuth & Permissions" page once user scopes are declared and
 * the app is reinstalled. See docs/SLACK_USER_TOKEN.md.
 */

import { WebClient } from '@slack/web-api';
import { createLogger } from '../../observability/logger';

const logger = createLogger('slack/user-client');

let userClient: WebClient | null = null;

/** True when a user token is configured. Callers that can degrade
 *  gracefully should check this instead of catching the throw below. */
export function hasSlackUserToken(): boolean {
  return Boolean(process.env.SLACK_USER_TOKEN);
}

/**
 * Return the raw xoxp- token. Throws when unset, or when what's set is
 * obviously the wrong kind of token — pasting the xoxb- bot token here is
 * the common slip, and it fails much later with an opaque
 * `not_allowed_token_type` from whichever API actually needed the user token.
 */
export function getSlackUserToken(): string {
  const token = process.env.SLACK_USER_TOKEN;
  if (!token) {
    throw new Error(
      'SLACK_USER_TOKEN not set — add the xoxp- User OAuth Token from the ' +
        "Slack app's OAuth & Permissions page to Railway and redeploy.",
    );
  }
  if (!token.startsWith('xoxp-')) {
    throw new Error(
      `SLACK_USER_TOKEN must be a user token (xoxp-), got "${token.slice(0, 5)}…". ` +
        'The xoxb- bot token belongs in SLACK_BOT_TOKEN.',
    );
  }
  return token;
}

/** Lazily-constructed WebClient authed as the installing user. */
export function getSlackUserClient(): WebClient {
  if (!userClient) {
    userClient = new WebClient(getSlackUserToken());
  }
  return userClient;
}

/**
 * Confirm the token works and report who it acts as. Returns null rather
 * than throwing when no token is configured, so boot paths can call it
 * unconditionally.
 */
export async function checkSlackUserToken(): Promise<
  { userId: string; user: string; teamId: string; team: string } | null
> {
  if (!hasSlackUserToken()) return null;

  const res = await getSlackUserClient().auth.test();
  if (!res.ok) {
    throw new Error(`Slack auth.test failed for user token: ${res.error ?? 'unknown'}`);
  }
  const identity = {
    userId: String(res.user_id),
    user: String(res.user),
    teamId: String(res.team_id),
    team: String(res.team),
  };
  logger.info('Slack user token resolved', identity);
  return identity;
}

/** Test-only: drop the cached client so a new env value takes effect. */
export function _resetSlackUserClient(): void {
  userClient = null;
}
