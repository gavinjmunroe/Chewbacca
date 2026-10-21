/**
 * WHERE PEOPLE ARE, READ BACK THROUGH WHAT THEY AGREED TO SHOW.
 *
 * ── THE ONE RULE THIS FILE EXISTS TO KEEP ────────────────────────────────────
 *
 * THE COARSENING HAPPENS IN THE SAME QUERY AS THE AUDIENCE CHECK. Not after it.
 * The finer place is never loaded, never returned by the database, never sits in
 * a variable next to a decision about whether the viewer may have it. That is
 * the same argument WITHIN_DEGREE_SQL and VIEWER_REACH_SQL are exported for:
 * "pulling every row and then checking reachability in JavaScript would mean
 * loading rows the viewer is not allowed to see, which is the shape of an
 * accident." It applies harder here, because the row being filtered IS the
 * sensitive value rather than a pointer to one.
 *
 * So `MAP_PLACE_REF_SQL` below is the SQL twin of `resolvePlaceRef` in
 * src/lib/geo.js, and a test asserts the two give the same answer for every
 * combination of place kind, recorded rollups and requested precision. Two
 * copies of a rule drift; two copies with a test between them do not.
 *
 * ── AUDIENCE, AND WHY NETWORK IS THE ODD ONE ─────────────────────────────────
 *
 * Circle, contact and cohort go through VIEWER_REACH_SQL exactly as notes and
 * shares do. `network` does not, because a location carries `max_degree` and
 * VIEWER_REACH_SQL's network leg only knows about a direct connection. So the
 * network leg is WITHIN_DEGREE_SQL, which walks 1 to 3 hops, and the two legs
 * are mutually exclusive on scope_type so neither can widen the other.
 */

import { query } from "./sql.js";
import { VIEWER_REACH_SQL } from "./viewer-reach.js";
import { WITHIN_DEGREE_SQL } from "./network-degree.js";
import {
  clampPrecision,
  DEFAULT_PRECISION,
  PRECISIONS,
  PLACE_REF_LADDER,
} from "../lib/geo.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

export const LOCATION_KINDS = Object.freeze(["home", "work", "current", "trip", "wish"]);

/** A precision word as a number, coarse to fine, inside SQL. */
const RANK_SQL = (expr) => `CASE ${expr}
  ${PRECISIONS.map((p, i) => `WHEN '${p}' THEN ${i}`).join("\n  ")}
  ELSE -1 END`;

/**
 * THE PLACE A VIEWER IS ACTUALLY SHOWN, as SQL.
 *
 * GENERATED FROM `PLACE_REF_LADDER`, the same array `resolvePlaceRef` walks in
 * src/lib/geo.js. The coarsening has to exist twice -- once for the write path
 * and once inside the read query, where it must run before the fine row can be
 * loaded -- and two hand-written copies of a safety rule is exactly how the
 * last authorization drift happened. So there is one array and two renderings
 * of it, and a test asserts this SQL names the same columns in the same order.
 *
 * Each rung guards on the row's own precision; the first rung is the named
 * place, whose rank is its `kind`. COALESCE takes the first non-null, so the
 * finest permitted candidate wins. All null means nothing is coarse enough,
 * and the caller INNER JOINs on this so the row disappears.
 *
 * The caller aliases `user_locations` as `s` and `places` as `p`.
 */
export const MAP_PLACE_REF_SQL = `COALESCE(\n  ${PLACE_REF_LADDER.map((rung) => {
  const rank = rung.rank == null ? RANK_SQL("p.kind") : String(rung.rank);
  const guard =
    rung.rank == null
      ? `${rank} >= 0 AND ${rank} <= ${RANK_SQL("s.precision")}`
      : `${rank} <= ${RANK_SQL("s.precision")}`;
  return `CASE WHEN ${guard} THEN p.${rung.column} END`;
}).join(",\n  ")}\n)`;

/**
 * May this viewer see this location row?
 *
 * Network walks up to the row's own max_degree; everything else is the ordinary
 * reach predicate. $1 is the viewer, and `s` is the location row -- which must
 * also expose `reach_owner` and `reach_degree`, hence the subselect in the
 * queries below rather than a bare `FROM user_locations s`.
 */
