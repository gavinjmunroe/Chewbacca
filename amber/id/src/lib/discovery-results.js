import { createHash } from 'node:crypto';
import { safeLinkedIn } from './clay-public.js';

const text = (value, max = 300) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export function publicUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port ||
        !u.hostname.includes('.') || /(^|\.)(localhost|local|internal|test)$/.test(u.hostname) ||
        /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) return null;
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
    }
    if (/(^|\.)linkedin\.com$/.test(u.hostname)) { u.hostname = 'www.linkedin.com'; u.search = ''; }
    return u.href.replace(/\/$/, '');
  } catch { return null; }
}
const cityKey = (s) => text(s).split(',')[0].normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const string = { type: 'string' };
const optionalString = { type: ['string', 'null'] };
export function discoverySchema(scope) {
  const properties = scope === 'people'
    ? { kind: { const: 'person' }, name: string, title: string, company: string, location: string, summary: string, url: string }
    : { kind: { const: 'event' }, name: string, summary: string, url: string, city: string, region: string, country: string, venue: string, date: string, startsAt: optionalString, endsAt: optionalString, timezone: string };
  return { type: 'object', additionalProperties: false, required: ['results'], properties: {
    results: { type: 'array', maxItems: 10, items: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties } },
  } };
}
function planFields(row, input, now) {
  if (row.kind !== 'event' || !input.location || cityKey(row.city) !== cityKey(input.location)) return null;
  const requestedParts = input.location.split(',').slice(1).map(cityKey).filter(Boolean);
  const resultParts = [cityKey(row.region), cityKey(row.country)];
  if (requestedParts.some(part => !resultParts.includes(part))) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date || '')) return null;
  const date = Date.parse(row.date);
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0,10) !== row.date) return null;
  if (date < now - 86400000 || date > now + 366 * 86400000) return null;
  if (!text(row.venue) || !text(row.timezone)) return null;
  try { new Intl.DateTimeFormat('en', { timeZone: row.timezone }); } catch { return null; }
  const instant = (v) => typeof v === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
  if (row.startsAt != null && (!instant(row.startsAt) || Date.parse(row.startsAt) < now)) return null;
  if (row.endsAt != null && (!row.startsAt || !instant(row.endsAt) || Date.parse(row.endsAt) <= Date.parse(row.startsAt))) return null;
  if (row.startsAt) {
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone:row.timezone, year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(row.startsAt));
    const part = (name) => parts.find(p => p.type === name)?.value;
    if (`${part('year')}-${part('month')}-${part('day')}` !== row.date) return null;
  }
  return { city: text(row.city), region: text(row.region), country: text(row.country), location: text(row.city), venue: text(row.venue), date: row.date,
    startsAt: row.startsAt ? new Date(row.startsAt).toISOString() : null,
    endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : null, timezone: row.timezone };
}
/** Accept only source-backed typed entities, never generic webpages or prose. */
export function searchResults(data, input, now = Date.now()) {
  if (data?.status !== 'completed' || !Array.isArray(data.output)) throw Error('search_unavailable');
  const sources = new Set(data.output.flatMap(item => Array.isArray(item.results) ? item.results.map(r => publicUrl(r.url)) : []).filter(Boolean));
  const content = data.output.filter(item => item.type === 'message' && item.role === 'assistant')
    .flatMap(item => item.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('');
  let payload;
  try { payload = JSON.parse(content); } catch { throw Error('search_unavailable'); }
  if (!Array.isArray(payload?.results)) throw Error('search_unavailable');
  const seen = new Set();
  return payload.results.flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const url = publicUrl(row.url), name = text(row.name, 200);
    if (!url || !sources.has(url) || !name) return [];
    const fields = input.scope === 'people'
      ? row.kind === 'person' && safeLinkedIn(url) ? { linkedin: url, title: text(row.title), company: text(row.company), location: text(row.location) } : null
      : planFields(row, input, now);
    if (!fields) return [];
    const identity = input.scope === 'people' ? url.toLowerCase().replace('://www.', '://') : `${url}:${row.date}:${fields.startsAt || ''}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [{ id: createHash('sha256').update(identity).digest('hex').slice(0,32), kind: row.kind, name,
      summary: text(row.summary, 600), url, source: new URL(url).hostname, provider: 'perplexity', ...fields }];
  }).slice(0,10);
}
