/**
 * agent_data / agent_log — the generic jsonb row store the agent surfaces use.
 *
 * THIS CODE WAS ALREADY POSTGRES. It lived in a file called db/firestore.js whose
 * docstring said "GCP Firestore as the sole data store for amber-id", two lines
 * above `import { query } from "./sql.js"`. Every function here has been reading
 * and writing Cloud SQL since Chunk 4b; only the filename and the comment still
 * said otherwise, which is why four route files believed they depended on
 * Firestore when they did not.
 *
 * The genuinely-Firestore half of that file -- getUserByPrivyDid, upsertUser,
 * getFirestore, firestoreReady and the cNFT user document -- is gone, along with
 * the dependency. Nothing in this service talks to Firestore.
 *
 * Two tables, both owner-scoped:
 *
 *   agent_data  (owner_id, table_name, row_key, row jsonb)  upserted, soft-deleted
 *   agent_log   (owner_id, table_name, row jsonb)           append-only
 *
 * The caller addresses rows by a tenant DID; resolveOwner turns that into the
 * amber_id every statement is scoped by, so a caller can never read another
 * tenant's rows by asking for a different table name.
 */

import { collectionName } from "../lib/instance.js";
import { query } from "./sql.js";
import { resolveAmberIdByPrivyDid } from "./store.js";

let initPromise = null;

// ─── users collection ───────────────────────────────────────────────────────

// ─── agent_data (keyed jsonb) and agent_log (append-only) ───────────────────

