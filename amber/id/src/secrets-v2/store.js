/**
 * Cloud SQL amber store for per-tenant secrets v2 (Chunk 4c-ii; was Firestore).
 *
 * Tables:
 *   tenant_secrets_v2(owner_id, key_name, ciphertext, iv, auth_tag, dek_version,
 *     created_at, updated_at)  UNIQUE (owner_id, key_name)
 *   tenant_deks(owner_id, version, wrapped_dek, wrap_iv, wrap_auth_tag,
 *     created_at, superseded_at)  UNIQUE (owner_id, version)
 *   tenant_secret_audit(id, owner_id, key_name, action, caller, created_at)
 *
 * Same two-layer key hierarchy as before: an env-only KEK wraps a per-tenant
 * DEK; the DEK encrypts every value the tenant owns. The crypto (crypto.js) and
 * the KEK env are UNCHANGED — this only swaps the storage backend.
 *
 * Signatures still take a `tenantDid`; internally it resolves to the amber_id
 * via resolveAmberIdByPrivyDid (accepts real Privy DIDs, did:amber:<uuid>, bare
 * amber_id uuids, and 32-hex person_ids). An unresolved tenantDid returns the
 * same empty/null the Firestore version returned for a missing doc — reads give
 * null/[]; writes are a logged no-op (there is no amber owner to key rows on).
 */

import { query } from "../db/sql.js";
import { resolveAmberIdByPrivyDid } from "../db/store.js";
import {
  loadKek,
  generateDek,
  wrapDek,
  unwrapDek,
  encrypt,
  decrypt,
} from "./crypto.js";

// ── DEK helpers (owner_id-keyed; dekCache keyed by owner_id) ─────────────────

async function loadDekVersion(ownerId, version, dekCache) {
  const cacheKey = `${ownerId}::v${version}`;
  if (dekCache && dekCache.has(cacheKey)) return dekCache.get(cacheKey);
  const { rows } = await query(
    `SELECT wrapped_dek, wrap_iv, wrap_auth_tag FROM tenant_deks
      WHERE owner_id = $1 AND version = $2
      LIMIT 1`,
    [ownerId, version],
  );
  if (!rows[0]) {
    throw new Error(`no DEK found for owner ${ownerId} version ${version}`);
  }
  const data = rows[0];
  const dek = unwrapDek(
    {
      wrappedDek: data.wrapped_dek,
      wrapIv: data.wrap_iv,
      wrapAuthTag: data.wrap_auth_tag,
    },
    loadKek(),
  );
  if (dekCache) dekCache.set(cacheKey, dek);
  return dek;
}

async function loadCurrentDek(ownerId, dekCache) {
  const cacheKey = `${ownerId}::current`;
  if (dekCache && dekCache.has(cacheKey)) return dekCache.get(cacheKey);
  const { rows } = await query(
    `SELECT version, wrapped_dek, wrap_iv, wrap_auth_tag FROM tenant_deks
      WHERE owner_id = $1 AND superseded_at IS NULL
      ORDER BY version DESC
      LIMIT 1`,
    [ownerId],
  );
  if (!rows[0]) return null;
  const data = rows[0];
  const dek = unwrapDek(
    {
      wrappedDek: data.wrapped_dek,
      wrapIv: data.wrap_iv,
      wrapAuthTag: data.wrap_auth_tag,
    },
    loadKek(),
  );
  const entry = { dek, version: data.version };
  if (dekCache) {
    dekCache.set(cacheKey, entry);
    dekCache.set(`${ownerId}::v${data.version}`, dek);
  }
  return entry;
}

async function ensureCurrentDek(ownerId, dekCache) {
  const existing = await loadCurrentDek(ownerId, dekCache);
  if (existing) return existing;
  return writeNewDek(ownerId, 1, dekCache);
}

async function writeNewDek(ownerId, version, dekCache) {
  const dek = generateDek();
  const wrapped = wrapDek(dek, loadKek());
  await query(
    `INSERT INTO tenant_deks (owner_id, version, wrapped_dek, wrap_iv, wrap_auth_tag)
     VALUES ($1, $2, $3, $4, $5)`,
    [ownerId, version, wrapped.wrappedDek, wrapped.wrapIv, wrapped.wrapAuthTag],
  );
  if (dekCache) {
    dekCache.set(`${ownerId}::current`, { dek, version });
    dekCache.set(`${ownerId}::v${version}`, dek);
  }
  return { dek, version };
}

export function createDekCache() {
  return new Map();
}

export async function getSecret(tenantDid, keyName, { dekCache } = {}) {
  const ownerId = await resolveAmberIdByPrivyDid(tenantDid);
  if (!ownerId) return null;
  const { rows } = await query(
    `SELECT ciphertext, iv, auth_tag, dek_version FROM tenant_secrets_v2
      WHERE owner_id = $1 AND key_name = $2
      LIMIT 1`,
    [ownerId, keyName],
  );
  if (!rows[0]) return null;
  const data = rows[0];
  const dek = await loadDekVersion(ownerId, data.dek_version, dekCache);
  return decrypt(
    { ciphertext: data.ciphertext, iv: data.iv, authTag: data.auth_tag },
    dek,
  );
}

