/**
 * Cloud SQL store for intro requests (F4c). Owner-scoped, parameterized.
 * Authorization (who may create/approve/view) lives in the route; this layer is
 * pure persistence.
 */

import { query } from "./sql.js";

function _toInt(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function _row(r) {
  if (!r) return null;
  return {
    id: String(r.id),
    requesterAmberId: String(r.requester_amber_id),
    ownerAmberId: String(r.owner_id),
    contactId: String(r.contact_id),
    message: r.message ?? null,
    status: r.status,
    createdAt: r.created_at,
    respondedAt: r.responded_at ?? null,
  };
}

/**
 * Create a pending intro request. Idempotent on the pending unique key
 * (requester, owner, contact): a duplicate ask returns the existing pending
 * row instead of inserting a second. Returns the intro row, or null on error.
 */
export async function createIntroRequest({ requesterAmberId, ownerAmberId, contactId, message = null } = {}) {
  const cId = _toInt(contactId);
  if (!requesterAmberId || !ownerAmberId || !cId) return null;
  try {
    const { rows } = await query(
      `INSERT INTO intro_requests (requester_amber_id, owner_id, contact_id, message)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (requester_amber_id, owner_id, contact_id)
         WHERE status = 'pending' AND deleted_at IS NULL
       DO NOTHING
       RETURNING *`,
      [requesterAmberId, ownerAmberId, cId, message ?? null],
    );
    if (rows[0]) return _row(rows[0]);
    // Conflict: a pending ask already exists — return it (idempotent).
    const { rows: existing } = await query(
      `SELECT * FROM intro_requests
        WHERE requester_amber_id = $1 AND owner_id = $2 AND contact_id = $3
          AND status = 'pending' AND deleted_at IS NULL
        ORDER BY id ASC LIMIT 1`,
      [requesterAmberId, ownerAmberId, cId],
    );
    return existing[0] ? _row(existing[0]) : null;
  } catch {
    return null;
  }
}

/**
 * List a user's intros. direction 'incoming' = where they are the owner;
 * 'outgoing' = where they are the requester. Newest first.
 */
export async function listIntros(amberId, direction = "incoming") {
  if (!amberId) return [];
  // The COLUMN is owner_id; the field this store returns stays ownerAmberId.
  const col = direction === "outgoing" ? "requester_amber_id" : "owner_id";
  try {
    const { rows } = await query(
      `SELECT * FROM intro_requests
        WHERE ${col} = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      [amberId],
    );
    return rows.map(_row);
  } catch {
    return [];
  }
}

/** Fetch one intro by id (not authorized here — the route enforces access). */
export async function getIntroById(id) {
  const iId = _toInt(id);
  if (!iId) return null;
  try {
    const { rows } = await query(
      `SELECT * FROM intro_requests WHERE id = $1 AND deleted_at IS NULL`,
      [iId],
    );
    return rows[0] ? _row(rows[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Owner responds to a pending intro. Only the owner may act, and only a pending
 * row transitions. status ∈ 'approved'|'declined'. Returns the updated row, or
 * null if not found / not owner / not pending.
 */
export async function setIntroStatus(id, ownerAmberId, status) {
  const iId = _toInt(id);
  if (!iId || !ownerAmberId || !["approved", "declined"].includes(status)) return null;
  try {
    const { rows } = await query(
      `UPDATE intro_requests
          SET status = $3, responded_at = now()
        WHERE id = $1 AND owner_id = $2 AND status = 'pending' AND deleted_at IS NULL
        RETURNING *`,
      [iId, ownerAmberId, status],
    );
    return rows[0] ? _row(rows[0]) : null;
  } catch {
    return null;
  }
}
