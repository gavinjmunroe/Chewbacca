/**
 * Semantic memory: long-term storage for facts, ideas, people, projects.
 *
 * Memories live in the tenant's Pinecone namespace via amber-id
 * `/knowledge/ingest-as` and `/knowledge/query-as` (x-api-key auth). The
 * legacy `memories` Postgres table is retired.
 *
 * Each memory becomes one Pinecone item:
 *   text              ← memory.content
 *   kind              ← memory.category (defaults "memory")
 *   personId          ← memory.handle (phone/email) when present
 *   healthDimension   ← memory.dimensions[0] (defaults "intellectual")
 *   source            ← memory.source
 *   extra             ← { confidence, tags, dimensions }
 *
 * amber-id owns embeddings (Perplexity int8 / 2560-dim). The agent does
 * not compute vectors locally anymore; we only hand over text.
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "./constants.js";

function tenantDidOf(tenant) {
  if (!tenant) return null;
  return tenant.privyDid || tenant.amberId || tenant.id || null;
}

function storageAvailable() {
  return !!(AMBER_ID_API_URL && AMBER_ID_API_KEY);
}

// Synthetic expert tenants (e.g. did:expert:medha) don't exist in
// amber-id's user table, so /knowledge/ingest-as 404s on every call.
// We swallow that case silently — embeddings already write to
// BigQuery medha_conversations independently, so the agent loses
// nothing by skipping the Pinecone fallback. Real-user tenants still
// see their errors.
function isSyntheticTenantDid(did) {
  return typeof did === "string" && did.startsWith("did:expert:");
}

async function ingestAs(did, items) {
  if (isSyntheticTenantDid(did)) return null;
  const res = await fetch(`${AMBER_ID_API_URL}/knowledge/ingest-as`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": AMBER_ID_API_KEY,
    },
    body: JSON.stringify({ target_did: did, items }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // 404 target_user_not_found is the expected case for legacy
    // tenants that never made it into amber-id; downgrade to a
    // single-line debug rather than a warning so the logs stay clean.
    if (res.status === 404) {
      return null;
    }
    const body = await res.text().catch(() => "");
    console.warn(`[memory] ingest-as ${res.status}: ${body.slice(0, 200)}`);
    return null;
  }
  return res.json().catch(() => null);
}

async function queryAs(did, text, topK) {
  if (isSyntheticTenantDid(did)) return [];
  const res = await fetch(`${AMBER_ID_API_URL}/knowledge/query-as`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": AMBER_ID_API_KEY,
    },
    body: JSON.stringify({ target_did: did, text, topK }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  return Array.isArray(data?.matches) ? data.matches : [];
}

export function memoryToPineconeItem(memory) {
  const dim =
    (Array.isArray(memory.dimensions) && memory.dimensions[0]) ||
    "intellectual";
  const extra = {
    confidence: typeof memory.confidence === "number" ? memory.confidence : 0.8,
    tags: Array.isArray(memory.tags) ? memory.tags : [],
    dimensions: Array.isArray(memory.dimensions) ? memory.dimensions : [],
  };
  // Forward caller-supplied extra fields so Pinecone records carry
  // filterable metadata. This started as a Tab 5 whitelist (org,
  // assetType, sourceUrl, use_for_training, user_intent, title) but Tab 14
  // generalized it: every data path that writes to Pinecone (file content,
  // image content, conversation turns, content seeds) needs its own
  // filterable fields (filename, extractor, page_or_section, contact, ...).
  // pinecone.js sanitizes the resulting metadata (strips null/undefined,
  // JSON-stringifies nested objects), so a generic passthrough is safe and
  // keeps every kind from having to edit this whitelist in lockstep.
  if (memory.extra && typeof memory.extra === "object") {
    for (const [key, value] of Object.entries(memory.extra)) {
      if (value === null || value === undefined) continue;
      extra[key] = value;
    }
  }
  return {
    text: memory.content,
    kind: memory.category || "memory",
    personId: memory.handle || undefined,
    healthDimension: dim,
    source: memory.source || "inferred",
    extra,
  };
}

/**
 * Save a memory to the tenant's Pinecone namespace.
 */
export async function saveMemory(memory, tenant = null) {
  if (!storageAvailable() || !memory?.content) return;
  const did = tenantDidOf(tenant);
  if (!did) return;
  try {
    await ingestAs(did, [memoryToPineconeItem(memory)]);
  } catch (err) {
    console.error("[saveMemory] error:", err.message);
  }
}

/**
 * Batch save memories in one /knowledge/ingest-as call.
 */
export async function saveMemories(memories, tenant = null) {
  if (!storageAvailable()) return;
  const did = tenantDidOf(tenant);
  if (!did) return;
  const items = (memories || [])
    .filter((m) => m && m.content)
    .map(memoryToPineconeItem);
  if (items.length === 0) return;
  try {
    const result = await ingestAs(did, items);
    if (result?.ok) {
      console.log(`[memory] Saved ${items.length} memories to Pinecone`);
    }
  } catch (err) {
    console.error("[saveMemories] error:", err.message);
  }
}

/**
 * Semantic search over a tenant's Pinecone memory. Optionally filter to a
 * specific handle (person) — we post-filter client-side since metadata
 * filtering would require Pinecone-level filter expressions and the hit
 * rate on our current volume is fine without them.
 */
export async function searchMemories(
  query,
  handle = null,
  limit = 5,
  tenant = null,
  options = {},
) {
  if (!storageAvailable() || !query) return [];
  const did = tenantDidOf(tenant);
  if (!did) return [];
  // Tab 5 — optional post-filter by org so callers can scope semantic
  // recall to a single organization's asset namespace.
  const orgFilter = options?.org ? String(options.org).toLowerCase() : null;
  try {
    const matches = await queryAs(did, query, Math.max(limit * 3, 12));
    const mapped = matches.map((m) => {
      const md = m.metadata || {};
      return {
        id: m.id,
        content: md.text || "",
        handle: md.person_id || null,
        category: md.kind || "memory",
        dimensions: md.health_dimension ? [md.health_dimension] : [],
        source: md.source || "pinecone",
        confidence: m.score || 0,
        score: m.score || 0,
        org: md.org || null,
        assetType: md.assetType || null,
        sourceUrl: md.sourceUrl || null,
      };
    });
    let filtered = handle
      ? mapped.filter((m) => !m.handle || m.handle === handle)
      : mapped;
    if (orgFilter) {
      filtered = filtered.filter((m) => !m.org || m.org === orgFilter);
    }
    return filtered.slice(0, limit);
  } catch (err) {
    console.error("[searchMemories] error:", err.message);
    return [];
  }
}
