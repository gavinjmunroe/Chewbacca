/** Server-only integration staged for Amber ID. Never import into the mobile bundle. */
import { createHash } from 'node:crypto';
const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function sourceUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
export function normalizeEvents(payload) {
  if (!payload || typeof payload !== 'object' || payload.error) throw new Error('event_provider_error');
  if (payload.events_results !== undefined && !Array.isArray(payload.events_results)) throw new Error('invalid_event_response');
  const seen = new Set();
  return (payload.events_results ?? []).slice(0, 50).flatMap(event => {
    if (!event || typeof event !== 'object') return [];
    const title = text(event.title, 250), url = sourceUrl(event.link);
    if (!title || !url) return [];
    // Preserve provider date text. Do not invent a timezone or ISO date from a partial date.
    const date = text(event.date?.when || event.date?.start_date, 200) || 'Check the source for date and time';
    const id = createHash('sha256').update(`${url}|${title}|${date}`).digest('hex').slice(0, 24);
    if (seen.has(id)) return []; seen.add(id);
    return [{ id, title, date, address: Array.isArray(event.address) ? event.address.map(v => text(v, 200)).filter(Boolean).join(', ') : text(event.address, 300), url, source: 'Google Events · SerpApi' }];
  });
}
export async function searchLocalEvents({ query, city }, { apiKey, fetchImpl = fetch } = {}) {
  const q = text(query, 240), location = text(city, 120);
  if (!q || !location) throw new Error('query_and_city_required');
  if (!apiKey) throw new Error('event_provider_not_configured');
  const url = new URL('https://serpapi.com/search.json');
  url.search = new URLSearchParams({ engine: 'google_events', q, location, hl: 'en', api_key: apiKey }).toString();
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(12_000), redirect: 'error' });
  if (!response.ok) throw new Error('event_provider_error');
  return { events: normalizeEvents(await response.json()) };
}
/** Mount after wiring Amber ID's real session verifier and per-owner rate limiter. */
export function createLocalEventsHandler({ authenticate, rateLimit, apiKey, fetchImpl } = {}) {
  if (typeof authenticate !== 'function' || typeof rateLimit !== 'function') throw new Error('auth_and_rate_limit_required');
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const owner = await authenticate(req);
      if (typeof owner !== 'string' || !owner) return res.status(401).json({ error: 'unauthorized' });
      if (!(await rateLimit(owner))) return res.status(429).json({ error: 'rate_limited' });
      const query = req.query?.q, city = req.query?.city;
      if (typeof query !== 'string' || typeof city !== 'string' || !query.trim() || !city.trim() || query.length > 240 || city.length > 120) return res.status(400).json({ error: 'query_and_city_required' });
      return res.json(await searchLocalEvents({ query, city }, { apiKey, fetchImpl }));
    } catch (error) {
      const missing = error?.message === 'event_provider_not_configured';
      // Never echo upstream errors/URLs: request URLs contain the provider key.
      return res.status(missing ? 503 : 502).json({ error: missing ? 'event_provider_not_configured' : 'event_provider_unavailable' });
    }
  };
}