const LOCATION_REACH_SQL = `(
  (s.scope_type = 'network' AND ${WITHIN_DEGREE_SQL})
  OR (s.scope_type <> 'network' AND ${VIEWER_REACH_SQL})
)`;

/** user_locations with the two aliases WITHIN_DEGREE_SQL expects. */
const LIVE_LOCATIONS = `(
  SELECT ul.*, ul.owner_id AS reach_owner, ul.max_degree AS reach_degree
    FROM user_locations ul
   WHERE ul.deleted_at IS NULL
)`;

const MAP_COLUMNS = `
  s.id,
  s.owner_id            AS "ownerId",
  s.kind,
  s.label,
  s.starts_at           AS "startsAt",
  s.ends_at             AS "endsAt",
  rp.place_id           AS "placeId",
  rp.name               AS "placeName",
  rp.kind               AS "placeKind",
  rp.city, rp.region, rp.country,
  rp.lat, rp.lon,
  rp.metro_place_id     AS "metroPlaceId",
  u.full_name           AS "fullName",
  u.username,
  u.avatar_url          AS "avatarUrl"`;

/**
 * EVERY DOT THIS VIEWER MAY SEE.
 *
 * `at` filters to locations true at that moment; pass null for everything
 * including future trips, which is what a map with a time slider wants.
 */
export async function mapFor(viewerId, { at = new Date(), includeFuture = true } = {}) {
  const viewer = asUuid(viewerId);
  if (!viewer) return [];
  const when = at == null ? null : new Date(at).toISOString();

  // An undated row is always true. A dated row is true when `at` is inside it,
  // or -- with includeFuture -- when it has not started yet.
  const timeFilter =
    when == null
      ? "TRUE"
      : `(
          (s.starts_at IS NULL AND s.ends_at IS NULL)
          OR ((s.starts_at IS NULL OR s.starts_at <= $2::timestamptz)
              AND (s.ends_at IS NULL OR s.ends_at >= $2::timestamptz))
          ${includeFuture ? "OR (s.starts_at > $2::timestamptz)" : ""}
        )`;

  const params = when == null ? [viewer] : [viewer, when];
  const { rows } = await query(
    `SELECT ${MAP_COLUMNS}
       FROM ${LIVE_LOCATIONS} s
       JOIN places p  ON p.place_id = s.place_id
       -- INNER on purpose: a row with nothing coarse enough to show resolves to
       -- NULL here and drops out. A missing dot is a bug report; a dot that is
       -- too precise is an incident.
       JOIN places rp ON rp.place_id = ${MAP_PLACE_REF_SQL}
       JOIN users  u  ON u.amber_id = s.owner_id
      WHERE s.owner_id <> $1::uuid
        AND ${timeFilter}
        AND ${LOCATION_REACH_SQL}
      ORDER BY s.starts_at NULLS FIRST, u.full_name, s.id`,
    params,
  );
  return rows.map(shape);
}

/**
 * WHO YOU WILL BE IN THE SAME PLACE AS, AND WHEN.
 *
 * The payoff. Co-presence is an equality on the metro, never a radius: "are we
 * in the same place" has a crisp answer that does not drift when somebody picks
 * a suburb, and it needs no PostGIS -- which is why migration 008's "geog
 * arrives the day a radius query exists" is still true after this feature.
 *
 * Both sides are resolved through the audience check, so an overlap you are not
 * allowed to see is not an overlap you are told about.
 */
