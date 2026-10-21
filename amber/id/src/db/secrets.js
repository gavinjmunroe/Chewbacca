/**
 * Per-user secret store on Cloud SQL amber (Chunk 4c-i; was Firestore).
 *
 *   secrets(owner_id uuid, key_name text, value_encrypted text, updated_by, …)
 *     one row per (owner_id, key_name). UNIQUE (owner_id, key_name).
 *
 * Values are field-level-encrypted via lib/secrets-crypto.js (UNCHANGED). The
 * column stores the ciphertext string verbatim; a NULL value_encrypted is a
 * "present but unset" key (scaffolded, or cleared via setSecrets(key: null)).
 * Reads return decrypted values only through this service-level API; ciphertext
 * is never exposed over the network.
 *
 * Signatures still take a `privyDid`; internally it resolves to the amber_id
 * via resolveAmberIdByPrivyDid (which accepts real Privy DIDs, did:amber:<uuid>,
 * and bare amber_id uuids). An unresolved DID returns the same empty/null the
 * Firestore version returned for a missing doc — reads never crash; writes are
 * a logged no-op (there is no amber owner to key the row on).
 */

import { query } from "./sql.js";
import { resolveAmberIdByPrivyDid } from "./store.js";
import {
  encryptSecret,
  decryptSecret,
  encryptRecord,
  decryptRecord,
} from "../lib/secrets-crypto.js";

function requireDid(did) {
  if (!did || typeof did !== "string") {
    throw new Error("privyDid is required");
  }
  return did;
}

/** Read the full decrypted secret bag for a user. Returns {} if none. */
export async function getSecrets(privyDid) {
  const did = requireDid(privyDid);
  const amberId = await resolveAmberIdByPrivyDid(did);
  if (!amberId) return {};
  try {
    const { rows } = await query(
      `SELECT key_name, value_encrypted FROM secrets WHERE owner_id = $1`,
      [amberId],
    );
    const bag = {};
    for (const r of rows) bag[r.key_name] = r.value_encrypted;
    return decryptRecord(bag);
  } catch {
    return {};
  }
}

/** Read a single decrypted secret. Returns null if unset or missing. */
export async function getSecret(privyDid, keyName) {
  const did = requireDid(privyDid);
  const amberId = await resolveAmberIdByPrivyDid(did);
  if (!amberId) return null;
  try {
    const { rows } = await query(
      `SELECT value_encrypted FROM secrets
       WHERE owner_id = $1 AND key_name = $2
       LIMIT 1`,
      [amberId, keyName],
    );
    const blob = rows[0]?.value_encrypted;
    if (blob == null) return null;
    return decryptSecret(blob);
  } catch {
    return null;
  }
}

/**
 * Upsert one or more secrets. Pass null to clear a value (the key remains,
 * value_encrypted goes NULL); omitted keys are left untouched. `updatedBy` is
 * recorded for audit trail.
 */
export async function setSecrets(privyDid, record, { updatedBy } = {}) {
  const did = requireDid(privyDid);
  if (!record || typeof record !== "object") {
    throw new Error("record must be an object");
  }
  const amberId = await resolveAmberIdByPrivyDid(did);
  if (!amberId) {
    console.warn(
      `[secrets] setSecrets: DID ${did} does not resolve to an amber user — skipping ${Object.keys(record).length} key(s)`,
    );
    return { ok: true, updatedKeys: Object.keys(record) };
  }
  const encrypted = encryptRecord(record);
  const by = updatedBy || "unknown";
  // Per-key UPSERT. Omitted keys are never referenced, so they stay untouched;
  // a null blob writes NULL (clears the value while keeping the key).
  for (const [k, v] of Object.entries(encrypted)) {
    await query(
      `INSERT INTO secrets (owner_id, key_name, value_encrypted, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (owner_id, key_name) DO UPDATE
         SET value_encrypted = EXCLUDED.value_encrypted,
             updated_by      = EXCLUDED.updated_by,
             updated_at      = now()`,
      [amberId, k, v, by],
    );
  }
  return { ok: true, updatedKeys: Object.keys(record) };
}

/** Delete specific keys (or all keys for the owner if keys is omitted). */
export async function deleteSecrets(privyDid, keys = null) {
  const did = requireDid(privyDid);
  const amberId = await resolveAmberIdByPrivyDid(did);
  if (!keys) {
    if (amberId) {
      await query(`DELETE FROM secrets WHERE owner_id = $1`, [amberId]);
    }
    return { ok: true, deleted: "all" };
  }
  if (!amberId) return { ok: true, deleted: [] };
  await query(
    `DELETE FROM secrets WHERE owner_id = $1 AND key_name = ANY($2::text[])`,
    [amberId, keys],
  );
  return { ok: true, deleted: keys };
}

/**
 * Scaffold a record for a user: create any requested key that is absent with a
 * NULL value; existing keys (null or set) are left untouched.
 */
export async function scaffoldSecrets(privyDid, keyNames, { updatedBy } = {}) {
  const did = requireDid(privyDid);
  const amberId = await resolveAmberIdByPrivyDid(did);
  if (!amberId) {
    console.warn(
      `[secrets] scaffoldSecrets: DID ${did} does not resolve to an amber user — skipping`,
    );
    return { ok: true, scaffolded: keyNames };
  }
  const by = updatedBy || "scaffold";
  for (const k of keyNames) {
    await query(
      `INSERT INTO secrets (owner_id, key_name, value_encrypted, updated_by)
       VALUES ($1, $2, NULL, $3)
       ON CONFLICT (owner_id, key_name) DO NOTHING`,
      [amberId, k, by],
    );
  }
  return { ok: true, scaffolded: keyNames };
}

/** Return just the list of key names (not values) for a user. */
export async function listSecretKeys(privyDid) {
  const did = requireDid(privyDid);
  const amberId = await resolveAmberIdByPrivyDid(did);
  if (!amberId) return [];
  try {
    const { rows } = await query(
      `SELECT key_name, value_encrypted FROM secrets
       WHERE owner_id = $1
       ORDER BY key_name`,
      [amberId],
    );
    return rows.map((r) => ({ name: r.key_name, set: r.value_encrypted != null }));
  } catch {
    return [];
  }
}
