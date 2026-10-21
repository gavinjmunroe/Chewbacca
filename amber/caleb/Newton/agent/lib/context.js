/**
 * Context loading: pull the tenant's relevant memory from Pinecone via
 * amber-id. Two entry points:
 *
 *   loadAmberContext(tenant)
 *     — Startup / baseline load. Pulls a generic high-signal set of
 *       chunks (name, identity, current projects, top people) that
 *       should always be in the prompt. Cached per-tenant for 10 min.
 *
 *   fetchRelevantContext({ tenant, query, topK })
 *     — Per-message dynamic load. Embeds the incoming user message and
 *       returns the top-K matching chunks. Used to augment the baseline
 *       context with query-specific recall.
 *
 * Both go through amber-id `/knowledge/query-as` (service-auth, scoped
 * to the tenant's Pinecone namespace). No GitHub, no Supabase.
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "./constants.js";

const CONTEXT_CHAR_LIMIT = 40000;
const BASELINE_TOP_K = 24;
const DYNAMIC_TOP_K = 8;
const CACHE_TTL = 10 * 60 * 1000;

function storageAvailable() {
  return !!(AMBER_ID_API_URL && AMBER_ID_API_KEY);
}

function tenantDidOf(tenant) {
  if (!tenant) return null;
  return tenant.privyDid || tenant.amberId || tenant.id || null;
}

async function queryAmberId({ targetDid, text, topK }) {
  // Synthetic expert tenants don't have amber-id user rows — skip the
  // round-trip instead of 404ing on every recall.
  if (typeof targetDid === "string" && targetDid.startsWith("did:expert:")) {
    return [];
  }
  const res = await fetch(`${AMBER_ID_API_URL}/knowledge/query-as`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": AMBER_ID_API_KEY,
    },
    body: JSON.stringify({ target_did: targetDid, text, topK }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    // 404 target_user_not_found is the common case for unknown
    // tenants — silently ignore. Real errors still warn.
    if (res.status === 404) return [];
    const body = await res.text().catch(() => "");
    console.warn(`[context] query-as ${res.status}: ${body.slice(0, 200)}`);
    return [];
  }
  const data = await res.json().catch(() => null);
  return Array.isArray(data?.matches) ? data.matches : [];
}

function renderMatches(matches) {
  const seen = new Set();
  const chunks = [];
  for (const m of matches) {
    const text = m?.metadata?.text;
    if (!text || seen.has(text)) continue;
    seen.add(text);
    chunks.push(text);
  }
  return chunks.join("\n\n---\n\n");
}

function trimTo(text, limit) {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "\n\n[Context trimmed to fit prompt budget.]";
}

/**
 * Baseline context: who the user is, what they're working on, who
 * matters most. Cached per-tenant so startup and early messages are
 * fast. The seed query is intentionally broad so Pinecone returns a
 * high-signal sampling across all six dimensions.
 */
export async function loadAmberContext(tenant = null) {
  const did = tenantDidOf(tenant);
  if (!storageAvailable() || !did) return "";

  const now = Date.now();
  const cacheKey = did;
  const cache = loadAmberContext._cache || new Map();
  loadAmberContext._cache = cache;

  const cached = cache.get(cacheKey);
  if (cached && now - cached.fetchedAt < CACHE_TTL) {
    return cached.text;
  }

  const matches = await queryAmberId({
    targetDid: did,
    text:
      "Who is this person? Their identity, work, relationships, values, " +
      "current projects, and health across spiritual, emotional, physical, " +
      "intellectual, social, financial dimensions.",
    topK: BASELINE_TOP_K,
  });
  const text = trimTo(renderMatches(matches), CONTEXT_CHAR_LIMIT);
  cache.set(cacheKey, { text, fetchedAt: now });
  return text;
}

/**
 * Per-message relevance: embed the incoming user text and pull the
 * top-K chunks that match. Always returns fresh; do not cache per
 * query because the query itself is the cache key.
 */
export async function fetchRelevantContext({ tenant, query, topK } = {}) {
  const did = tenantDidOf(tenant);
  if (!storageAvailable() || !did || !query || typeof query !== "string") {
    return "";
  }
  const matches = await queryAmberId({
    targetDid: did,
    text: query,
    topK: Number(topK) || DYNAMIC_TOP_K,
  });
  return trimTo(renderMatches(matches), 12000);
}

/**
 * No-op kept for backwards compatibility with agent.js startup calls
 * that used to sync GitHub context. Context is now ingested via the
 * `scripts/migrate-github-context-to-amber-id.js` one-shot script.
 */
export async function syncContextToSupabase() {
  return;
}
