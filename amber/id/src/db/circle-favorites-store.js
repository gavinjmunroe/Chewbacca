/**
 * Cloud SQL store for PINNED CIRCLES — the handful the user wants on their
 * profile, in the order they dragged them into.
 *
 * SCHEMA: db/migrations/20260908_032_circle_favorites.sql. This module creates
 * nothing.
 *
 * A deliberate mirror of db/favorites-store.js, which does the same job for
 * contacts. Where that file carries a scar, this one carries the lesson:
 *
 *   - THE JOIN IS ON THE COMPOSITE KEY and both sides are uuid, so there is no
 *     uuid = text comparison to fail. contact_favorites was originally written
 *     with owner_id as text against contacts.owner_id as uuid, which is not an
 *     operator at all: the join never returned a row, and a swallowed catch
 *     made a broken query look like an empty favorites list for weeks.
 *
 *   - A PIN THAT CANNOT BE READ BACK IS NOT A SUCCESS. pinCircle verifies the
 *     circle exists, is this owner's, and is not deleted BEFORE inserting,
 *     because the read INNER JOINs circles — so a stale id would insert
 *     happily, the API would answer ok, the app would say "Pinned", and the row
 *     would be invisible forever.
 *
 *   - READS FAIL LOUDLY, WRITES FAIL QUIETLY. A read that throws lets the app
 *     render "couldn't load"; a read that returns [] claims "you have none",
 *     which is a different sentence. Writes return false and log, because the
 *     caller has a user waiting on a toast.
 *
 * SECURITY INVARIANT: every statement is scoped by owner_id in its WHERE (or by
 * the composite FK on insert). No function accepts an owner from a caller.
 */

import { query } from "./sql.js";
import { queryWithOptionalColumn } from "./optional-column.js";

/**
 * THE CAP. Nine, because the grid is three by three and a grid that scrolls is
 * not a set of pins any more, it is the circles list again — which is directly
 * below it on the profile.
 *
 * Enforced in the ROUTE, not here: pinning is an upsert, so re-pinning
 * something already in the nine must not be refused for being over the limit.
 * The route knows which case it is; this module just counts.
 */
export const MAX_PINNED_CIRCLES = 9;

/**
 * This owner's pinned circles, hand-arranged order first.
 *
 * `ORDER BY position ASC NULLS LAST, created_at DESC` is what lets placed and
 * unplaced coexist with no backfill: anything the user has dragged leads, in
 * their order, and anything merely pinned trails newest-first.
 *
 * Joined to `circles` so the client renders name, color and counts without a
 * second call, and so a pin whose circle was soft-deleted drops out rather than
 * rendering as a blank tile.
 */
export async function listPinnedCircles(ownerId) {
  if (!ownerId) return [];
  // A MEMBER PREVIEW, NOT JUST A COUNT.
  //
  // The pinned tile draws the circle's mark, and that mark plots MEMBERS on a
  // ring -- so a payload carrying only `memberCount` left the grid with nothing
  // to draw and it fell back to a decorative lens on every tile. Thirty names is
  // what the emblem can show before it collapses the rest into a "+N" slot.
  //
  // The counting moved into the same LATERAL rather than staying an outer
  // aggregate: a GROUP BY in the outer query would have to include the json
  // column, and json has no equality operator to group by. One subquery answers
  // both questions and the outer query needs no grouping at all.
  // ci.kind_tag is additive (034); the tile draws without it. See
  // optional-column.js -- a pending migration already blanked this grid once.
  const { rows } = await queryWithOptionalColumn(
    "circles.kind_tag",
    (has) => `SELECT f.circle_id,
            f.position,
            ci.name,
            ci.color,
            ci.classified_kind,
            ${has ? "ci.kind_tag," : "NULL::text AS kind_tag,"}
            mem.member_count,
            mem.members
       FROM circle_favorites f
       JOIN circles ci
         ON ci.id = f.circle_id
        AND ci.owner_id = f.owner_id
        AND ci.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS member_count,
                COALESCE(
                  (SELECT jsonb_agg(
                            jsonb_build_object('id', x.contact_id::text, 'name', x.full_name))
                     FROM (SELECT cm2.contact_id, c2.full_name
                             FROM circle_members cm2
                             JOIN contacts c2
                               ON c2.id = cm2.contact_id
                              AND c2.deleted_at IS NULL
                            WHERE cm2.circle_id = ci.id
                              AND cm2.owner_id = f.owner_id
                            ORDER BY c2.full_name NULLS LAST
                            -- 8 -> 30, matching listCirclesWithPreview: this is
                            -- how many members the pinned tile's mark can plot,
                            -- and eight of a twenty-person circle is a count
                            -- with a decoration rather than a picture of it.
                            LIMIT 30) x),
                  '[]'::jsonb) AS members
           FROM circle_members cm
           JOIN contacts c
             ON c.id = cm.contact_id
            AND c.deleted_at IS NULL
          WHERE cm.circle_id = ci.id
            AND cm.owner_id = f.owner_id
       ) mem ON TRUE
      WHERE f.owner_id = $1
      ORDER BY f.position ASC NULLS LAST, f.created_at DESC`,
    [ownerId],
  );
  return rows.map((r) => ({
    id: String(r.circle_id),
    name: r.name,
    color: r.color ?? null,
    kindTag: r.kind_tag ?? null,
    classifiedKind: r.classified_kind ?? null,
    memberCount: r.member_count ?? 0,
    // Names only, and deliberately: the tile plots dots on a ring, so an avatar
    // url would be fetched for every pinned circle and rendered by nothing.
    preview: Array.isArray(r.members)
      ? r.members
          .filter((m) => m && m.id)
          .map((m) => ({ id: String(m.id), name: m.name || '' }))
      : [],
    position: r.position == null ? null : Number(r.position),
  }));
}

