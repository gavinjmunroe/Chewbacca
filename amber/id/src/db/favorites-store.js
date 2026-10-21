/**
 * Cloud SQL store for "Amber Network" favorites — the people the user hand-picks
 * as the ones they actually help and have a real relationship with.
 *
 * SCHEMA lives in db/migrations/20260805_add_contact_favorites.sql plus
 * 20260826_fix_contact_favorites_columns.sql, applied by `npm run migrate`.
 * This module creates nothing.
 *   contact_favorites (id bigserial PK, owner_id text NOT NULL,
 *                      contact_id text NOT NULL, tags text[] NOT NULL DEFAULT '{}',
 *                      position integer, created_at timestamptz,
 *                      UNIQUE (owner_id, contact_id))
 *
 * `tags` and `position` were added as lazy ALTERs and never made it into the
 * original migration, so any database built from db/migrations alone came up
 * without them and every read here failed. The fix migration closes that.
 *
 * SECURITY INVARIANT: every function is scoped by owner_id. No cross-owner reads
 * or writes. contact_id is a UUID, matching contacts.id directly -- it was joined
 * as ::text on both sides, which is text = uuid and not an operator, so it
 * works regardless of the contacts PK type.
 */

import { query } from "./sql.js";


/**
 * Favorites for one owner, newest first, joined to the live contact so the app
 * can render name/title/company without a second call. A favorite whose contact
 * was deleted drops out via the join.
 * Returns [{ id, name, title, company }].
 */
export async function listFavorites(ownerId) {
  if (!ownerId) return [];
  try {
    const { rows } = await query(
      // COALESCE + a to_jsonb cast is deliberate: if the tags column is somehow
      // absent, this query fails loudly below instead of returning [] and looking
      // like an empty favorites list.
      `SELECT f.contact_id, COALESCE(f.tags, '{}') AS tags, f.position,
              c.full_name, c.title, c.company
         FROM contact_favorites f
         JOIN contacts c
           -- BOTH sides need the cast. contacts.owner_id is UUID while
           -- contact_favorites.owner_id is TEXT, and Postgres will not compare
           -- uuid = text -- it raises "operator does not exist: uuid = text" and
           -- the whole SELECT fails. Only c.id was cast originally, so this join
           -- has never returned a row; a swallowed catch made it look like an
           -- empty favorites list instead of an error.
           ON c.id = f.contact_id
          AND c.owner_id = f.owner_id
          AND c.deleted_at IS NULL
        WHERE f.owner_id = $1
        -- Hand-placed order first; anything never dragged keeps newest-first
        -- behind it. NULLS LAST is what makes those two rules coexist without a
        -- backfill.
        ORDER BY f.position ASC NULLS LAST, f.created_at DESC`,
      [ownerId],
    );
    return rows.map((r) => ({
      id: String(r.contact_id),
      name: r.full_name || "Unknown",
      title: r.title || null,
      company: r.company || null,
      // Why this person is a favorite ("work", "close", "sailing"). Read by the
      // contact card and available to PeopleRank for questions like
      // "who do I know from work?".
      tags: Array.isArray(r.tags) ? r.tags : [],
      position: r.position == null ? null : Number(r.position),
    }));
  } catch (e) {
    // Log, then still return [] so the route does not 500 — but the caller now has
    // a trail, and the app renders its "couldn't load" state rather than "none".
    console.error("[favorites] listFavorites FAILED:", e?.message);
    throw e;
  }
}

/** Add a favorite. Idempotent — a repeat add is a no-op. Returns true on success. */
/**
 * Does this contact actually exist for this owner?
 *
 * WHY THIS EXISTS: addFavorite used to insert ANY string, while listFavorites
 * INNER JOINs contacts on `c.id = f.contact_id`. So a wrong or stale id
 * inserted happily, the API returned ok:true, the app toasted "Pinned" — and the
 * row was invisible forever because the join dropped it. A write that cannot be
 * read back must not report success.
 */
