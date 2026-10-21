/**
 * COMPANY API KEYS, AND WHICH PRODUCTS A COMPANY HAS TURNED ON.
 *
 * Two small stores that share a file because they share an audience: the
 * Connectors page, which is the whole of "how does data get in and out of
 * here".
 *
 * THE KEY HALF IS THE DANGEROUS HALF and is written accordingly:
 *
 *   - the raw key exists for the duration of one function call and is returned
 *     exactly once; only its SHA-256 lands in the table;
 *   - verification goes through amber_api_key_bootstrap, a SECURITY DEFINER
 *     function that takes a hash and returns at most one row, because the
 *     tenant policy cannot be satisfied before we know which tenant the key
 *     belongs to -- the same chicken-and-egg as membership lookup and the same
 *     narrow answer;
 *   - revoked keys are filtered inside that function, so a route that forgets
 *     to check still cannot authenticate one;
 *   - listing never returns a hash. There is nothing useful a caller could do
 *     with it, and "nothing useful" is not the standard for handing out the
 *     verifier of a credential.
 */

import { createHash, randomBytes } from "node:crypto";
import { query } from "./sql.js";
import { currentTenantClient } from "./tenant.js";
import { CONNECTOR_BY_ID } from "../lib/connector-catalog.js";

/**
 * Distinct from the personal `amberk_live_` prefix on purpose. A key pasted
 * into the wrong field should fail on its shape, before it reaches a lookup,
 * and somebody staring at a key in a config file should be able to tell what
 * kind of thing they are holding.
 */
const PREFIX = "amberorg_live_";
const RAW_BYTES = 32;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const SCOPES = new Set(["read", "write", "admin"]);

function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function hashKey(raw) {
  return createHash("sha256").update(String(raw), "utf8").digest("hex");
}

/** Cheap shape gate, so a session token never reaches the database. */
export function looksLikeOrgKey(raw) {
  return typeof raw === "string" && raw.startsWith(PREFIX) && raw.length > PREFIX.length + 20;
}

export function normalizeScopes(input) {
  const list = Array.isArray(input) ? input : [input];
  const clean = [...new Set(list.map((s) => String(s || "").trim().toLowerCase()))].filter((s) =>
    SCOPES.has(s),
  );
  // Never mint a key that can do nothing -- it reads as broken rather than as
  // safe, and somebody will reach for `admin` next time to make it work.
  return clean.length ? clean : ["read"];
}

/* ------------------------------------------------------------------ keys */

/**
 * Mint a key. The raw value is in the return and nowhere else, ever again.
 *
 * Runs inside the caller's tenant scope, so the org_id on the row is the
 * authenticated company rather than anything a request body claimed.
 */
export async function issueOrgKey({ orgId, name, scopes, createdBy = null } = {}) {
  if (!orgId) throw new Error("org_required");
  const label = String(name || "").trim();
  if (!label) throw new Error("name_required");

  const raw = `${PREFIX}${base32(randomBytes(RAW_BYTES))}`;
  const client = currentTenantClient();
  const { rows } = await client.query(
    `INSERT INTO org_api_keys (org_id, name, key_hash, key_prefix, last4, scopes, created_by)
     VALUES ($1::uuid, $2, $3, $4, $5, $6::text[], $7::uuid)
     RETURNING id, name, key_prefix, last4, scopes, created_at, last_used_at, revoked_at`,
    [
      orgId,
      label,
      hashKey(raw),
      raw.slice(0, PREFIX.length + 4),
      raw.slice(-4),
      normalizeScopes(scopes),
      createdBy,
    ],
  );
  // The one moment the raw key is visible. The caller must hand it to the
  // person immediately and must not log it.
  return { key: rows[0], raw };
}

export async function listOrgKeys(orgId) {
  const client = currentTenantClient();
  const { rows } = await client.query(
    `SELECT k.id, k.name, k.key_prefix, k.last4, k.scopes, k.created_at,
            k.last_used_at, k.revoked_at,
            u.full_name AS created_by_name
       FROM org_api_keys k
       LEFT JOIN users u ON u.amber_id = k.created_by
      WHERE k.org_id = $1::uuid
      ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC`,
    [orgId],
  );
  return rows;
}

/**
 * Revoke, never delete.
 *
 * "This key worked until Tuesday and then somebody killed it" is the sentence
 * an incident review needs; a missing row says nothing at all. The key stops
 * authenticating the moment revoked_at is set, because the bootstrap function
 * filters on it.
 */
