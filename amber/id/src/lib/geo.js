/**
 * THE RULES FOR SHOWING SOMEBODY WHERE SOMEBODY ELSE IS.
 *
 * Pure. No database, no network, no model. Every decision this file makes is
 * arithmetic over a place row and a precision word, which means the same inputs
 * give the same answer forever and a wrong answer is a line you can point at.
 *
 * ── WHY COARSENING IS A LOOKUP AND NOT A ROUNDING ────────────────────────────
 *
 * The obvious way to show somebody a coarse location is to round the precise
 * one: knock the decimals off a latitude and call it a city. It is also the
 * wrong way, and the reason is not hypothetical. Rounding leaves the true point
 * inside a box whose size you published, so somebody who sees your location at
 * two different precisions -- your network's view and your circle's view --
 * intersects two boxes and gets a smaller one than either. Do it three times
 * and the boxes meet over a building.
 *
 * So there is no rounding here. Coarsening means POINTING AT A DIFFERENT PLACE:
 * a real row in `places` that existed before anybody stood in it, whose centroid
 * is identical for every single person who shares at that level. Two people in
 * Chicago at metro precision are drawn at the same pixel, and that pixel is
 * Chicago's, not either of theirs. Intersecting it with anything yields
 * Chicago.
 *
 * ── AND WHY IT FAILS COARSE ──────────────────────────────────────────────────
 *
 * A place with no metro recorded, asked for at metro precision, does NOT fall
 * back to itself. Falling back to the stated place is falling back to the FINER
 * one, which is the single way this design can leak: a neighborhood row with a
 * missing rollup would quietly publish the neighborhood to an audience that was
 * promised a city. So the fallback walks the other way -- metro, then region,
 * then country -- and when nothing coarse enough exists the location is not
 * shown at all. A dot that is missing is a bug report. A dot that is too precise
 * is an incident.
 */

/** Coarse to fine. Index is the rank; nothing outside this list is a precision. */
export const PRECISIONS = Object.freeze(["country", "region", "metro", "neighborhood"]);

/** The coarsest there is, and therefore what anything unrecognized becomes. */
export const COARSEST = PRECISIONS[0];

/** What a row defaults to when the person did not choose: a city, not a street. */
export const DEFAULT_PRECISION = "metro";

/** Rank of a precision word, or -1. Higher is finer. */
export function precisionRank(precision) {
  return PRECISIONS.indexOf(String(precision ?? "").trim().toLowerCase());
}

/**
 * A precision word this code is willing to act on.
 *
 * Anything unrecognized becomes the COARSEST rather than the default, because
 * this is the function that runs on input nobody checked. A typo in a client
 * must not widen what it shows.
 */
export function clampPrecision(precision) {
  const rank = precisionRank(precision);
  return rank < 0 ? COARSEST : PRECISIONS[rank];
}

/** Of two precisions, the one that reveals less. */
export function coarserOf(a, b) {
  const ra = precisionRank(a);
  const rb = precisionRank(b);
  if (ra < 0) return clampPrecision(b);
  if (rb < 0) return clampPrecision(a);
  return ra <= rb ? PRECISIONS[ra] : PRECISIONS[rb];
}

/** Of two precisions, the one that reveals more. Used to pick a viewer's best view. */
export function finerOf(a, b) {
  const ra = precisionRank(a);
  const rb = precisionRank(b);
  if (ra < 0) return clampPrecision(b);
  if (rb < 0) return clampPrecision(a);
  return ra >= rb ? PRECISIONS[ra] : PRECISIONS[rb];
}

/**
 * THE COARSENING LADDER, WRITTEN ONCE.
 *
 * Finest candidate first. `field`/`column` null means the named place itself,
 * whose rank is its own `kind` rather than a fixed number -- a metro row asked
 * for at neighborhood precision is still the metro.
 *
 * `resolvePlaceRef` below walks this, and src/db/locations-store.js GENERATES
 * its SQL COALESCE from the same array. That is deliberate: the coarsening has
 * to exist twice, once for the write path and once inside the read query where
 * it runs before the fine row can be loaded, and two hand-written copies of a
 * safety rule is how the last authorization drift happened. One array, two
 * renderings, one test.
 */
export const PLACE_REF_LADDER = Object.freeze([
  Object.freeze({ rank: null, field: "placeId", column: "place_id" }),
  Object.freeze({ rank: 2, field: "metroPlaceId", column: "metro_place_id" }),
  Object.freeze({ rank: 1, field: "regionPlaceId", column: "region_place_id" }),
  Object.freeze({ rank: 0, field: "countryPlaceId", column: "country_place_id" }),
]);

/**
 * WHICH PLACE TO ACTUALLY DRAW, given the place somebody named and the
 * precision they are being shown at.
 *
 * `place` is a row from `places`: { placeId, kind, metroPlaceId, regionPlaceId,
 * countryPlaceId }. Returns a place id, or null when nothing coarse enough is
 * recorded -- in which case the caller shows NOTHING. See the header.
 */
export function resolvePlaceRef(place, precision) {
  if (!place?.placeId) return null;
  const want = precisionRank(clampPrecision(precision));

  for (const rung of PLACE_REF_LADDER) {
    const id = place[rung.field];
    if (!id) continue;
    const rank = rung.rank == null ? precisionRank(place.kind) : rung.rank;
    if (rank < 0 || rank > want) continue;
    return id;
  }

  // Nothing coarse enough is recorded. The caller shows NOTHING rather than
  // falling back to the named place, which would be falling back to the finer
  // one -- the single way this design can leak. See the header.
  return null;
}

/**
 * Do two time windows overlap? A null bound is open in that direction.
 *
 * Inclusive at the edges on purpose: two people whose trips touch on the same
 * day are in the same city on that day, and a half-open interval would say they
 * missed each other by a boundary condition nobody experienced.
 */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  const as = toTime(aStart);
  const ae = toTime(aEnd);
  const bs = toTime(bStart);
  const be = toTime(bEnd);
  if (ae != null && bs != null && ae < bs) return false;
  if (be != null && as != null && be < as) return false;
  return true;
}

/** Is this location row true at this moment? Undated rows are always true. */
export function activeAt({ startsAt = null, endsAt = null } = {}, when = Date.now()) {
  const t = toTime(when);
  if (t == null) return false;
  const s = toTime(startsAt);
  const e = toTime(endsAt);
  if (s != null && t < s) return false;
  if (e != null && t > e) return false;
  return true;
}

function toTime(value) {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Kilometers between two centroids.
 *
 * FOR DISPLAY ONLY -- "about 40km away" under a dot. Nothing is ever authorized
 * on this number, and co-presence is decided by equality on a metro id rather
 * than by a radius, which is why this file needs no PostGIS and why migration
 * 008's "geog arrives with PostGIS the day a radius query exists" is still
 * true.
 */
export function haversineKm(a, b) {
  if (!isPoint(a) || !isPoint(b)) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function isPoint(p) {
  return Number.isFinite(p?.lat) && Number.isFinite(p?.lon) &&
    Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
}

/**
 * Are these two places the same metro?
 *
 * This is the whole co-presence test. Not a radius: "are we in the same place"
 * is the question people actually ask, it has a crisp answer, and it does not
 * drift when somebody picks a suburb instead of the city.
 */
export function sameMetro(a, b) {
  const am = a?.metroPlaceId ?? (a?.kind === "metro" ? a?.placeId : null);
  const bm = b?.metroPlaceId ?? (b?.kind === "metro" ? b?.placeId : null);
  return Boolean(am && bm && am === bm);
}
