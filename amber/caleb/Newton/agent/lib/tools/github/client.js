/**
 * github/client.js — GitHub REST API client backed by per-tenant OAuth.
 *
 * Tokens come from the medha-id secrets bag (GITHUB_OAUTH_ACCESS), set by
 * the OAuth callback in medha-id. Classic OAuth Apps with non-expiring
 * tokens have no refresh path — the access token lives until the user
 * disconnects via medha-frontend or revokes from github.com/settings.
 *
 * Per CLAUDE.md, we never fall back to env vars for per-user state. If
 * the tenant has no access token, callers get a structured NOT_CONNECTED
 * shape that includes a connect link the agent surfaces verbatim.
 *
 * NOT_CONNECTED is a thrown Error with `code = "github_not_connected"`
 * and a `suggestConnect` field so the tool dispatcher can render the
 * agent-facing connect-link message without paying a second secrets
 * round-trip.
 */

import { getSecret } from "../../secrets.js";

const GITHUB_API = "https://api.github.com";
const GITHUB_ACCEPT = "application/vnd.github+json";
const GITHUB_USER_AGENT = "medha-platform";
const GITHUB_API_VERSION = "2022-11-28";

function frontendBase() {
  const raw = process.env.MEDHA_FRONTEND_URL || "";
  if (raw) return raw.replace(/\/+$/, "");
  // Per OAUTH_INTEGRATION_PLAYBOOK: the -5f4f hostname is the only correct
  // medha-frontend deploy. Anything else is a different app.
  return "https://www.justarock.ai";
}

export function connectPageUrl() {
  return `${frontendBase()}/connect`;
}

/**
 * NOT_CONNECTED shape: a structured payload the tool layer can return
 * verbatim. Includes `suggestConnect: true` so the agent loop can render
 * a connect link to the user without inventing copy.
 */
export function buildNotConnected() {
  const url = connectPageUrl();
  return {
    error: "github_not_connected",
    suggestConnect: true,
    connect_url: url,
    message: `GitHub isn't connected to your medha-id yet. Connect it here and ask me again: ${url}`,
  };
}

/**
 * Resolve the access token + connected-account handle for a tenant.
 * Returns { token, handle } when both are present; null when GitHub
 * isn't connected for this tenant.
 *
 * No env fallback — per-tenant isolation requires every call to be
 * grounded in a real tenant's bag.
 */
export async function resolveGithubAuth(tenant) {
  if (!tenant) return null;
  const [token, handle] = await Promise.all([
    getSecret(tenant, "GITHUB_OAUTH_ACCESS").catch(() => null),
    getSecret(tenant, "GITHUB_OAUTH_ACCOUNT_HANDLE").catch(() => null),
  ]);
  if (!token) return null;
  return { token, handle: handle || null };
}

/**
 * Authenticated fetch wrapper. Throws a "github_not_connected" error
 * (with the NOT_CONNECTED payload attached) when the tenant has no
 * token. All other errors propagate to the caller with the GitHub
 * response body parsed into `err.githubError`.
 *
 * `path` is the part after https://api.github.com, leading slash
 * included (e.g. "/user", "/repos/calebnewtonusc/foo/contents/README.md").
 */
export async function githubFetch(tenant, path, init = {}) {
  const auth = await resolveGithubAuth(tenant);
  if (!auth) {
    const notConnected = buildNotConnected();
    const err = new Error(notConnected.message);
    err.code = "github_not_connected";
    err.notConnected = notConnected;
    throw err;
  }

  const url = path.startsWith("http")
    ? path
    : `${GITHUB_API}${path.startsWith("/") ? path : `/${path}`}`;

  const headers = {
    Authorization: `Bearer ${auth.token}`,
    Accept: GITHUB_ACCEPT,
    "User-Agent": GITHUB_USER_AGENT,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    ...(init.headers || {}),
  };

  const res = await fetch(url, {
    ...init,
    headers,
    signal: init.signal || AbortSignal.timeout(20_000),
  });

  if (res.status === 204) return { ok: true, status: 204, data: null };

  // GitHub returns JSON for both success and error paths. We always try
  // to parse, but tolerate empty bodies (some endpoints return text).
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const err = new Error(
      `github_api_${res.status}:${data?.message || "unknown"}`,
    );
    err.code = `github_api_${res.status}`;
    err.status = res.status;
    err.githubError = data;
    throw err;
  }

  return { ok: true, status: res.status, data };
}

