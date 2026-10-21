/**
 * tiwari-proxy — HTTP surface that exposes the Tiwari/ ES-module primitives
 * to the iOS client.
 *
 * Design rules:
 *   • iOS never talks to Tiwari services, Togari, or Pinecone directly. Every
 *     call lands here, we verify the caller's Privy JWT against amber-id,
 *     resolve their userCnft, enforce billing entitlements, then invoke the
 *     local Tiwari ES module in-process and return the envelope as JSON.
 *
 *   • This module is mounted from lib/server.js as a single "if matches, handle
 *     + return" block so it never touches the Loop-Message/webhook pipeline.
 *
 *   • Secrets (Pinecone, OpenAI, Anthropic, Solana keys) live in the
 *     amber-id service, not here. amber-agent only holds the Privy verifier
 *     URL + a service-to-service Privy JWT for server-side lookups.
 *
 *   • Togari ENTERPRISE activation is intentionally not reachable from this
 *     proxy. iOS / iPadOS / macOS / visionOS may CONSUME PeopleRank /
 *     Opportunity / Enrich on user-dataset relationships (gated by the
 *     entitlement bag), but they cannot activate the Togari enterprise
 *     tier — that's the iMessage/Loop concierge's job, enforced via
 *     lib/togari-access-policy.js. If you add an enterprise-mutating
 *     route here, route it through evaluateActivation first and expect
 *     it to be denied with `ios_cannot_activate_enterprise`.
 */

import {
  readJsonBody,
  writeJson as writeJsonRaw,
  correlationIdOf,
} from "./tiwari-proxy-util.js";

// Lazy imports so importing this module never pulls in the togari submodule
// before its node_modules are installed.
let _pr = null,
  _en = null,
  _op = null,
  _amberId = null;
async function getPeopleRank() {
  if (!_pr) _pr = await import("../../../Tiwari/tiwari-peoplerank/index.js");
  return _pr;
}
async function getEnrich() {
  if (!_en) _en = await import("../../../Tiwari/tiwari-enrich/index.js");
  return _en;
}
async function getOpportunity() {
  if (!_op) _op = await import("../../../Tiwari/tiwari-opportunity/index.js");
  return _op;
}
async function getAmberId() {
  if (!_amberId)
    _amberId = await import("../../../Tiwari/shared/amber-id-client/index.js");
  return _amberId;
}

const PATHS = [
  "/api/tiwari/peoplerank",
  "/api/tiwari/enrich",
  "/api/tiwari/opportunity",
  "/api/ask",
  "/api/ask/stream",
  "/api/identity/me",
];

const AMBER_ID_BASE_URL = (
  process.env.AMBER_ID_BASE_URL || "https://amber-id-production.up.railway.app"
).replace(/\/$/, "");

export function matchesTiwariProxy(req) {
  if (req.method !== "POST" && req.method !== "GET") return false;
  const [path] = (req.url || "").split("?");
  return PATHS.includes(path);
}

/**
 * Handle an incoming request. Returns true if the request was handled.
 */