export async function contactExistsForOwner(ownerId, contactId) {
  if (!ownerId || !contactId) return false;
  try {
    const { rows } = await query(
      `SELECT 1 FROM contacts
        WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [ownerId, String(contactId)],
    );
    return rows.length > 0;
  } catch (e) {
    console.error("[favorites] contactExistsForOwner FAILED:", e?.message);
    return false;
  }
}

export async function addFavorite(ownerId, contactId, tags) {
  if (!ownerId || !contactId) return false;
  try {
    // Normalize tags: trimmed, lowercased, de-duped, capped. Lowercase so
    // "Work"/"work" are one tag when PeopleRank later answers "who do I know
    // from work?" — a case-sensitive tag set would fragment that silently.
    const clean = Array.from(
      new Set(
        (Array.isArray(tags) ? tags : [])
          .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
          .filter((t) => t.length > 0 && t.length <= 40),
      ),
    ).slice(0, 12);

    // OMITTING `tags` MEANS "LEAVE THEM ALONE", not "clear them". This used to
    // always write EXCLUDED.tags, so any later upsert without tags — e.g. a voice
    // note that finished transcribing after the user tapped add — silently erased
    // the tags they had just picked. Pass [] explicitly to clear.
    const keepTags = tags == null;
    await query(
      `INSERT INTO contact_favorites (owner_id, contact_id, tags)
       VALUES ($1, $2, $3)
       ON CONFLICT (owner_id, contact_id)
         DO UPDATE SET tags = ${keepTags ? "contact_favorites.tags" : "EXCLUDED.tags"}`,
      [ownerId, String(contactId), clean],
    );
    return true;
  } catch (e) {
    console.error("[favorites] addFavorite FAILED:", e?.message);
    return false;
  }
}

/**
 * THE CAP. Sixteen, because the grid is four by four and a grid that scrolls is
 * not a set of favorites any more, it is a second contacts list.
 *
 * Enforced in the ROUTE rather than in addFavorite, because addFavorite is an
 * upsert: re-pinning someone already in the sixteen (to attach a note that finished
 * transcribing late) must not be rejected for being over the limit. The route knows
 * which case it is; this function just counts.
 */
export const MAX_FAVORITES = 16;

/** How many favorites this owner has. -1 if it could not be determined, so a
 *  caller can tell "none" apart from "unknown" and refuse to guess. */
export async function countFavorites(ownerId) {
  if (!ownerId) return -1;
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM contact_favorites WHERE owner_id = $1`,
      [ownerId],
    );
    return Number(rows[0]?.n ?? 0);
  } catch (e) {
    console.error("[favorites] countFavorites FAILED:", e?.message);
    return -1;
  }
}

/**
 * Write the hand-arranged order.
 *
 * ONE STATEMENT, not a loop of updates. A loop would leave the grid half-reordered
 * if the request died between two of them, and the user would reopen the app to an
 * arrangement they never chose. This is a single UPDATE ... FROM unnest, so the new
 * order either lands completely or not at all.
 *
 * Ids not belonging to this owner simply match no row — the owner_id predicate is
 * what makes that safe rather than the caller's honesty.
 */
export async function reorderFavorites(ownerId, contactIds) {
  if (!ownerId) return false;
  const ids = (Array.isArray(contactIds) ? contactIds : [])
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, MAX_FAVORITES);
  if (ids.length === 0) return false;
  // A duplicate id would give one row two positions; keep the first occurrence.
  const unique = Array.from(new Set(ids));
  try {
    await query(
      `UPDATE contact_favorites f
          SET position = v.pos
         FROM unnest($2::uuid[]) WITH ORDINALITY AS v(contact_id, pos)
        WHERE f.owner_id = $1 AND f.contact_id = v.contact_id`,
      [ownerId, unique],
    );
    return true;
  } catch (e) {
    console.error("[favorites] reorderFavorites FAILED:", e?.message);
    return false;
  }
}

/** Remove a favorite. Returns true on success (also true if it wasn't there). */
export async function removeFavorite(ownerId, contactId) {
  if (!ownerId || !contactId) return false;
  try {
    await query(
      `DELETE FROM contact_favorites WHERE owner_id = $1 AND contact_id = $2`,
      [ownerId, String(contactId)],
    );
    return true;
  } catch {
    return false;
  }
}
