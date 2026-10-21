/**
 * HOW FAR APART TWO PEOPLE ARE, AND WHO IS WITHIN REACH.
 *
 * Nothing in Amber could answer this before. `connections` is a flat table of
 * pairs, every query over it asked "are these two connected", and the answer
 * was yes or no. "Connections of connections" -- the thing that makes a network
 * a network rather than a contact list -- had no implementation at all, and
 * `network_visibility.max_depth` has been sitting in the schema since migration
 * 004 describing exactly this and reaching nothing.
 *
 * THREE HOPS, AND NOT FOUR. Three is the furthest anybody asked for, and it is
 * also where the arithmetic stops being kind: at an average of 150 connections
 * the first hop is 150 people, the second 22,500, the third 3.4 million, and
 * the fourth is everybody. A bound that is a product decision at depth 3
 * becomes a table scan at depth 4.
 *
 * BREADTH-FIRST, SO THE FIRST TIME A PERSON IS REACHED IS THEIR DEGREE. A
 * recursive CTE will happily find the same person again at depth 3 via a longer
 * path; `SELECT DISTINCT ON (amber_id) ... ORDER BY degree` keeps the shortest,
 * which is what "second-degree" means. Without it somebody directly connected
 * to you also appears as a third-degree contact and any rule keyed on degree
 * fires twice with two different answers.
 *
 * THE SEED IS NEVER IN THE RESULT. You are not your own second-degree contact,
 * and a matcher that forgets this proposes that somebody meet themselves.
 */

import { query } from "./sql.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

/** The furthest this will ever walk. See the header for why it is 3. */
export const MAX_DEGREE = 3;

export function clampDegree(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_DEGREE, Math.trunc(n)));
}

/**
 * THE TRAVERSAL, as one recursive CTE.
 *
 * `connections` stores each pair once with a < b (there is a CHECK constraint
 * saying so), so every hop has to consider both directions -- the UNION of the
 * two joins below is not redundancy, it is the price of canonical ordering.
 *
 * `cn.status = 'active'` is applied at every hop rather than once at the end:
 * a path that runs through a pending or severed connection is not a path.
 *
 * $1 seed, $2 max depth.
 */
const REACHABLE_SQL = `
  WITH RECURSIVE walk(amber_id, degree) AS (
    SELECT $1::uuid, 0
    UNION ALL
    SELECT nxt.amber_id, w.degree + 1
      FROM walk w
      CROSS JOIN LATERAL (
        SELECT cn.b_amber_id AS amber_id
          FROM connections cn
         WHERE cn.a_amber_id = w.amber_id AND cn.status = 'active'
        UNION
        SELECT cn.a_amber_id AS amber_id
          FROM connections cn
         WHERE cn.b_amber_id = w.amber_id AND cn.status = 'active'
      ) nxt
     WHERE w.degree < $2::int
  )
  SELECT DISTINCT ON (amber_id) amber_id, degree
    FROM walk
   WHERE amber_id <> $1::uuid
   ORDER BY amber_id, degree ASC
`;

/**
 * Everyone within `maxDegree` hops of `seed`, with their shortest degree.
 *
 * Returns a Map of amber_id -> degree (1, 2 or 3). Empty on any failure, which
 * is the fail-closed direction: an error here must not widen an audience.
 */
export async function reachableFrom(seedId, maxDegree = 1) {
  const seed = asUuid(seedId);
  if (!seed) return new Map();
  const depth = clampDegree(maxDegree);
  try {
    const { rows } = await query(REACHABLE_SQL, [seed, depth]);
    return new Map(rows.map((r) => [String(r.amber_id), Number(r.degree)]));
  } catch {
    return new Map();
  }
}

/**
 * How far apart two people are, or null when further than `maxDegree`.
 *
 * Stops as soon as the target is reached rather than expanding the whole
 * frontier: the recursive term carries a flag once `b` has been seen and the
 * WHERE clause refuses to go deeper. On a dense graph the difference between
 * this and walking all three hops is three million rows.
 */
export async function degreeBetween(aId, bId, maxDegree = MAX_DEGREE) {
  const a = asUuid(aId);
  const b = asUuid(bId);
  if (!a || !b) return null;
  if (a === b) return 0;
  const depth = clampDegree(maxDegree);
  try {
    const { rows } = await query(
      `WITH RECURSIVE walk(amber_id, degree) AS (
         SELECT $1::uuid, 0
         UNION ALL
         SELECT nxt.amber_id, w.degree + 1
           FROM walk w
           CROSS JOIN LATERAL (
             SELECT cn.b_amber_id AS amber_id FROM connections cn
              WHERE cn.a_amber_id = w.amber_id AND cn.status = 'active'
             UNION
             SELECT cn.a_amber_id AS amber_id FROM connections cn
              WHERE cn.b_amber_id = w.amber_id AND cn.status = 'active'
           ) nxt
          WHERE w.degree < $3::int
       )
       SELECT min(degree)::int AS degree FROM walk WHERE amber_id = $2::uuid AND degree > 0`,
      [a, b, depth],
    );
    const d = rows[0]?.degree;
    return Number.isFinite(Number(d)) ? Number(d) : null;
  } catch {
    return null;
  }
}

/**
 * SQL that says "this viewer is within N hops of this owner", for embedding in
 * a larger query.
 *
 * Exported as text for the same reason VIEWER_REACH_SQL is: the matcher has to
 * apply this INSIDE the query that finds candidates, not as a filter afterwards.
 * Pulling every intent and then checking reachability in JavaScript would mean
 * loading intents the viewer is not allowed to see, which is the shape of an
 * accident.
 *
 * The caller binds $1 = viewer, and aliases the owner column as `reach_owner`.
 */
export const WITHIN_DEGREE_SQL = `
  EXISTS (
    WITH RECURSIVE w(amber_id, degree) AS (
      SELECT $1::uuid, 0
      UNION ALL
      SELECT nxt.amber_id, w.degree + 1
        FROM w
        CROSS JOIN LATERAL (
          SELECT cn.b_amber_id AS amber_id FROM connections cn
           WHERE cn.a_amber_id = w.amber_id AND cn.status = 'active'
          UNION
          SELECT cn.a_amber_id AS amber_id FROM connections cn
           WHERE cn.b_amber_id = w.amber_id AND cn.status = 'active'
        ) nxt
       WHERE w.degree < reach_degree
    )
    SELECT 1 FROM w WHERE w.amber_id = reach_owner AND w.degree > 0
  )
`;
