/**
 * amber-id-client — thin, typed HTTP client for the sibling `amber-id` repo.
 *
 * amber-id lives at: https://amber-id-production.up.railway.app
 * Source:            github.com/amber-organization/amber-id
 *
 * This client is the only sanctioned way for Tiwari services (and, via
 * amber-agent, anyone else) to read the user's private Pinecone KB or mint
 * their cNFT identity.
 *
 * Auth model:
 *   - User-scoped calls (/ask, /knowledge/*) pass the caller's Privy JWT.
 *   - Admin/internal calls (tenant resolution, audit) pass AMBER_ID_API_KEY.
 *
 * Every method supports an AbortController `signal` and a per-call `timeoutMs`.
 * Default timeout = 8000ms. All errors are thrown with a .code and .status.
 */

const DEFAULT_BASE_URL =
  process.env.AMBER_ID_BASE_URL || "https://amber-id-production.up.railway.app";
const DEFAULT_TIMEOUT = Number(process.env.AMBER_ID_TIMEOUT_MS || 8000);

export class AmberIdError extends Error {
  constructor(message, { code, status, body } = {}) {
    super(message);
    this.name = "AmberIdError";
    this.code = code || "amber_id_error";
    this.status = status || 0;
    this.body = body || null;
  }
}

async function request(
  path,
  { method = "GET", headers = {}, body, token, apiKey, timeoutMs, signal } = {},
) {
  const baseUrl = (headers["x-base-url"] || DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  delete headers["x-base-url"];
  const url = `${baseUrl}${path}`;

  const hdrs = {
    "content-type": "application/json",
    ...headers,
  };
  if (token) hdrs["authorization"] = `Bearer ${token}`;
  if (apiKey) hdrs["x-api-key"] = apiKey;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs || DEFAULT_TIMEOUT,
  );
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let resp;
  try {
    resp = await fetch(url, {
      method,
      headers: hdrs,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new AmberIdError(`Network error calling amber-id: ${err.message}`, {
      code: "network_error",
    });
  }
  clearTimeout(timer);

  const ct = resp.headers.get("content-type") || "";
  const data = ct.includes("application/json")
    ? await resp.json().catch(() => null)
    : await resp.text().catch(() => null);

  if (!resp.ok) {
    throw new AmberIdError(
      `amber-id ${resp.status} ${resp.statusText}: ${
        (data && (data.message || data.error)) || "unknown error"
      }`,
      {
        code: (data && data.error) || "amber_id_http_error",
        status: resp.status,
        body: data,
      },
    );
  }
  return data;
}

// ─── Identity ────────────────────────────────────────────────────────────────

/**
 * POST /identity/mint  — mint a cNFT for the caller.
 */
export async function mintIdentity({ token, ownerPubkey, metadataUri, extra }) {
  if (!token) throw new AmberIdError("token required", { code: "no_token" });
  if (!ownerPubkey)
    throw new AmberIdError("ownerPubkey required", { code: "no_owner" });
  return request("/identity/mint", {
    method: "POST",
    token,
    body: { ownerPubkey, metadataUri, ...(extra || {}) },
  });
}

/**
 * GET /identity/me  — current user's cNFT record.
 */
export async function getIdentity({ token }) {
  return request("/identity/me", { token });
}

/**
 * GET /identity/:assetId/verify  — public verification of a cNFT owner.
 */
export async function verifyIdentity({ assetId, owner }) {
  return request(
    `/identity/${encodeURIComponent(assetId)}/verify?owner=${encodeURIComponent(owner)}`,
  );
}

// ─── Knowledge ───────────────────────────────────────────────────────────────

/**
 * POST /knowledge/ingest  — add vectors to caller's private KB.
 * items: [{ text, personId?, personName?, kind?, source?,
 *           healthDimension?, visibility?, createdAt?, extra? }]
 */
export async function ingest({ token, items }) {
  return request("/knowledge/ingest", {
    method: "POST",
    token,
    body: { items },
  });
}

/**
 * POST /knowledge/query  — raw semantic search of caller's private KB.
 */
export async function query({ token, text, topK, filter }) {
  return request("/knowledge/query", {
    method: "POST",
    token,
    body: { text, topK, filter },
  });
}

/**
 * POST /knowledge/forget  — delete vectors (by id list or all).
 */
export async function forget({ token, ids, all }) {
  return request("/knowledge/forget", {
    method: "POST",
    token,
    body: { ids, all },
  });
}

/**
 * GET /knowledge/stats  — vector count + index info for the caller.
 */
export async function stats({ token }) {
  return request("/knowledge/stats", { token });
}

// ─── Ask Amber ───────────────────────────────────────────────────────────────

/**
 * POST /ask  — people-centric synthesized answer over caller's private KB.
 * Returns { ok, answer, people, citations, model, usedPeopleRank, tookMs }.
 */
export async function ask({
  token,
  question,
  messages,
  topK,
  filter,
  timeoutMs,
}) {
  return request("/ask", {
    method: "POST",
    token,
    body: { question, messages, topK, filter },
    timeoutMs: timeoutMs || 20000, // /ask can take longer — LLM synthesis
  });
}

// ─── Internal / admin ────────────────────────────────────────────────────────

/**
 * GET /status  — health + Privy + PG connectivity.
 */
export async function status() {
  return request("/status");
}

/**
 * Tenant resolution (requires AMBER_ID_API_KEY). Used by amber-agent when a
 * Loop Message / Twilio webhook arrives and we need to find the user.
 */
export async function resolveTenant({ loopSenderId, apiKey }) {
  return request(`/tenants/${encodeURIComponent(loopSenderId)}`, {
    apiKey: apiKey || process.env.AMBER_ID_API_KEY,
  });
}

export default {
  mintIdentity,
  getIdentity,
  verifyIdentity,
  ingest,
  query,
  forget,
  stats,
  ask,
  status,
  resolveTenant,
};