/**
 * Paginated fetch — walks `Link: <...>; rel="next"` until exhausted.
 * Returns the concatenated array. Caps at `maxPages` to avoid runaway
 * walks on accounts with thousands of repos. Default cap = 10 (≈ 1000
 * items at per_page=100).
 */
export async function githubFetchPaginated(
  tenant,
  path,
  { maxPages = 10, perPage = 100, init = {} } = {},
) {
  const out = [];
  const sep = path.includes("?") ? "&" : "?";
  let next = `${path}${sep}per_page=${perPage}`;
  let page = 0;
  while (next && page < maxPages) {
    const auth = await resolveGithubAuth(tenant);
    if (!auth) {
      const notConnected = buildNotConnected();
      const err = new Error(notConnected.message);
      err.code = "github_not_connected";
      err.notConnected = notConnected;
      throw err;
    }
    const url = next.startsWith("http") ? next : `${GITHUB_API}${next}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${auth.token}`,
        Accept: GITHUB_ACCEPT,
        "User-Agent": GITHUB_USER_AGENT,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        ...(init.headers || {}),
      },
      signal: init.signal || AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`github_api_${res.status}:${text.slice(0, 200)}`);
      err.code = `github_api_${res.status}`;
      err.status = res.status;
      throw err;
    }
    const batch = await res.json();
    if (Array.isArray(batch)) out.push(...batch);
    next = parseNextLink(res.headers.get("link"));
    page += 1;
  }
  return out;
}

function parseNextLink(link) {
  if (!link) return null;
  // Link headers look like: <https://api.github.com/...&page=2>; rel="next", <...>; rel="last"
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Resolve a short repo name ("tizzy") into "owner/repo" using the
 * connected user's GitHub handle. If the user already passed
 * "owner/repo", returns it unchanged.
 *
 * Falls back to fuzzy-matching against the user's own repos when the
 * straight "handle/short" lookup returns 404 — covers cases like
 * abbreviating "amber-organization/medha-id" to "medha-id".
 */
export async function resolveRepoName(tenant, shortName) {
  if (!shortName || typeof shortName !== "string") {
    throw new Error("repo name required");
  }
  if (shortName.includes("/")) return shortName;

  const auth = await resolveGithubAuth(tenant);
  if (!auth) {
    const notConnected = buildNotConnected();
    const err = new Error(notConnected.message);
    err.code = "github_not_connected";
    err.notConnected = notConnected;
    throw err;
  }
  if (!auth.handle) {
    // No handle on record yet — best we can do is return short name and
    // let the caller's 404 surface naturally.
    return shortName;
  }

  // Optimistic: try `{handle}/{shortName}` first via a HEAD-ish GET.
  try {
    const probe = await githubFetch(
      tenant,
      `/repos/${encodeURIComponent(auth.handle)}/${encodeURIComponent(shortName)}`,
    );
    if (probe.ok && probe.data?.full_name) return probe.data.full_name;
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  // Fuzzy: list repos and pick the closest match by name suffix.
  try {
    const repos = await githubFetchPaginated(tenant, "/user/repos", {
      maxPages: 5,
    });
    const lower = shortName.toLowerCase();
    const exact = repos.find((r) => r.name?.toLowerCase() === lower);
    if (exact) return exact.full_name;
    const partial = repos.find((r) => r.name?.toLowerCase().includes(lower));
    if (partial) return partial.full_name;
  } catch {
    // fall through to the default
  }

  // Last resort: hand back the optimistic guess so the next call's 404
  // tells the user what went wrong, instead of inventing a repo name.
  return `${auth.handle}/${shortName}`;
}

export const __test__ = {
  GITHUB_API,
  parseNextLink,
  frontendBase,
};
