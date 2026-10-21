/**
 * Where a user's contacts get pushed TO in Clay.
 *
 * One destination per owner: a Clay "Import from Webhook" URL, which the user copies
 * out of their Clay table and pastes into Amber. Pushing to it appends rows to that
 * table.
 *
 * TREAT THE URL AS A CREDENTIAL. A Clay webhook URL is a bearer capability -- anyone
 * holding it can write rows into that table -- so it is never returned to the client
 * in full (see maskWebhookUrl) and never logged. It is stored rather than hashed
 * because, unlike a password, the server has to replay it verbatim on every push.
 *
 * SECURITY INVARIANT, same as every other store here: every function is scoped by the
 * caller's owner_id. No function may read or write another owner's row.
 */

import { query } from "./sql.js";


/**
 * Mask a webhook URL for display: enough to recognize which one it is, not enough to
 * use. Clay's webhook URLs end in a long opaque id, and that id IS the secret.
 */
export function maskWebhookUrl(url) {
  const s = typeof url === "string" ? url : "";
  if (!s) return null;
  try {
    const u = new URL(s);
    const tail = u.pathname.slice(-6);
    return `${u.origin}/…${tail}`;
  } catch {
    return "…";
  }
}

/** The caller's destination row, or null. Includes the RAW url — server-side only. */
export async function getClayDestination(ownerId) {
  if (!ownerId) return null;
  const { rows } = await query(
    `SELECT owner_id, webhook_url, label, mode, auth_token, created_at, updated_at,
            last_push_at, last_push_count
       FROM clay_destinations
      WHERE owner_id = $1::uuid
      LIMIT 1`,
    [ownerId],
  );
  return rows[0] ?? null;
}

/** Set (or replace) the caller's destination. One row per owner, enforced by the PK. */
export async function setClayDestination(
  ownerId,
  webhookUrl,
  { label = null, mode = "object", authToken = null } = {},
) {
  if (!ownerId || !webhookUrl) return null;
  const { rows } = await query(
    `INSERT INTO clay_destinations (owner_id, webhook_url, label, mode, auth_token)
          VALUES ($1::uuid, $2, $3, $4, $5)
     ON CONFLICT (owner_id) DO UPDATE
        SET webhook_url = EXCLUDED.webhook_url,
            label       = EXCLUDED.label,
            mode        = EXCLUDED.mode,
            auth_token  = EXCLUDED.auth_token,
            updated_at  = now()
       RETURNING owner_id, webhook_url, label, mode, auth_token, created_at, updated_at,
                 last_push_at, last_push_count`,
    [ownerId, webhookUrl, label, mode === "array" ? "array" : "object", authToken || null],
  );
  return rows[0] ?? null;
}

export async function deleteClayDestination(ownerId) {
  if (!ownerId) return false;
  const { rowCount } = await query(
    `DELETE FROM clay_destinations WHERE owner_id = $1::uuid`,
    [ownerId],
  );
  return rowCount > 0;
}

/** Record a completed push, so the app can show when contacts last went out. */
export async function recordClayPush(ownerId, count) {
  if (!ownerId) return;
  await query(
    `UPDATE clay_destinations
        SET last_push_at = now(), last_push_count = $2, updated_at = now()
      WHERE owner_id = $1::uuid`,
    [ownerId, Math.max(0, Number(count) || 0)],
  );
}
