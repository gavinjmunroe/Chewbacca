/**
 * Cloud SQL store for the wall feature.
 *
 * Schema assumed:
 *   wall_posts (id bigserial PK, owner_id text NOT NULL, text text NOT NULL,
 *               visibility text NOT NULL DEFAULT 'private',
 *               created_at timestamptz, updated_at timestamptz, deleted_at timestamptz)
 *   Index: (owner_id, deleted_at)
 *
 * SECURITY INVARIANT: every function is scoped by owner_id.
 * No function may read or write rows across owners.
 */

import { query } from "./sql.js";

// Guard: parse a positive integer from any input. Returns null for invalid inputs.
function _toInt(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * List all active wall posts for the owner, newest first.
 * Returns [{ id, text, visibility, createdAt, updatedAt }].
 */
export async function listWallPosts(ownerId) {
  if (!ownerId) return [];
  try {
    const { rows } = await query(
      `SELECT id, text, visibility, created_at, updated_at
       FROM wall_posts
       WHERE owner_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [ownerId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      text: r.text,
      visibility: r.visibility,
      createdAt: r.created_at ?? null,
      updatedAt: r.updated_at ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * Create a new wall post for the owner.
 * Returns the inserted row or null on error.
 */
export async function createWallPost(ownerId, { text, visibility = "private" } = {}) {
  if (!ownerId || !text) return null;
  try {
    const { rows } = await query(
      `INSERT INTO wall_posts (owner_id, text, visibility)
       VALUES ($1, $2, $3)
       RETURNING id, text, visibility, created_at, updated_at`,
      [ownerId, text.trim(), visibility],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Partial-update a wall post. Only fields explicitly present in the patch object
 * are written; omitted fields are left unchanged.
 * Returns the updated row, or null when the post is not found / not owned.
 */
export async function updateWallPost(ownerId, postId, patch = {}) {
  const id = _toInt(postId);
  if (!ownerId || !id) return null;

  const sets = [];
  const params = [id, ownerId];

  if (patch.text !== undefined) {
    const trimmed = patch.text.trim();
    if (!trimmed) return null; // reject empty text
    params.push(trimmed);
    sets.push(`text = $${params.length}`);
  }
  if (patch.visibility !== undefined) {
    params.push(patch.visibility);
    sets.push(`visibility = $${params.length}`);
  }
  if (sets.length === 0) return null; // caller sent an empty patch

  sets.push("updated_at = now()");

  try {
    const { rows } = await query(
      `UPDATE wall_posts
       SET ${sets.join(", ")}
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
       RETURNING id, text, visibility, created_at, updated_at`,
      params,
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Soft-delete a wall post. Returns the number of rows affected.
 */
export async function softDeleteWallPost(ownerId, postId) {
  const id = _toInt(postId);
  if (!ownerId || !id) return 0;
  try {
    const { rowCount } = await query(
      `UPDATE wall_posts
       SET deleted_at = now()
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [id, ownerId],
    );
    return rowCount ?? 0;
  } catch {
    return 0;
  }
}
