/**
 * Slack profile lookups — currently just timezone.
 * Cached in-memory for 5 minutes to avoid rate limits and pointless API calls.
 */
import { createLogger } from '../../observability/logger';

const logger = createLogger('core/slack-profile');

interface CachedTz {
  tz: string;
  expiresAt: number;
}

const tzCache = new Map<string, CachedTz>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Returns the user's timezone from their Slack profile (e.g. 'America/Los_Angeles').
 * Falls back to 'America/New_York' on any error or missing data.
 * Updates dynamically — when the user changes their Slack profile timezone,
 * this picks it up after the cache TTL expires.
 */
export async function getUserTimezone(slackUserId: string): Promise<string> {
  if (!slackUserId) return 'America/New_York';

  const cached = tzCache.get(slackUserId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tz;
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    logger.warn('SLACK_BOT_TOKEN not set, defaulting to ET', { slackUserId });
    return 'America/New_York';
  }

  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json() as any;
    if (!data.ok || !data.user?.tz) {
      logger.warn('users.info returned no tz, defaulting to ET', { slackUserId, error: data.error });
      return 'America/New_York';
    }
    const tz = data.user.tz as string;
    tzCache.set(slackUserId, { tz, expiresAt: Date.now() + CACHE_TTL_MS });
    return tz;
  } catch (err) {
    logger.warn('users.info fetch failed, defaulting to ET', { slackUserId, error: err instanceof Error ? err.message : err });
    return 'America/New_York';
  }
}

/** Clear the in-memory tz cache. Test-only. */
export function _clearTimezoneCache(): void {
  tzCache.clear();
}