/** Is this circle real, this owner's, and not deleted? */
export async function circleExistsForOwner(ownerId, circleId) {
  if (!ownerId || !circleId) return false;
  try {
    const { rows } = await query(
      `SELECT 1 FROM circles
        WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [ownerId, String(circleId)],
    );
    return rows.length > 0;
  } catch (e) {
    console.error("[circle-favorites] circleExistsForOwner FAILED:", e?.message);
    return false;
  }
}

/** Pin a circle. Idempotent — a repeat pin keeps the position it already had. */
export async function pinCircle(ownerId, circleId) {
  if (!ownerId || !circleId) return false;
  try {
    // DO NOTHING, not DO UPDATE. There is nothing to update but `position`, and
    // overwriting that would move a circle the user had deliberately dragged
    // somewhere, just because something re-pinned it.
    await query(
      `INSERT INTO circle_favorites (owner_id, circle_id)
       VALUES ($1, $2)
       ON CONFLICT (owner_id, circle_id) DO NOTHING`,
      [ownerId, String(circleId)],
    );
    return true;
  } catch (e) {
    console.error("[circle-favorites] pinCircle FAILED:", e?.message);
    return false;
  }
}

/** How many circles this owner has pinned. -1 when it could not be determined,
 *  so a caller can tell "none" from "unknown" and refuse to guess. */
export async function countPinnedCircles(ownerId) {
  if (!ownerId) return -1;
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM circle_favorites WHERE owner_id = $1`,
      [ownerId],
    );
    return Number(rows[0]?.n ?? 0);
  } catch (e) {
    console.error("[circle-favorites] countPinnedCircles FAILED:", e?.message);
    return -1;
  }
}

/**
 * Write the hand-arranged order.
 *
 * ONE STATEMENT, not a loop of updates. A loop would leave the grid
 * half-reordered if the request died between two of them, and the user would
 * reopen the app to an arrangement they never chose. This is a single
 * UPDATE ... FROM unnest WITH ORDINALITY, so the new order lands completely or
 * not at all.
 *
 * Ids that are not this owner's simply match no row; the owner_id predicate is
 * what makes that safe, rather than the caller's honesty.
 */
export async function reorderPinnedCircles(ownerId, circleIds) {
  if (!ownerId) return false;
  const ids = (Array.isArray(circleIds) ? circleIds : [])
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, MAX_PINNED_CIRCLES);
  if (ids.length === 0) return false;
  // A duplicate id would give one row two positions; keep the first occurrence.
  const unique = Array.from(new Set(ids));
  try {
    await query(
      `UPDATE circle_favorites f
          SET position = v.pos
         FROM unnest($2::uuid[]) WITH ORDINALITY AS v(circle_id, pos)
        WHERE f.owner_id = $1 AND f.circle_id = v.circle_id`,
      [ownerId, unique],
    );
    return true;
  } catch (e) {
    console.error("[circle-favorites] reorderPinnedCircles FAILED:", e?.message);
    return false;
  }
}

/** Unpin. True on success, and also true when it was not pinned to begin with. */
export async function unpinCircle(ownerId, circleId) {
  if (!ownerId || !circleId) return false;
  try {
    await query(
      `DELETE FROM circle_favorites WHERE owner_id = $1 AND circle_id = $2`,
      [ownerId, String(circleId)],
    );
    return true;
  } catch (e) {
    console.error("[circle-favorites] unpinCircle FAILED:", e?.message);
    return false;
  }
}
