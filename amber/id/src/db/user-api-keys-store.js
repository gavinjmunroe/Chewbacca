/**
 * Cloud SQL store for per-user personal API keys ("ingest keys").
 *
 * These are the long-lived keys a user pastes into Clay (or any HTTP client) to
 * push contacts into their OWN Amber address book via POST /v1/ingest/contacts.
 *
 * REUSE NOTE: the pre-existing dedup api-key store (dedup/auth/api-keys.ts) is
 * BigQuery-backed and keyed by the Privy `owner_did`, whereas the contact tables
 * this feature writes to are Cloud SQL keyed by `amber_id`. To keep the ingest
 * path on ONE owner identity (the same amber_id upsertContactsForOwner uses) and
 * fully inside Cloud SQL (the target OLTP backbone per CLAUDE.md), personal keys
 * live in this dedicated Cloud SQL table instead of the BigQuery one. The key
 * format / hashing scheme mirrors the dedup store (sha256, base32, visible
 * prefix + last4).
 *
 * SECURITY INVARIANTS:
 *   - Only the SHA-256 hash of a key is ever stored; the raw key is returned
 *     exactly ONCE at creation and is never persisted or logged.
 *   - Every key row is bound to exactly one owner_id (amber_id). verify() returns
 *     that owner_id so the ingest route can scope every write to it — a key can
 *     never write under another owner.
 *   - list / revoke are owner-scoped: an owner can only see or revoke its own keys.
 *
 * SCHEMA lives in db/migrations/20260826_add_user_api_keys.sql, applied by
 * `npm run migrate`. This module creates nothing.
 *   user_api_keys (
 *     id           bigserial PK,
 *     key_id       text UNIQUE NOT NULL,  -- opaque public id (uuid)
 *     owner_id     text NOT NULL,         -- amber_id
 *     key_hash     text UNIQUE NOT NULL,  -- sha256(raw key), hex
 *     key_prefix   text NOT NULL,         -- display-only, e.g. "amberk_live_AB…"
 *     last4        text NOT NULL,         -- display-only tail
 *     name         text,
 *     created_at   timestamptz NOT NULL DEFAULT now(),
 *     last_used_at timestamptz,
 *     revoked_at   timestamptz
 *   )
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { query } from "./sql.js";

const KEY_PREFIXES = { ingest: "amberk_live_", mcp: "ambermcp_live_" };
function prefixForPurpose(purpose) {
  if (!Object.hasOwn(KEY_PREFIXES, purpose)) throw new Error("invalid_key_purpose");
  return KEY_PREFIXES[purpose];
}
const RAW_KEY_BYTES = 32;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";


function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function generateRawKey(purpose) {
  return `${prefixForPurpose(purpose)}${base32Encode(randomBytes(RAW_KEY_BYTES))}`;
}

export function hashKey(rawKey) {
  return createHash("sha256").update(String(rawKey), "utf8").digest("hex");
}

/** Cheap format gate so a non-Amber token never hits the DB. */
export function looksLikeUserApiKey(rawKey, purpose = "ingest") {
  return typeof rawKey === "string" && rawKey.startsWith(prefixForPurpose(purpose));
}

/**
 * Mint a new personal key for `ownerId` (amber_id). Returns the raw key exactly
 * once alongside its metadata; the raw key is never stored or returned again.
 */
export async function issueUserApiKey(ownerId, name = null, purpose = "ingest") {
  if (!ownerId) return null;
  const key = generateRawKey(purpose);
  const keyId = randomUUID();
  const keyHash = hashKey(key);
  const keyPrefix = key.slice(0, prefixForPurpose(purpose).length + 4); // "amberk_live_" + 4 chars
  const last4 = key.slice(-4);
  const cleanName =
    typeof name === "string" && name.trim() ? name.trim().slice(0, 120) : null;

  const { rows } = await query(
    `INSERT INTO user_api_keys (key_id, owner_id, key_hash, key_prefix, last4, name)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING key_id, key_prefix, last4, name, created_at`,
    [keyId, ownerId, keyHash, keyPrefix, last4, cleanName],
  );
  const r = rows[0];
  return {
    id: r.key_id,
    purpose,
    key, // raw — shown ONCE
    prefix: r.key_prefix,
    last4: r.last4,
    name: r.name ?? null,
    createdAt: r.created_at,
  };
}

/**
 * Resolve a presented raw key to its owner. Looks the key up by its SHA-256
 * hash (so the raw secret is never compared byte-by-byte), then does a
 * defense-in-depth constant-time compare of the stored hash. Async-bumps
 * last_used_at. Returns { ownerId, keyId } or null on miss / revoked / error.
 */
export async function verifyUserApiKey(rawKey, purpose = "ingest") {
  if (!looksLikeUserApiKey(rawKey, purpose)) return null;
  try {
    const keyHash = hashKey(rawKey);
    const { rows } = await query(
      `SELECT key_id, owner_id, key_hash FROM user_api_keys
        WHERE key_hash = $1 AND revoked_at IS NULL
        LIMIT 1`,
      [keyHash],
    );
    const row = rows[0];
    if (!row) return null;

    // The DB equality already matched on the hash; this constant-time compare
    // guarantees no timing signal leaks on the stored-hash comparison path.
    const a = Buffer.from(keyHash, "hex");
    const b = Buffer.from(String(row.key_hash), "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    // Best-effort last_used_at bump — never block or fail the request path.
    query(`UPDATE user_api_keys SET last_used_at = now() WHERE key_id = $1`, [
      row.key_id,
    ]).catch(() => {});

    return { ownerId: row.owner_id, keyId: row.key_id };
  } catch {
    return null;
  }
}

/** Owner-scoped list of a user's active keys — metadata only, never the raw key. */
export async function listUserApiKeys(ownerId) {
  if (!ownerId) return [];
  try {
    const { rows } = await query(
      `SELECT key_id, key_prefix, last4, name, created_at, last_used_at
         FROM user_api_keys
        WHERE owner_id = $1 AND revoked_at IS NULL
        ORDER BY created_at DESC`,
      [ownerId],
    );
    return rows.map((r) => ({
      id: r.key_id,
      purpose: r.key_prefix.startsWith(KEY_PREFIXES.mcp) ? "mcp" : "ingest",
      prefix: r.key_prefix,
      last4: r.last4,
      name: r.name ?? null,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at ?? null,
    }));
  } catch {
    return [];
  }
}

/** Owner-scoped revoke. Returns true only if a row this owner owns was revoked. */
export async function revokeUserApiKey(ownerId, keyId) {
  if (!ownerId || !keyId) return false;
  try {
    const { rowCount } = await query(
      `UPDATE user_api_keys SET revoked_at = now()
        WHERE key_id = $1 AND owner_id = $2 AND revoked_at IS NULL`,
      [keyId, ownerId],
    );
    return (rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}