export async function handleTiwariProxy(req, res) {
  const [path] = (req.url || "").split("?");
  const correlationId = correlationIdOf(req);
  const writeJson = (status, payload) =>
    writeJsonRaw(res, status, payload, { req, correlationId });

  // Auth: require Bearer <privy JWT>; forward verbatim to amber-id and trust
  // amber-id's /identity/me to return the caller's userCnft + tier.
  const token = extractBearer(req);
  if (!token) return writeJson(401, { error: "missing_bearer_token" });

  let identity;
  try {
    identity = await resolveIdentity(token);
  } catch (err) {
    // Distinguish auth (token bad) vs upstream (amber-id down). The
    // first is a client problem, the second isn't — and squashing them
    // together as 401 misleads the iOS client into asking the user
    // to sign in again during a service outage.
    const status = err.upstream ? 502 : 401;
    return writeJson(status, {
      error: err.upstream
        ? "identity_upstream_failed"
        : "identity_resolution_failed",
      message: err.message,
    });
  }
  const { userCnft, entitlements } = identity;

  // GET /api/identity/me — just a passthrough of what we resolved.
  if (path === "/api/identity/me") {
    return writeJson(200, { ...identity, correlationId });
  }

  // All remaining routes require cNFT (i.e. identity minted).
  if (!userCnft) {
    return writeJson(403, {
      error: "identity_not_minted",
      message:
        "Finish onboarding (amber-id cNFT mint) before calling Tiwari routes.",
    });
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return writeJson(400, { error: "bad_json", message: err.message });
  }

  try {
    switch (path) {
      case "/api/tiwari/peoplerank": {
        if (!checkEntitlement(entitlements, "peoplerank")) {
          return writeJson(402, {
            error: "entitlement_required",
            tier: "amber_plus",
          });
        }
        const { listBuild } = await getPeopleRank();
        const result = await listBuild({
          query: body.query,
          filters: body.filters,
          userCnft,
          token,
          options: body.options,
        });
        return writeJson(result.ok ? 200 : 502, { ...result, correlationId });
      }

      case "/api/tiwari/enrich": {
        if (!checkEntitlement(entitlements, "enrich")) {
          return writeJson(402, {
            error: "entitlement_required",
            tier: "amber_plus",
          });
        }
        const { enrich } = await getEnrich();
        const result = await enrich({
          entity: body.entity,
          userCnft,
          token,
          options: body.options,
        });
        return writeJson(result.ok ? 200 : 502, { ...result, correlationId });
      }

      case "/api/tiwari/opportunity": {
        // Opportunity owns its own per-channel billing gates; we pass the
        // resolved entitlements through.
        const { sequence } = await getOpportunity();
        const result = await sequence({
          trigger: body.trigger,
          userCnft,
          token,
          entitlements,
          options: body.options,
        });
        if (!result.ok && result.source === "billing-gate") {
          return writeJson(402, { ...result, correlationId });
        }
        return writeJson(result.ok ? 200 : 502, { ...result, correlationId });
      }

      case "/api/ask": {
        // Ask uses free-tier metering (25/mo) enforced on the amber-id side.
        const amberId = (await getAmberId()).default;
        const result = await amberId.ask({
          token,
          question: body.question,
          messages: body.messages,
          topK: body.topK,
        });
        return writeJson(result.ok ? 200 : 502, { ...result, correlationId });
      }

      case "/api/ask/stream": {
        // SSE: open a streaming connection to amber-id /ask/stream and
        // pipe chunks straight to the client. We do not parse events
        // here — the iOS consumer parses SSE frames directly. We only
        // own auth (already done above), the upstream URL, and clean
        // teardown when either side disconnects.
        const upstream = new AbortController();
        const onClientClose = () => upstream.abort();
        req.on("close", onClientClose);

        let upstreamRes;
        try {
          upstreamRes = await fetch(`${AMBER_ID_BASE_URL}/ask/stream`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              accept: "text/event-stream",
            },
            body: JSON.stringify({
              question: body.question,
              messages: body.messages,
              topK: body.topK,
              filter: body.filter,
            }),
            signal: upstream.signal,
          });
        } catch (err) {
          req.off("close", onClientClose);
          if (err?.name === "AbortError") return undefined;
          return writeJson(502, {
            error: "ask_stream_upstream_unreachable",
            message: err.message,
            correlationId,
          });
        }

        // If amber-id rejected the request (auth, cnft gate, validation),
        // surface the JSON body to the iOS client as a normal JSON
        // response instead of starting an SSE stream.
        if (!upstreamRes.ok) {
          const errBody = await upstreamRes.text().catch(() => "");
          req.off("close", onClientClose);
          let parsed = null;
          try {
            parsed = errBody ? JSON.parse(errBody) : null;
          } catch {}
          return writeJson(upstreamRes.status, {
            error: parsed?.error || "ask_stream_upstream_error",
            message: parsed?.message || errBody.slice(0, 300),
            correlationId,
          });
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
          "X-Correlation-Id": correlationId,
        });

        const reader = upstreamRes.body.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (res.writableEnded) break;
            res.write(value);
          }
        } catch (err) {
          if (err?.name !== "AbortError") {
            console.warn(
              `[tiwari-proxy] cid=${correlationId} ask/stream pipe error: ${err.message}`,
            );
          }
        } finally {
          req.off("close", onClientClose);
          if (!res.writableEnded) res.end();
        }
        return undefined;
      }
    }
  } catch (err) {
    console.error(`[tiwari-proxy] cid=${correlationId} path=${path}`, err);
    // If the error is clearly amber-id going down (upstream flag), return
    // a friendly degraded response rather than a raw 500 so iOS knows to
    // retry later, not ask the user to sign out.
    const code = err.upstream ? "AMBER_ID_DOWN" : "PROXY_ERROR";
    const status = err.upstream ? 503 : 500;
    return writeJson(status, {
      error: err.upstream ? "service_unavailable" : "proxy_error",
      code,
      message: err.upstream
        ? "A dependent service is temporarily unavailable. Please try again shortly."
        : err.message,
    });
  }

  return writeJson(404, { error: "not_found" });
}

// ── helpers ────────────────────────────────────────────────────────────────

function extractBearer(req) {
  const h = req.headers["authorization"] || req.headers["Authorization"] || "";
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  return h.slice(7).trim() || null;
}

async function resolveIdentity(token) {
  const amberId = (await getAmberId()).default;
  // amber-id /identity/me returns { userId, cnftMint, cnftAssetId, tier, ... }
  let me;
  try {
    me = await amberId.getIdentity({ token });
  } catch (err) {
    // If amber-id is reachable and returned a 401-ish payload, treat as
    // auth failure. Anything network-shaped is an upstream outage —
    // tag it so the proxy can return 502 instead of 401.
    const msg = String(err?.message || err || "").toLowerCase();
    const looksLikeAuth =
      msg.includes("unauth") ||
      msg.includes("invalid") ||
      msg.includes("expired") ||
      msg.includes("forbidden");
    const wrapped = new Error(err?.message || "amber-id error");
    wrapped.upstream = !looksLikeAuth;
    throw wrapped;
  }
  const cnftMint = me?.cnftMint || me?.cnft_mint || null;
  return {
    userId: me?.userId || me?.user_id || null,
    userCnft: cnftMint,
    tier: me?.tier || "free",
    entitlements: deriveEntitlements(me?.tier || "free", me?.entitlements),
    raw: me,
  };
}

/**
 * Map subscription tier → feature entitlements.
 *
 *   free         → { ask_free: true } (metered by amber-id)
 *   amber_plus   → free + peoplerank + enrich + email
 *   amber_imsg   → plus + imessage_concierge + sms_concierge
 *
 * Explicit overrides in `entitlements` (set by admin tools) win over tier.
 */
function deriveEntitlements(tier, overrides = {}) {
  const base = { ask_free: true };
  if (tier === "amber_plus" || tier === "amber_imsg") {
    base.peoplerank = true;
    base.enrich = true;
    base.knowledge_ingest = true;
    base.email = true;
  }
  if (tier === "amber_imsg") {
    base.imessage_concierge = true;
    base.sms_concierge = true;
  }
  return { ...base, ...(overrides || {}) };
}

function checkEntitlement(entitlements, key) {
  return Boolean(entitlements && entitlements[key]);
}
