/**
 * network-proxy.js — UnifyNetwork consumer HTTP surface (mounted under
 * /v1/network/*) for the amber-ios app.
 *
 * This is the CONSUMER front door to the ported connection_network engine
 * (the CTO's "Connection Graph"). amber-ios carries a medha-id-issued Privy
 * JWT — the SAME token medha-platform already verifies for /api/ask/stream
 * (see lib/tiwari-proxy.js + lib/privy.js). We verify it here with the
 * existing Privy verifier, derive the caller's DID, and scope every response
 * to that caller. There is no separate auth system for this surface.
 *
 * Two data planes, one auth:
 *
 *   • Relational / validation store (BigQuery, the CTO's engine):
 *       GET /v1/network/check, /identities, /identities/{id}, /connections
 *     are proxied server-to-server to the ported FastAPI app
 *     (connection-network/i_api/app.py). We forward the resolved DID via
 *     X-Medha-Tenant + a shared secret (X-Medha-Proxy-Secret) so the engine's
 *     MEDHA_AUTH_ENABLED path trusts us instead of doing its own Auth0 check.
 *     The engine keeps Auth0 verification intact (off by default) so its
 *     tests/test_auth.py still passes.
 *
 *   • Semantic layer (Pinecone, Medha-native):
 *       POST /v1/network/search runs IN-PROCESS against the caller's per-tenant
 *     Pinecone namespace by REUSING search_contacts
 *     (lib/tools/contacts-search.js) — the existing unified-people-graph
 *     natural-language search. No new Pinecone wiring, no duplication.
 *
 * Tenant scoping: the DID from the verified token is the only tenant key.
 * We never read tenant identity from the request body or query — consistent
 * with how contacts-search.js resolves tenantDid (tenant.privyDid).
 */

import { verifyPrivyJwt, extractPrivyToken } from "../../lib/privy.js";
import { executeContactsSearchTool } from "../../lib/tools/contacts-search.js";
import {
  readJsonBody,
  writeJson as writeJsonRaw,
  correlationIdOf,
} from "../../lib/tiwari-proxy-util.js";

// The ported FastAPI engine (connection-network/i_api/app.py). In Railway
// this runs as a sibling process / service; default to localhost for the
// single-container deploy where uvicorn runs alongside Node.
const CONNECTION_NETWORK_API_URL = (
  process.env.CONNECTION_NETWORK_API_URL || "http://127.0.0.1:8080"
).replace(/\/$/, "");

// Shared secret the Node proxy presents to the FastAPI engine so the engine's
// MEDHA_AUTH_ENABLED path trusts the already-verified DID we forward.
const MEDHA_NETWORK_SHARED_SECRET =
  process.env.MEDHA_NETWORK_SHARED_SECRET || "";

const UPSTREAM_TIMEOUT_MS = 8000;

const PATH_PREFIX = "/v1/network";

export function matchesNetworkProxy(req) {
  if (req.method !== "GET" && req.method !== "POST") return false;
  const [path] = (req.url || "").split("?");
  return path === PATH_PREFIX || path.startsWith(`${PATH_PREFIX}/`);
}

/**
 * Handle a /v1/network/* request. Always writes a response. Returns true.
 */
export async function handleNetworkProxy(req, res) {
  const [path, rawQuery = ""] = (req.url || "").split("?");
  const correlationId = correlationIdOf(req);
  const writeJson = (status, payload) =>
    writeJsonRaw(res, status, payload, { req, correlationId });

  // ── Auth: verify the medha-id Privy JWT (same token as /api/ask/stream) ──
  const token = extractPrivyToken(req);
  if (!token) {
    return writeJson(401, { error: "missing_bearer_token" });
  }
  let did;
  try {
    const claims = await verifyPrivyJwt(token);
    did = claims.did;
  } catch (err) {
    return writeJson(401, {
      error: "invalid_token",
      message: err?.message || "token verification failed",
    });
  }
  if (!did) {
    return writeJson(403, { error: "token_missing_did" });
  }

  const subPath = path.slice(PATH_PREFIX.length) || "/";

  try {
    // ── Semantic search (Pinecone, in-process) ──────────────────────────
    if (req.method === "POST" && subPath === "/search") {
      return await handleSearch(req, did, writeJson);
    }

    // ── BigQuery-backed routes → ported FastAPI engine ──────────────────
    if (req.method === "GET" && subPath === "/check") {
      return await proxyToEngine("/network/check", rawQuery, did, writeJson);
    }
    if (req.method === "GET" && subPath === "/identities") {
      return await proxyToEngine("/identities", rawQuery, did, writeJson);
    }
    if (req.method === "GET" && /^\/identities\/[^/]+$/.test(subPath)) {
      const id = encodeURIComponent(decodeURIComponent(subPath.split("/")[2]));
      return await proxyToEngine(`/identities/${id}`, "", did, writeJson);
    }
    if (req.method === "GET" && subPath === "/connections") {
      return await proxyToEngine("/connections", rawQuery, did, writeJson);
    }

    return writeJson(404, { error: "not_found", path });
  } catch (err) {
    console.error(`[network-proxy] cid=${correlationId} path=${path}`, err);
    return writeJson(500, {
      error: "network_proxy_error",
      message: err?.message || String(err),
    });
  }
}

// ── POST /v1/network/search — natural-language semantic search ────────────

async function handleSearch(req, did, writeJson) {
  let body = {};
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return writeJson(400, { error: "bad_json", message: err.message });
  }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return writeJson(400, { error: "query is required" });
  }

  // Reuse the existing unified-people-graph search, scoped to the caller's
  // Pinecone namespace via a minimal tenant carrying just the DID — exactly
  // the field contacts-search.js reads (tenant.privyDid).
  const result = await executeContactsSearchTool(
    "search_contacts",
    { query, topK: body.topK, source: body.source },
    { tenant: { privyDid: did } },
  );

  if (result?.error) {
    // query-validation vs unavailable — surface 400 for the former.
    const status = /required/i.test(result.error) ? 400 : 502;
    return writeJson(status, result);
  }

  return writeJson(200, {
    ok: true,
    query: result.query,
    count: result.count || 0,
    matches: result.matches || [],
    summary: result.summary || "",
  });
}

// ── GET proxy to the ported FastAPI engine (BigQuery store) ───────────────

async function proxyToEngine(enginePath, rawQuery, did, writeJson) {
  if (!MEDHA_NETWORK_SHARED_SECRET) {
    return writeJson(503, {
      error: "network_engine_unconfigured",
      message:
        "MEDHA_NETWORK_SHARED_SECRET not set — cannot reach the connection " +
        "graph engine. Set it on both the Node service and the FastAPI engine.",
    });
  }

  const url =
    `${CONNECTION_NETWORK_API_URL}${enginePath}` +
    (rawQuery ? `?${rawQuery}` : "");

  let upstream;
  try {
    upstream = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        // The engine ignores this when MEDHA_AUTH_ENABLED, but HTTPBearer
        // still requires an Authorization header to be present.
        authorization: "Bearer medha-proxy",
        "x-medha-proxy-secret": MEDHA_NETWORK_SHARED_SECRET,
        "x-medha-tenant": did,
        "x-medha-user": did,
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    return writeJson(502, {
      error: "network_engine_unreachable",
      message: err?.message || String(err),
    });
  }

  const text = await upstream.text().catch(() => "");
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 500) };
  }

  if (!upstream.ok) {
    return writeJson(upstream.status, {
      error: payload?.detail || payload?.error || "network_engine_error",
      message: payload?.detail || payload?.message || text.slice(0, 300),
    });
  }

  return writeJson(200, payload ?? { ok: true });
}