export async function setSecret(tenantDid, keyName, value, { dekCache } = {}) {
  if (typeof value !== "string") {
    throw new Error("value must be a string");
  }
  const ownerId = await resolveAmberIdByPrivyDid(tenantDid);
  if (!ownerId) {
    console.warn(
      `[secrets-v2] setSecret: tenantDid ${tenantDid} does not resolve to an amber owner — skipping key ${keyName}`,
    );
    return { ok: true, tenantDid, keyName, dekVersion: null };
  }
  const current = await ensureCurrentDek(ownerId, dekCache);
  const env = encrypt(value, current.dek);
  await query(
    `INSERT INTO tenant_secrets_v2
       (owner_id, key_name, ciphertext, iv, auth_tag, dek_version, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (owner_id, key_name) DO UPDATE
       SET ciphertext  = EXCLUDED.ciphertext,
           iv          = EXCLUDED.iv,
           auth_tag    = EXCLUDED.auth_tag,
           dek_version = EXCLUDED.dek_version,
           updated_at  = now()`,
    [ownerId, keyName, env.ciphertext, env.iv, env.authTag, current.version],
  );
  return { ok: true, tenantDid, keyName, dekVersion: current.version };
}

export async function deleteSecret(tenantDid, keyName) {
  const ownerId = await resolveAmberIdByPrivyDid(tenantDid);
  if (ownerId) {
    await query(
      `DELETE FROM tenant_secrets_v2 WHERE owner_id = $1 AND key_name = $2`,
      [ownerId, keyName],
    );
  }
  return { ok: true, tenantDid, keyName };
}

export async function listSecretNames(tenantDid) {
  const ownerId = await resolveAmberIdByPrivyDid(tenantDid);
  if (!ownerId) return [];
  const { rows } = await query(
    `SELECT key_name, dek_version, updated_at FROM tenant_secrets_v2
      WHERE owner_id = $1`,
    [ownerId],
  );
  return rows.map((r) => ({
    keyName: r.key_name,
    dekVersion: r.dek_version,
    updatedAt:
      r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  }));
}

export async function rotateDek(tenantDid, { dekCache } = {}) {
  const ownerId = await resolveAmberIdByPrivyDid(tenantDid);
  if (!ownerId) {
    console.warn(
      `[secrets-v2] rotateDek: tenantDid ${tenantDid} does not resolve to an amber owner — no-op`,
    );
    return {
      ok: true,
      tenantDid,
      newVersion: null,
      previousVersion: null,
      reencrypted: 0,
    };
  }
  const current = await loadCurrentDek(ownerId, dekCache);
  const nextVersion = current ? current.version + 1 : 1;
  const next = await writeNewDek(ownerId, nextVersion, dekCache);

  const { rows: secrets } = await query(
    `SELECT key_name, ciphertext, iv, auth_tag, dek_version FROM tenant_secrets_v2
      WHERE owner_id = $1`,
    [ownerId],
  );

  let reencrypted = 0;
  for (const data of secrets) {
    if (data.dek_version === next.version) continue;
    const oldDek = await loadDekVersion(ownerId, data.dek_version, dekCache);
    const plaintext = decrypt(
      { ciphertext: data.ciphertext, iv: data.iv, authTag: data.auth_tag },
      oldDek,
    );
    const env = encrypt(plaintext, next.dek);
    await query(
      `UPDATE tenant_secrets_v2
          SET ciphertext  = $3,
              iv          = $4,
              auth_tag    = $5,
              dek_version = $6,
              updated_at  = now()
        WHERE owner_id = $1 AND key_name = $2`,
      [ownerId, data.key_name, env.ciphertext, env.iv, env.authTag, next.version],
    );
    reencrypted += 1;
  }

  if (current) {
    await query(
      `UPDATE tenant_deks SET superseded_at = now()
        WHERE owner_id = $1 AND version = $2`,
      [ownerId, current.version],
    );
  }

  return {
    ok: true,
    tenantDid,
    newVersion: next.version,
    previousVersion: current ? current.version : null,
    reencrypted,
  };
}

export async function recordAudit({ tenantDid, keyName, action, caller }) {
  const ownerId = await resolveAmberIdByPrivyDid(tenantDid);
  if (!ownerId) {
    console.warn(
      `[secrets-v2] recordAudit: tenantDid ${tenantDid} does not resolve to an amber owner — skipping audit ${action}`,
    );
    return;
  }
  await query(
    `INSERT INTO tenant_secret_audit (owner_id, key_name, action, caller)
     VALUES ($1, $2, $3, $4)`,
    [ownerId, keyName || null, action, caller || null],
  );
}
