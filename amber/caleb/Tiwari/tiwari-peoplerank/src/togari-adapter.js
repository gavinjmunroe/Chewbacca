/**
 * togari-peoplerank adapter.
 *
 * Pinned at SHA via `vendor/togari/` git submodule.
 *
 * Upstream exposes two surfaces:
 *   1. An MCP server (stdio + SSE) — used by Claude Code and other MCP clients.
 *   2. An Express HTTP surface (added by us under `blue-modern-advisory/togari`
 *      cadence): /health, /rank, /score, /search.
 *
 * This adapter speaks to the HTTP surface via fetch. We DO NOT import the
 * vendored TypeScript directly — that code is compiled and runs as its own
 * process, and it's owned by the BMA team on their cadence. We treat it like
 * any other upstream service. The submodule exists so we can read the source
 * for review and pin the deployed version auditably.
 *
 * Env:
 *   TOGARI_PEOPLERANK_URL    default = https://togari-amber-production.up.railway.app
 *   TOGARI_PEOPLERANK_API_KEY
 *   TOGARI_PEOPLERANK_TIMEOUT_MS = 4000
 *
 * If the upstream is unavailable, callers fall through to Newton + amber-id
 * only.
 */

const BASE_URL =
  process.env.TOGARI_PEOPLERANK_URL ||
  process.env.PEOPLERANK_BASE_URL ||
  "https://togari-amber-production.up.railway.app";
const API_KEY =
  process.env.TOGARI_PEOPLERANK_API_KEY || process.env.PEOPLERANK_API_KEY || "";
const TIMEOUT_MS = Number(
  process.env.TOGARI_PEOPLERANK_TIMEOUT_MS ||
    process.env.PEOPLERANK_TIMEOUT_MS ||
    4000,
);

async function post(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${BASE_URL.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(API_KEY ? { "x-api-key": API_KEY } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(
        `togari-peoplerank ${resp.status}: ${text.slice(0, 200)}`,
      );
    }
    return resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * /search — natural-language contact search (backed by BigQuery).
 * Falls back to an empty array if the upstream doesn't implement /search yet
 * (the BMA team is shipping it; in the meantime we return nothing and Tiwari
 * produces a Newton + amber-id-only result).
 */
export async function search({ query, filters, topK = 20, ownerDid = null }) {
  try {
    const data = await post("/search", {
      natural_language_query: query,
      filters,
      top_k: topK,
      ...(ownerDid ? { owner_did: ownerDid } : {}),
    });
    if (!data || !Array.isArray(data.results)) return [];
    return data.results.map(normalizeResult);
  } catch (err) {
    // Don't mask configuration errors as "feature unavailable"
    if (err.name === "AbortError") throw new Error("togari timeout");
    if (String(err.message).startsWith("togari-peoplerank 404")) {
      // upstream doesn't have /search yet — treat as soft-miss
      return [];
    }
    throw err;
  }
}

/**
 * /rank — re-rank an explicit candidate list against a context.
 */
export async function rank({ context, candidates, ownerCnft }) {
  const data = await post("/rank", {
    context,
    candidates,
    owner_cnft: ownerCnft || null,
  });
  return Array.isArray(data?.rankings) ? data.rankings : [];
}

/**
 * /score — single-pair compatibility score (mirrors Python scorer).
 */
export async function score({ owner, person }) {
  return post("/score", { owner, person });
}

/**
 * /health — alive-check; used by Tiwari's /status aggregator.
 */
export async function ping() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${BASE_URL.replace(/\/$/, "")}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return { healthy: resp.ok, status: resp.status };
  } catch (err) {
    return { healthy: false, error: err.message };
  }
}

/**
 * Normalize whatever togari returns into a canonical Result object so the
 * blender can mix it with Newton and amber-id results.
 */
function normalizeResult(raw) {
  return {
    id: raw.id || raw.person_id || raw.contact_id || null,
    name: raw.name || raw.display_name || raw.full_name || null,
    score: typeof raw.score === "number" ? raw.score : null,
    source: "togari",
    meta: {
      email: raw.email || null,
      company: raw.company || null,
      title: raw.title || null,
      city: raw.city || null,
      ...raw,
    },
  };
}
