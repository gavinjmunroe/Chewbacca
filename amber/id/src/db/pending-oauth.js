/**
 * Transient store for OAuth state tokens (Chunk 4d; was Firestore).
 *
 * Backed by the amber `pending_oauth` table (state PK, data jsonb). Each OAuth
 * init writes one row; the matching callback atomically reads + deletes it.
 *
 * Ephemeral: Firestore had a TTL service; Cloud SQL doesn't, but consume
 * deletes the row on success and src/oauth/state.js enforces expiry on read,
 * so abandoned rows are harmless. A periodic prune by created_at can reclaim
 * them if they ever accumulate.
 *
 * CRUD-only. HMAC token generation, expiry enforcement, and the shape contract
 * live one level up in src/oauth/state.js.
 */

import { query } from "./sql.js";

/**
 * Persist a pending OAuth state. The state token is unique by construction, so
 * we use INSERT (create) semantics — a duplicate state is a bug (collision) and
 * the unique PK makes the write throw rather than overwrite an in-flight flow.
 */
export async function createPendingDoc(state, data) {
  if (!state) throw new Error("state is required");
  if (!data) throw new Error("data is required");
  await query(
    `INSERT INTO pending_oauth (state, data) VALUES ($1, $2::jsonb)`,
    [state, JSON.stringify(data)],
  );
}

/**
 * Atomic read + delete. Returns the doc data on success, null if the row
 * doesn't exist (never created, already consumed, or pruned). DELETE ...
 * RETURNING is atomic: two callbacks racing on the same state token can't both
 * get the row — only the winner sees data, the loser sees null. That is the
 * replay protection.
 */
export async function consumePendingDoc(state) {
  if (!state) return null;
  const { rows } = await query(
    `DELETE FROM pending_oauth WHERE state = $1 RETURNING data`,
    [state],
  );
  return rows[0]?.data ?? null;
}

/**
 * Best-effort cleanup by id. Idempotent — missing rows are not an error.
 */
export async function deletePendingDoc(state) {
  if (!state) return;
  await query(`DELETE FROM pending_oauth WHERE state = $1`, [state]);
}
