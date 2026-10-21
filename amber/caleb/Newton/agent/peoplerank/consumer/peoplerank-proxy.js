/**
 * peoplerank-proxy.js — PeopleRank consumer HTTP surface (mounted under
 * /v1/peoplerank/*) for the amber-ios app.
 *
 * PeopleRank is NLP people-search that RANKS the authenticated caller's
 * unified network (the same Medha+Pinecone "Connection Graph" the
 * /v1/network/* surface exposes). The flow for POST /v1/peoplerank/search:
 *
 *   1. Verify the medha-id Privy JWT — the SAME token amber-ios carries for
 *      /api/ask/stream and /v1/network/*. We reuse verifyPrivyJwt and scope
 *      everything to the resolved DID. No separate auth system.
 *   2. Fetch candidate people from the caller's unified network by REUSING
 *      search_contacts (lib/tools/contacts-search.js) — exactly the
 *      Pinecone path /v1/network/search uses. No new Pinecone wiring.
 *   3. RANK those candidates with the ported PeopleRank scoring + rationale
 *      logic (consumer/ranking.js, the JS mirror of peoplerank/ranking.py,
 *      itself a faithful port of the CTO's togari-search scoring/rationale).
 *
 * Response: an ordered array of { id, name, score, confidence, rationale,
 * signals, source } for the RN client.
 *
 * Tenant scoping is identical to network-proxy.js: the DID from the verified
 * token is the only tenant key; never read from body/query.
 */

import { verifyPrivyJwt, extractPrivyToken } from "../../lib/privy.js";
import { executeContactsSearchTool } from "../../lib/tools/contacts-search.js";
import {
  readJsonBody,
  writeJson as writeJsonRaw,
  correlationIdOf,
} from "../../lib/tiwari-proxy-util.js";
import { rankCandidates } from "./ranking.js";

const PATH_PREFIX = "/v1/peoplerank";

export function matchesPeopleRankProxy(req) {
  if (req.method !== "POST") return false;
  const [path] = (req.url || "").split("?");
  return path === PATH_PREFIX || path.startsWith(`${PATH_PREFIX}/`);
}

/**
 * Handle a /v1/peoplerank/* request. Always writes a response. Returns true.
 */
export async function handlePeopleRankProxy(req, res) {
  const [path] = (req.url || "").split("?");
  const correlationId = correlationIdOf(req);
  const writeJson = (status, payload) =>
    writeJsonRaw(res, status, payload, { req, correlationId });

  // ── Auth: verify the medha-id Privy JWT (same as /v1/network/*) ──
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
    if (subPath === "/search") {
      return await handleSearch(req, did, writeJson);
    }
    return writeJson(404, { error: "not_found", path });
  } catch (err) {
    console.error(`[peoplerank-proxy] cid=${correlationId} path=${path}`, err);
    return writeJson(500, {
      error: "peoplerank_proxy_error",
      message: err?.message || String(err),
    });
  }
}

// ── POST /v1/peoplerank/search — NLP people-search + ranking ──────────────

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

  // Fetch candidates from the caller's unified network (same path as
  // /v1/network/search), scoped to the caller's Pinecone namespace.
  const result = await executeContactsSearchTool(
    "search_contacts",
    { query, topK: body.topK, source: body.source },
    { tenant: { privyDid: did } },
  );

  if (result?.error) {
    const status = /required/i.test(result.error) ? 400 : 502;
    return writeJson(status, result);
  }

  // Rank with the ported PeopleRank scoring + rationale.
  const ranked = rankCandidates(query, result.matches || []);

  return writeJson(200, {
    ok: true,
    query,
    count: ranked.length,
    results: ranked,
  });
}
