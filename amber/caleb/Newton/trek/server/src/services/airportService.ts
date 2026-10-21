import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/database';

export interface Airport {
  iata: string;
  icao: string | null;
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  tz: string;
}

let cache: Airport[] | null = null;
let byIata: Map<string, Airport> | null = null;

function load(): Airport[] {
  if (cache) return cache;
  const file = path.join(__dirname, '..', '..', 'assets', 'airports.json');
  if (!fs.existsSync(file)) {
    console.warn('[airports] airports.json missing — run `node scripts/build-airports.mjs`');
    cache = [];
    byIata = new Map();
    return cache;
  }
  const raw = fs.readFileSync(file, 'utf8');
  cache = JSON.parse(raw) as Airport[];
  byIata = new Map(cache.map(a => [a.iata, a]));
  return cache;
}

export function findByIata(code: string): Airport | null {
  load();
  return byIata!.get(code.toUpperCase()) ?? null;
}

export function searchAirports(query: string, limit = 12): Airport[] {
  const all = load();
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const upper = q.toUpperCase();
  if (q.length === 3) {
    const exact = byIata!.get(upper);
    if (exact) return [exact];
  }

  const matches: Array<{ a: Airport; score: number }> = [];
  for (const a of all) {
    let score = 0;
    if (a.iata === upper) score = 100;
    else if (a.icao === upper) score = 90;
    else if (a.iata.startsWith(upper)) score = 70;
    else if (a.city.toLowerCase().startsWith(q)) score = 60;
    else if (a.name.toLowerCase().startsWith(q)) score = 50;
    else if (a.city.toLowerCase().includes(q)) score = 30;
    else if (a.name.toLowerCase().includes(q)) score = 20;
    if (score > 0) matches.push({ a, score });
  }
  matches.sort((x, y) => y.score - x.score || x.a.iata.localeCompare(y.a.iata));
  return matches.slice(0, limit).map(m => m.a);
}

export function backfillFlightEndpoints(): void {
  const pending = db.prepare(`
    SELECT r.id, r.metadata, r.reservation_time, r.reservation_end_time
    FROM reservations r
    WHERE r.type = 'flight'
      AND NOT EXISTS (SELECT 1 FROM reservation_endpoints e WHERE e.reservation_id = r.id)
  `).all() as { id: number; metadata: string | null; reservation_time: string | null; reservation_end_time: string | null }[];

  if (pending.length === 0) return;

  load();
  const insert = db.prepare(`
    INSERT INTO reservation_endpoints (reservation_id, role, sequence, name, code, lat, lng, timezone, local_time, local_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const markReview = db.prepare('UPDATE reservations SET needs_review = 1 WHERE id = ?');

  let filled = 0;
  let flagged = 0;
  for (const r of pending) {
    if (!r.metadata) { markReview.run(r.id); flagged++; continue; }
    let meta: any;
    try { meta = JSON.parse(r.metadata); } catch { markReview.run(r.id); flagged++; continue; }

    const dep = meta.departure_airport ? findByIata(String(meta.departure_airport).slice(0, 3)) : null;
    const arr = meta.arrival_airport ? findByIata(String(meta.arrival_airport).slice(0, 3)) : null;

    if (!dep || !arr) { markReview.run(r.id); flagged++; continue; }

    const split = (iso: string | null) => {
      if (!iso) return { date: null as string | null, time: null as string | null };
      const [date, time] = iso.split('T');
      return { date: date || null, time: time ? time.slice(0, 5) : null };
    };
    const depParts = split(r.reservation_time);
    const arrParts = split(r.reservation_end_time);

    insert.run(r.id, 'from', 0, dep.city ? `${dep.city} (${dep.iata})` : dep.name, dep.iata, dep.lat, dep.lng, dep.tz, depParts.time, depParts.date);
    insert.run(r.id, 'to', 1, arr.city ? `${arr.city} (${arr.iata})` : arr.name, arr.iata, arr.lat, arr.lng, arr.tz, arrParts.time, arrParts.date);
    filled++;
  }

  console.log(`[airports] Backfill: ${filled} filled, ${flagged} flagged for review`);
}
