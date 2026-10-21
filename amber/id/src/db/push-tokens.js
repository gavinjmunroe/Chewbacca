/**
 * Push token store (Chunk 4d; was Firestore). A user may install on multiple
 * devices, so tokens live one-row-per-device in the amber `push_tokens` table
 * keyed by (owner_id, token_hash).
 *
 * token_hash is the SHA-256 of the raw token truncated to 24 hex chars — the
 * same value the Firestore store used as the device doc id, so re-registration
 * stays idempotent and raw tokens never appear in keys/indexes. The RAW token
 * is stored in the `token` column because amber-platform needs it when calling
 * the Expo / APNs delivery API.
 */

import { createHash } from "crypto";
import { query } from "./sql.js";
import { resolveAmberIdByPrivyDid } from "./store.js";

const ALLOWED_PLATFORMS = new Set(["ios", "android"]);

/**
 * THE UNIQUE INDEX THIS FILE DEPENDS ON. The upsert below uses
 * `ON CONFLICT (owner_id, token_hash)`. If the database lacks
 * uq_push_tokens_owner_token, Postgres raises 42P10 ("no unique or exclusion
 * constraint matching the ON CONFLICT specification"), the route 500s, and the
 * client only console.warns — so every device registration fails while the app
 * looks healthy. That is a live candidate for why no push has ever arrived.
 *
 * Until 2026-08-26 no migration created push_tokens at all; the table existed
 * only because this module built it lazily, and 20260726_add_push_tokens_columns
 * ALTERed a table nothing had declared. Both the table and the index are now in
 * db/migrations/20260726_add_push_tokens.sql. Verify with `npm run migrate:status`.
 */

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex").slice(0, 24);
}

export async function upsertPushToken(privyDid, { token, platform }) {
  if (!privyDid) throw new Error("privyDid required");
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("token required");
  }
  if (!ALLOWED_PLATFORMS.has(platform)) {
    throw new Error(
      `platform must be one of ${Array.from(ALLOWED_PLATFORMS).join(", ")}`,
    );
  }
  const ownerId = await resolveAmberIdByPrivyDid(privyDid);
  if (!ownerId) {
    console.error(
      `[push-tokens] upsertPushToken: DID ${privyDid} does not resolve to an amber user — TOKEN NOT STORED`,
    );
    // Reported honestly now. This used to return { ok: true }, so the client got a
    // 200, stored nothing, and never registered for push again that launch.
    return { ok: false, reason: "unresolved_user" };
  }
  await query(
    `INSERT INTO push_tokens (owner_id, token_hash, token, platform, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (owner_id, token_hash) DO UPDATE
       SET token      = EXCLUDED.token,
           platform   = EXCLUDED.platform,
           updated_at = now()`,
    [ownerId, hashToken(token), token, platform],
  );
  // The amber_id goes back to the caller so the route can act on behalf of this
  // account without resolving the DID a second time -- see the circle-invite
  // notification in routes/push-tokens.js.
  return { ok: true, ownerId: String(ownerId) };
}

/**
 * Return the raw push tokens for an owner (amber_id) so a caller can send an
 * Expo/APNs push. Returns string[]; [] on error or if the owner has none.
 * Owner-scoped.
 */
export async function getPushTokensForOwner(ownerId) {
  if (!ownerId) return [];
  try {
    const { rows } = await query(
      `SELECT token FROM push_tokens WHERE owner_id = $1`,
      [ownerId],
    );
    return rows.map((r) => r.token).filter((t) => typeof t === "string" && t);
  } catch (e) {
    console.error("[push-tokens] getPushTokensForOwner FAILED:", e?.message);
    return [];
  }
}

/**
 * Delete tokens Expo has told us are dead (DeviceNotRegistered).
 *
 * Without this, an uninstalled app's token stays in the table forever and every
 * future send burns a slot on it and logs the same error. Not owner-scoped on
 * purpose: a token identifies one device installation, and the account it used to
 * belong to is not something the caller reliably knows by the time Expo rejects it.
 */
export async function deletePushTokens(tokens) {
  const list = (Array.isArray(tokens) ? tokens : []).filter(
    (t) => typeof t === "string" && t.length > 0,
  );
  if (list.length === 0) return 0;
  try {
    const { rowCount } = await query(
      `DELETE FROM push_tokens WHERE token = ANY($1::text[])`,
      [list],
    );
    if (rowCount > 0) console.warn(`[push-tokens] pruned ${rowCount} dead token(s)`);
    return rowCount || 0;
  } catch (e) {
    console.error("[push-tokens] deletePushTokens FAILED:", e?.message);
    return 0;
  }
}