export async function overlapsFor(viewerId, { from = new Date(), days = 90 } = {}) {
  const viewer = asUuid(viewerId);
  if (!viewer) return [];
  const start = new Date(from).toISOString();
  const until = new Date(new Date(from).getTime() + days * 86400000).toISOString();

  const { rows } = await query(
    `WITH mine AS (
       SELECT ul.id, ul.place_id, ul.kind, ul.label, ul.starts_at, ul.ends_at,
              p.metro_place_id
         FROM user_locations ul
         JOIN places p ON p.place_id = ul.place_id
        WHERE ul.owner_id = $1::uuid AND ul.deleted_at IS NULL
          AND ul.kind <> 'wish'
          AND p.metro_place_id IS NOT NULL
          AND (ul.ends_at IS NULL OR ul.ends_at >= $2::timestamptz)
          AND (ul.starts_at IS NULL OR ul.starts_at <= $3::timestamptz)
     )
     SELECT ${MAP_COLUMNS},
            m.id          AS "myLocationId",
            m.kind        AS "myKind",
            m.label       AS "myLabel",
            m.starts_at   AS "myStartsAt",
            m.ends_at     AS "myEndsAt",
            GREATEST(COALESCE(s.starts_at, $2::timestamptz),
                     COALESCE(m.starts_at, $2::timestamptz)) AS "overlapFrom",
            LEAST(COALESCE(s.ends_at, $3::timestamptz),
                  COALESCE(m.ends_at, $3::timestamptz))      AS "overlapUntil"
       FROM ${LIVE_LOCATIONS} s
       JOIN places p  ON p.place_id = s.place_id
       JOIN places rp ON rp.place_id = ${MAP_PLACE_REF_SQL}
       JOIN users  u  ON u.amber_id = s.owner_id
       JOIN mine   m  ON m.metro_place_id = p.metro_place_id
      WHERE s.owner_id <> $1::uuid
        AND s.kind <> 'wish'
        -- Inclusive at the edges: two trips that touch on one day are two
        -- people in one city on that day, not a miss by a boundary condition.
        AND (s.ends_at   IS NULL OR m.starts_at IS NULL OR s.ends_at   >= m.starts_at)
        AND (m.ends_at   IS NULL OR s.starts_at IS NULL OR m.ends_at   >= s.starts_at)
        AND (s.ends_at   IS NULL OR s.ends_at   >= $2::timestamptz)
        AND (s.starts_at IS NULL OR s.starts_at <= $3::timestamptz)
        AND ${LOCATION_REACH_SQL}
      ORDER BY "overlapFrom", u.full_name`,
    [viewer, start, until],
  );
  return rows.map((r) => ({
    ...shape(r),
    mine: {
      id: r.myLocationId,
      kind: r.myKind,
      label: r.myLabel,
      startsAt: r.myStartsAt,
      endsAt: r.myEndsAt,
    },
    overlapFrom: r.overlapFrom,
    overlapUntil: r.overlapUntil,
  }));
}

/** Your own rows, uncoarsened, because they are yours. */
export async function listMyLocations(ownerId) {
  const owner = asUuid(ownerId);
  if (!owner) return [];
  const { rows } = await query(
    `SELECT ul.id, ul.kind, ul.precision, ul.scope_type AS "scopeType",
            ul.scope_ref AS "scopeRef", ul.max_degree AS "maxDegree",
            ul.starts_at AS "startsAt", ul.ends_at AS "endsAt", ul.label,
            p.place_id AS "placeId", p.name AS "placeName", p.kind AS "placeKind",
            p.city, p.region, p.country, p.lat, p.lon
       FROM user_locations ul
       JOIN places p ON p.place_id = ul.place_id
      WHERE ul.owner_id = $1::uuid AND ul.deleted_at IS NULL
      ORDER BY ul.starts_at NULLS FIRST, ul.created_at`,
    [owner],
  );
  return rows;
}

/**
 * Say where you are, or where you want to be.
 *
 * THE SCOPE MUST BE YOURS. A circle, contact or cohort id is checked against
 * the owner before the row is written, because a scope pointing at somebody
 * else's circle is a share addressed to an audience the sharer cannot see the
 * membership of, and there is no good reading of that.
 */
