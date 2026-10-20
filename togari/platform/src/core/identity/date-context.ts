/**
 * @togari/core/identity — Shared date / time-zone helpers for LLM prompts.
 *
 * Two responsibilities:
 *
 *   1. `buildDateContext(timezone, now?)` — emits a one-line string that
 *      every LLM system prompt should prepend so the model has an
 *      unambiguous anchor for "today", "this week", and weekday math.
 *      The TZ-aware ISO date is included alongside the long-form so
 *      models that prefer one over the other always have it.
 *
 *   2. `isoLocalToUnix(isoLocal, timezone)` — converts an ISO-local
 *      datetime string (no TZ suffix) interpreted in `timezone` to a
 *      Unix epoch in seconds. Used by reminder scheduling so we never
 *      ask the LLM to do integer timestamp arithmetic.
 *
 * Both helpers rely on Intl.DateTimeFormat for TZ math — Date.getDay() /
 * Date.getHours() are intentionally NOT used because they return UTC
 * values on Railway and silently shift around midnight.
 */

/**
 * Returns a one-line string suitable for injecting into any LLM system prompt
 * so the model has an unambiguous anchor for "today", "this week", and weekday math.
 * Always computed in the requester's IANA timezone.
 */
export function buildDateContext(timezone: string, now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const year = parts.find((p) => p.type === 'year')?.value ?? '';

  const isoDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  return `Today is ${weekday}, ${month} ${day}, ${year} (${isoDate}). All relative dates ("this week", "next Monday", "tomorrow") MUST be resolved against this date in the ${timezone} timezone. Never use a date from your training data.`;
}

/**
 * Converts an ISO-local datetime string (no TZ suffix) in the given IANA timezone
 * to a Unix epoch in seconds. Throws if the string is malformed.
 *
 * Accepts: "YYYY-MM-DDTHH:MM:SS" or "YYYY-MM-DDTHH:MM" (seconds optional).
 */
export function isoLocalToUnix(isoLocal: string, timezone: string): number {
  // Pretend the string is UTC to get a first-cut instant, then compute
  // the offset of the target zone at that wall-clock instant and rebase.
  // This is the standard "interpret as local wall time in a specific TZ" trick.
  const normalized = /T\d{2}:\d{2}$/.test(isoLocal) ? `${isoLocal}:00` : isoLocal;
  const asUtc = new Date(`${normalized}Z`);
  if (isNaN(asUtc.getTime())) {
    throw new Error(`Invalid ISO-local datetime: ${isoLocal}`);
  }

  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = tzFormatter.formatToParts(asUtc);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  // Intl's hourCycle for h23 returns "24" at midnight on some Node versions; normalize.
  const hour = get('hour') === '24' ? '00' : get('hour');
  const tzWall = `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}Z`;
  const tzWallMs = new Date(tzWall).getTime();
  const offsetMs = tzWallMs - asUtc.getTime();
  return Math.floor((asUtc.getTime() - offsetMs) / 1000);
}