export async function revokeOrgKey({ orgId, keyId, revokedBy = null } = {}) {
  const client = currentTenantClient();
  const { rowCount } = await client.query(
    `UPDATE org_api_keys
        SET revoked_at = now(), revoked_by = $3::uuid
      WHERE org_id = $1::uuid AND id = $2::uuid AND revoked_at IS NULL`,
    [orgId, keyId, revokedBy],
  );
  return rowCount > 0;
}

/**
 * Turn a presented key into an org and a set of scopes, or null.
 *
 * NOT tenant-scoped, and cannot be: this is the call that discovers the
 * tenant. It goes through the definer function rather than reading the table,
 * which is the only safe way to make that exception.
 */
export async function verifyOrgKey(raw) {
  if (!looksLikeOrgKey(raw)) return null;
  const { rows } = await query(
    `SELECT org_id, key_id, key_name, scopes, org_name, org_slug
       FROM amber_api_key_bootstrap($1)`,
    [hashKey(raw)],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    orgId: r.org_id,
    keyId: r.key_id,
    name: r.key_name,
    scopes: Array.isArray(r.scopes) ? r.scopes : [],
    orgName: r.org_name,
    orgSlug: r.org_slug,
  };
}

/**
 * Last-used, best effort and deliberately not awaited by the caller.
 *
 * A request must not fail because a bookkeeping write did, and a key's
 * last-used timestamp being a few seconds stale has never mattered to anybody.
 */
export function touchOrgKey(orgId, keyId) {
  query(
    `UPDATE org_api_keys SET last_used_at = now() WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, keyId],
  ).catch(() => {});
}

/* ------------------------------------------------------------ connectors */

export async function listConnectors(orgId) {
  const client = currentTenantClient();
  const { rows } = await client.query(
    `SELECT c.id, c.provider, c.label, c.status, c.config, c.group_id,
            c.connected_by, c.created_at, c.updated_at,
            g.name AS group_name,
            u.full_name AS connected_by_name
       FROM org_connectors c
       LEFT JOIN org_groups g ON g.org_id = c.org_id AND g.id = c.group_id
       LEFT JOIN users u ON u.amber_id = c.connected_by
      WHERE c.org_id = $1::uuid
      ORDER BY c.created_at`,
    [orgId],
  );
  return rows;
}

export async function addConnector({
  orgId,
  provider,
  label = null,
  groupId = null,
  config = {},
  connectedBy = null,
} = {}) {
  const id = String(provider || "").trim();
  // The catalog is the allowlist. A provider we have never heard of is a
  // typo or somebody probing, and in neither case should it get a row.
  if (!CONNECTOR_BY_ID.has(id)) throw new Error("unknown_provider");

  const client = currentTenantClient();
  const { rows } = await client.query(
    `INSERT INTO org_connectors (org_id, provider, label, group_id, config, connected_by)
     VALUES ($1::uuid, $2, $3, $4::uuid, $5::jsonb, $6::uuid)
     ON CONFLICT DO NOTHING
     RETURNING id, provider, label, status, config, group_id, created_at`,
    [orgId, id, label ? String(label).trim() : null, groupId, JSON.stringify(config ?? {}), connectedBy],
  );
  // ON CONFLICT DO NOTHING means it was already on. Adding something that is
  // already added is not an error to a person -- the page should simply show
  // it as added -- so return the existing row rather than a 409.
  if (!rows.length) {
    const { rows: existing } = await client.query(
      `SELECT id, provider, label, status, config, group_id, created_at
         FROM org_connectors
        WHERE org_id = $1::uuid AND provider = $2
          AND group_id IS NOT DISTINCT FROM $3::uuid`,
      [orgId, id, groupId],
    );
    return existing[0] ?? null;
  }
  return rows[0];
}

export async function updateConnector({ orgId, id, label, status, config } = {}) {
  const client = currentTenantClient();
  const { rows } = await client.query(
    `UPDATE org_connectors
        SET label  = COALESCE($3, label),
            status = COALESCE($4, status),
            config = COALESCE($5::jsonb, config),
            updated_at = now()
      WHERE org_id = $1::uuid AND id = $2::uuid
      RETURNING id, provider, label, status, config, group_id, created_at`,
    [
      orgId,
      id,
      label === undefined ? null : label,
      status === undefined ? null : status,
      config === undefined ? null : JSON.stringify(config),
    ],
  );
  return rows[0] ?? null;
}

export async function removeConnector({ orgId, id } = {}) {
  const client = currentTenantClient();
  const { rowCount } = await client.query(
    `DELETE FROM org_connectors WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, id],
  );
  return rowCount > 0;
}
