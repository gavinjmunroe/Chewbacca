/**
 * Data-plane client. Every read and write is forwarded to amber-id's
 * `/v1/data/*` endpoints, which own the GCP Firestore operational store
 * behind the scenes.
 *
 * Private per-user knowledge (context, memories, per-dimension graphs) uses
 * a different client — see `lib/memory.js` and `lib/context.js`, which call
 * amber-id's `/knowledge/*` Pinecone endpoints through the amber-id-client.
 *
 * Callers pass a tenant object; we extract the Privy DID for the row key.
 * If amber-id is unreachable or credentials are missing, operations throw.
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "./constants.js";

class AmberDataError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.name = "AmberDataError";
    this.code = code || "amber_data_error";
    this.status = status || 0;
  }
}

function requireAmberId() {
  if (!AMBER_ID_API_URL || !AMBER_ID_API_KEY) {
    throw new AmberDataError(
      "AMBER_ID_API_URL and AMBER_ID_API_KEY are required.",
      { code: "amber_id_not_configured" },
    );
  }
}

function tenantDidOf(tenant) {
  if (!tenant) return null;
  return tenant.privyDid || tenant.amberId || tenant.id || null;
}

async function callAmberId(path, body) {
  requireAmberId();
  const url = `${AMBER_ID_API_URL}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": AMBER_ID_API_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    console.warn(`[amber-id] ${path} ${res.status}: ${err.slice(0, 200)}`);
    return null;
  }
  return res.json().catch(() => null);
}

// ────────────────────────────────────────────────────────────────────────
// Public API (same names the rest of amber-agent already imports)
// ────────────────────────────────────────────────────────────────────────

export async function sbGet(table, filter, tenant = null) {
  const tenantDid = tenantDidOf(tenant);
  if (!tenantDid) return null;
  const body = await callAmberId(`/v1/data/${table}/get`, {
    tenant_did: tenantDid,
    filter: filter || "",
  });
  return body?.data || null;
}

export async function sbUpsert(table, row, tenant = null) {
  const tenantDid = tenantDidOf(tenant);
  if (!tenantDid || !row) return;
  await callAmberId(`/v1/data/${table}/upsert`, {
    tenant_did: tenantDid,
    row,
  });
}

export async function sbInsert(table, row, tenant = null) {
  const tenantDid = tenantDidOf(tenant);
  if (!tenantDid || !row) return;
  await callAmberId(`/v1/data/${table}/insert`, {
    tenant_did: tenantDid,
    row,
  });
}

export async function sbQuery(table, filter, options = {}) {
  const tenant = options.tenant || null;
  const tenantDid = tenantDidOf(tenant);
  if (!tenantDid) return [];
  const body = await callAmberId(`/v1/data/${table}/query`, {
    tenant_did: tenantDid,
    filter: filter || "",
    limit: options.limit || 100,
    order: options.order || "",
  });
  return Array.isArray(body?.data) ? body.data : [];
}

export async function logInteraction(
  fromHandle,
  messageIn,
  messageOut,
  model,
  tenant = null,
) {
  const row = {
    from_handle: fromHandle,
    message_in: messageIn,
    message_out: messageOut,
    model: model || null,
  };
  try {
    await sbInsert("interactions", row, tenant);
  } catch (err) {
    console.error("[logInteraction] error:", err?.message);
  }
}

// Back-compat alias for any remaining importers. Remove once fully migrated.
export const logInteractionToSupabase = logInteraction;

export { AmberDataError };
