/**
 * @togari/transports/slack — Bot identity
 *
 * SLACK_BOT_USER_ID is NOT a configured env var anywhere in this repo.
 * To distinguish bot mentions from human replies in conversations.replies
 * (for getThreadContext), we fetch the bot's user_id via auth.test at
 * boot and cache in memory.
 *
 * The same auth.test reports the team the token belongs to, which is
 * Togari's home workspace (Amber Intelligence). Other workspaces can install
 * the app for their reply cards (see installations.ts), and the BMA-only
 * surfaces check requests against this id before doing anything.
 *
 * Single in-process cache. Tolerates concurrent boot calls (returns the
 * first in-flight promise to avoid duplicate auth.test calls).
 */

import { createLogger } from '../../observability/logger';

const logger = createLogger('slack/bot-identity');

let cachedBotUserId: string | null = null;
let cachedHomeTeamId: string | null = null;
let inflight: Promise<string> | null = null;

/**
 * Return the @Togari bot's Slack user_id. First call hits auth.test;
 * subsequent calls return the cached value. Throws if SLACK_BOT_TOKEN
 * isn't set or auth.test fails — callers should treat this as a fatal
 * boot-time problem (the runner can't filter bot mentions without it).
 */
export async function getBotUserId(): Promise<string> {
  if (cachedBotUserId) return cachedBotUserId;
  if (inflight) return inflight;

  inflight = (async () => {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      throw new Error('SLACK_BOT_TOKEN not set — cannot resolve bot user id');
    }

    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: '{}',
    });

    if (!res.ok) {
      throw new Error(`Slack auth.test HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      ok?: boolean;
      user_id?: string;
      team_id?: string;
      error?: string;
    };
    if (!data.ok || !data.user_id) {
      throw new Error(`Slack auth.test failed: ${data.error || 'unknown'}`);
    }
    cachedBotUserId = data.user_id;
    cachedHomeTeamId = data.team_id || null;
    logger.info('Resolved bot user id', {
      botUserId: cachedBotUserId,
      homeTeamId: cachedHomeTeamId,
    });
    return cachedBotUserId;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

/**
 * The team id of Togari's home workspace, the one SLACK_BOT_TOKEN belongs to.
 * Resolved by the same auth.test as the bot user id, retried here if boot
 * didn't manage it. Returns null rather than throwing when Slack can't be
 * reached, and callers treat null as "can't tell, let it through", so a
 * Slack hiccup at boot never locks BMA out of its own bot.
 */
export async function getHomeTeamId(): Promise<string | null> {
  if (cachedHomeTeamId) return cachedHomeTeamId;
  try {
    await getBotUserId();
  } catch (err) {
    logger.warn('Could not resolve the home Slack team id', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return cachedHomeTeamId;
}

/** Test-only: reset the cache. */
export function _resetBotUserIdCache(): void {
  cachedBotUserId = null;
  cachedHomeTeamId = null;
  inflight = null;
}

/** Test-only: pin the home team id without an auth.test round trip. */
export function _setHomeTeamIdForTests(teamId: string | null): void {
  cachedHomeTeamId = teamId;
}