export async function setLocation(ownerId, input = {}) {
  const owner = asUuid(ownerId);
  if (!owner) throw Object.assign(new Error("owner required"), { code: "no_owner" });

  const placeId = asUuid(input.placeId);
  if (!placeId) throw Object.assign(new Error("placeId required"), { code: "bad_place" });

  const kind = LOCATION_KINDS.includes(input.kind) ? input.kind : null;
  if (!kind) throw Object.assign(new Error("bad kind"), { code: "bad_kind" });

  const scopeType = String(input.scopeType ?? "network");
  const scopeRef = scopeType === "network" ? null : asUuid(input.scopeRef);
  if (scopeType !== "network" && !scopeRef) {
    throw Object.assign(new Error("scopeRef required"), { code: "bad_scope" });
  }
  if (scopeRef && !(await scopeBelongsTo(owner, scopeType, scopeRef))) {
    throw Object.assign(new Error("scope is not yours"), { code: "bad_scope" });
  }

  // Unrecognized precision clamps to the COARSEST, never to the default. This
  // is the write path for whatever a client sends.
  const precision = input.precision == null
    ? DEFAULT_PRECISION
    : clampPrecision(input.precision);

  const maxDegree = Math.min(3, Math.max(1, Number(input.maxDegree) || 1));
  const startsAt = input.startsAt ? new Date(input.startsAt).toISOString() : null;
  const endsAt = input.endsAt ? new Date(input.endsAt).toISOString() : null;
  if (kind === "trip" && !startsAt) {
    throw Object.assign(new Error("a trip needs a start"), { code: "bad_dates" });
  }

  const { rows } = await query(
    `INSERT INTO user_locations
       (owner_id, place_id, kind, precision, scope_type, scope_ref, max_degree,
        starts_at, ends_at, label)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7, $8::timestamptz,
             $9::timestamptz, $10)
     ON CONFLICT (owner_id, kind, place_id, scope_type,
                  COALESCE(scope_ref, '00000000-0000-0000-0000-000000000000'::uuid))
       WHERE deleted_at IS NULL
     DO UPDATE SET precision  = EXCLUDED.precision,
                   max_degree = EXCLUDED.max_degree,
                   starts_at  = EXCLUDED.starts_at,
                   ends_at    = EXCLUDED.ends_at,
                   label      = EXCLUDED.label,
                   updated_at = now()
     RETURNING id`,
    [owner, placeId, kind, precision, scopeType, scopeRef, maxDegree,
     startsAt, endsAt, input.label ?? null],
  );
  return rows[0]?.id ?? null;
}

/** Retract. Soft, so an audit can still answer "what did they show, and when". */
export async function removeLocation(ownerId, id) {
  const owner = asUuid(ownerId);
  const locationId = asUuid(id);
  if (!owner || !locationId) return false;
  const { rowCount } = await query(
    `UPDATE user_locations SET deleted_at = now(), updated_at = now()
      WHERE id = $1::uuid AND owner_id = $2::uuid AND deleted_at IS NULL`,
    [locationId, owner],
  );
  return rowCount > 0;
}

/**
 * Find a place by what somebody typed.
 *
 * Trigram against name and aliases, exactly as migration 008 intended, and it
 * returns CANDIDATES rather than picking one. "missing someone beats filing
 * them in the wrong Austin" -- an ambiguous match is a question for the person,
 * not a guess for the resolver.
 */
export async function searchPlaces(text, { limit = 8 } = {}) {
  const q = String(text ?? "").trim();
  if (q.length < 2) return [];
  const { rows } = await query(
    `SELECT place_id AS "placeId", name, kind, city, region, country, lat, lon,
            similarity(name, $1) AS score
       FROM places
      WHERE name % $1 OR $1 = ANY (aliases) OR name ILIKE $1 || '%'
      ORDER BY (name ILIKE $1 || '%') DESC, score DESC, name
      LIMIT $2`,
    [q, Math.min(25, Math.max(1, limit))],
  );
  return rows;
}

async function scopeBelongsTo(owner, scopeType, scopeRef) {
  const table = { circle: "circles", contact: "contacts", cohort: "cohorts" }[scopeType];
  if (!table) return false;
  const { rows } = await query(
    `SELECT 1 FROM ${table}
      WHERE id = $1::uuid AND owner_id = $2::uuid AND deleted_at IS NULL LIMIT 1`,
    [scopeRef, owner],
  );
  return rows.length > 0;
}

function shape(r) {
  return {
    id: r.id,
    person: {
      amberId: r.ownerId,
      fullName: r.fullName ?? null,
      username: r.username ?? null,
      avatarUrl: r.avatarUrl ?? null,
    },
    kind: r.kind,
    label: r.label ?? null,
    startsAt: r.startsAt ?? null,
    endsAt: r.endsAt ?? null,
    place: {
      placeId: r.placeId,
      name: r.placeName,
      kind: r.placeKind ?? null,
      city: r.city ?? null,
      region: r.region ?? null,
      country: r.country ?? null,
      lat: r.lat ?? null,
      lon: r.lon ?? null,
      metroPlaceId: r.metroPlaceId ?? null,
    },
  };
}
