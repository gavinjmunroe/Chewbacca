/**
 * Slack profile lookups — currently just timezone.
 *
 * Pulls the user's IANA timezone (e.g. "America/Los_Angeles") off their
 * Slack profile and caches it in-memory for 5 minutes so we don't burn
 * rate limit on a value that changes maybe once a year. Falls back to
 * "America/New_York" on every error path: missing bot token, missing
 * scope, network failure, malformed payload, AbortSignal timeout.
 *
 * Why ET as the fallback: matches Togari's documented default, and Medha
 * runs on Railway in UTC. Without a timezone anchor "next Wednesday" can
 * silently drift across midnight; ET is the least-bad guess when we have
 * nothing else.
 *
 * Used by the date/time resolver in lib/date-resolver.js as the
 * authoritative anchor for day-of-week math. Wire-up lives in
 * lib/transports/slack/envelope.js (baseMeta.timezone).
 */

const TZ_CACHE_TTL_MS = 5 * 60 * 1000;
const SLACK_USERS_INFO_URL = "https://slack.com/api/users.info";
const FETCH_TIMEOUT_MS = 3_000;
const DEFAULT_TIMEZONE = "America/New_York";

/** @type {Map<string, { tz: string, expiresAt: number }>} */
const tzCache = new Map();

/**
 * Resolve a Slack user's timezone via users.info, with a 5-minute
 * in-memory cache. Every failure mode collapses to DEFAULT_TIMEZONE so
 * callers can use the return value directly without null-checking.
 *
 * @param {string} slackUserId — the Slack user id (e.g. "U0ABC1234")
 * @param {string} botToken — xoxb-... bot token; usually
 *   process.env.SLACK_BOT_TOKEN
 * @returns {Promise<string>} IANA timezone string. Never throws.
 */
export async function getSlackProfileTimezone(slackUserId, botToken) {
  if (!slackUserId) return DEFAULT_TIMEZONE;

  const cached = tzCache.get(slackUserId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tz;
  }

  if (!botToken) {
    console.warn(
      `[slack-profile] no bot token; defaulting to ${DEFAULT_TIMEZONE} for ${slackUserId}`,
    );
    return DEFAULT_TIMEZONE;
  }

  try {
    const res = await fetch(
      `${SLACK_USERS_INFO_URL}?user=${encodeURIComponent(slackUserId)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${botToken}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      console.warn(
        `[slack-profile] users.info ${slackUserId} http=${res.status}`,
      );
      return DEFAULT_TIMEZONE;
    }
    const data = await res.json().catch(() => null);
    if (!data || data.ok !== true || !data.user?.tz) {
      console.warn(
        `[slack-profile] users.info ${slackUserId} missing tz error=${data?.error || "unknown"}`,
      );
      return DEFAULT_TIMEZONE;
    }
    const tz = String(data.user.tz);
    tzCache.set(slackUserId, { tz, expiresAt: Date.now() + TZ_CACHE_TTL_MS });
    return tz;
  } catch (err) {
    console.warn(
      `[slack-profile] users.info ${slackUserId} threw: ${err?.message || err}`,
    );
    return DEFAULT_TIMEZONE;
  }
}

/** Clear the in-memory timezone cache. Test-only. */
export function clearCache() {
  tzCache.clear();
}