function normalizeTenant(tenant) {
  const did = tenant?.privyDid || tenant?.amberId || tenant?.id || tenant;
  if (!did || typeof did !== "string") return null;
  // Legacy: Firestore doc ids couldn't contain "/". DIDs never do, so this is a
  // no-op for real inputs; kept so the extraction logic is byte-identical.
  return did.replace(/\//g, "_");
}

// Resolve a tenant handle → amber_id (the owner_id key), or null.
async function resolveOwner(tenantDid) {
  const did = normalizeTenant(tenantDid);
  if (!did) return null;
  return resolveAmberIdByPrivyDid(did);
}

// SQL operator map — mirrors the old firestoreOp map exactly. Any op NOT in
// here (e.g. "array-contains") is SKIPPED, reproducing the prior behavior where
// firestoreOp() returned null and the filter was dropped.
const SQL_OP = {
  eq: "=",
  neq: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
};

// Build WHERE fragments + params for a filter list. Both the jsonb key and the
// value are bound params (never interpolated), so a user-supplied col/value in
// routes/data.js cannot inject. Values compare as text (row->>key), matching
// the eq-on-string filters every caller uses; unmappable ops are skipped.
function applyFilters(filters, where, params) {
  if (!Array.isArray(filters)) return;
  for (const f of filters) {
    if (!f?.col || !f?.op) continue;
    const op = SQL_OP[String(f.op).toLowerCase()];
    if (!op) continue; // e.g. array-contains — not translatable, skip (as before)
    params.push(f.col);
    const colP = params.length;
    params.push(f.value == null ? null : String(f.value));
    const valP = params.length;
    where.push(`row->>$${colP} ${op} $${valP}`);
  }
}

export async function agentDataGet({ tenantDid, table, rowKey }) {
  if (!tenantDid || !table || !rowKey) return null;
  const ownerId = await resolveOwner(tenantDid);
  if (!ownerId) return null;
  try {
    const { rows } = await query(
      `SELECT row FROM agent_data
        WHERE owner_id = $1 AND table_name = $2 AND row_key = $3 AND deleted_at IS NULL
        LIMIT 1`,
      [ownerId, table, rowKey],
    );
    return rows[0]?.row ?? null;
  } catch {
    return null;
  }
}

export async function agentDataUpsert({ tenantDid, table, rowKey, row }) {
  if (!tenantDid || !table || !rowKey || !row) return;
  const ownerId = await resolveOwner(tenantDid);
  if (!ownerId) {
    console.warn(`[agent_data] upsert: tenant ${tenantDid} does not resolve to an amber owner — skipping ${table}/${rowKey}`);
    return;
  }
  // Fold tenant_did/table_name/row_key/updated_at into the stored jsonb for
  // read parity with the Firestore docs. Callers do read-modify-write with full
  // objects, so row = EXCLUDED.row (replace) matches the old merge:true result.
  const stored = {
    ...row,
    tenant_did: tenantDid,
    table_name: table,
    row_key: rowKey,
    updated_at: new Date().toISOString(),
  };
  await query(
    `INSERT INTO agent_data (owner_id, table_name, row_key, row)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (owner_id, table_name, row_key) DO UPDATE
       SET row = EXCLUDED.row, updated_at = now(), deleted_at = NULL`,
    [ownerId, table, rowKey, JSON.stringify(stored)],
  );
}

export async function agentDataQuery({
  tenantDid,
  table,
  filters,
  limit = 100,
  order,
}) {
  if (!table) return [];
  const ownerId = await resolveOwner(tenantDid);
  if (!ownerId) return [];
  const params = [ownerId, table];
  const where = ["owner_id = $1", "table_name = $2", "deleted_at IS NULL"];
  applyFilters(filters, where, params);
  let sql = `SELECT row FROM agent_data WHERE ${where.join(" AND ")}`;
  if (order?.col) {
    params.push(order.col);
    const dir = order.dir === "asc" ? "ASC" : "DESC";
    sql += ` ORDER BY row->>$${params.length} ${dir}`;
  }
  params.push(Math.max(1, Math.min(limit || 100, 500)));
  sql += ` LIMIT $${params.length}`;
  try {
    const { rows } = await query(sql, params);
    return rows.map((r) => r.row);
  } catch {
    return [];
  }
}

export async function agentDataDelete({ tenantDid, table, rowKey }) {
  if (!table || !rowKey) return;
  const ownerId = await resolveOwner(tenantDid);
  if (!ownerId) {
    console.warn(`[agent_data] delete: tenant ${tenantDid} does not resolve to an amber owner — skipping ${table}/${rowKey}`);
    return;
  }
  // Soft-delete so a later re-upsert can revive the row (deleted_at = NULL).
  await query(
    `UPDATE agent_data SET deleted_at = now()
      WHERE owner_id = $1 AND table_name = $2 AND row_key = $3`,
    [ownerId, table, rowKey],
  );
}

export async function agentLogQuery({
  tenantDid,
  table,
  filters,
  limit = 100,
  order,
}) {
  if (!table) return [];
  const ownerId = await resolveOwner(tenantDid);
  if (!ownerId) return [];
  const params = [ownerId, table];
  const where = ["owner_id = $1", "table_name = $2"];
  applyFilters(filters, where, params);
  let sql = `SELECT row FROM agent_log WHERE ${where.join(" AND ")}`;
  if (order?.col) {
    params.push(order.col);
    const dir = order.dir === "asc" ? "ASC" : "DESC";
    sql += ` ORDER BY row->>$${params.length} ${dir}`;
  } else {
    // Default: newest-first by the real created_at column.
    sql += ` ORDER BY created_at DESC`;
  }
  params.push(Math.max(1, Math.min(limit || 100, 1000)));
  sql += ` LIMIT $${params.length}`;
  try {
    const { rows } = await query(sql, params);
    return rows.map((r) => r.row);
  } catch {
    return [];
  }
}

export async function agentLogInsert({ tenantDid, table, row }) {
  if (!tenantDid || !table || !row) return;
  const ownerId = await resolveOwner(tenantDid);
  if (!ownerId) {
    console.warn(`[agent_log] insert: tenant ${tenantDid} does not resolve to an amber owner — skipping ${table}`);
    return;
  }
  const now = new Date();
  // Keep tenant_did/table_name/created_at/created_ts inside the jsonb for parity.
  const stored = {
    ...row,
    tenant_did: tenantDid,
    table_name: table,
    created_at: now.toISOString(),
    created_ts: now.getTime(),
  };
  await query(
    `INSERT INTO agent_log (owner_id, table_name, row) VALUES ($1, $2, $3::jsonb)`,
    [ownerId, table, JSON.stringify(stored)],
  );
}

