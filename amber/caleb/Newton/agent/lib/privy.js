/**
 * Privy JWT verification.
 *
 * Privy.io is the single authentication authority for amber-agent. Any
 * user-scoped request (iOS app, web dashboard, Tiwari proxy, knowledge
 * queries) must carry a Privy JWT. The agent verifies the token locally
 * against Privy's public keys, then uses the resulting DID as the tenant
 * key against amber-id.
 *
 * Service-to-service calls (webhook handlers, scheduled crons, the agent
 * acting as a delegate with no user physically present) use the
 * AMBER_ID_API_KEY service header against amber-id directly. See
 * FOLLOWUP.md for the full agent-as-delegate flow.
 *
 * Runtime dependency: `jose` for remote JWKS verification. Lightweight,
 * zero-config, no Privy SDK required.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";

const PRIVY_APP_ID = process.env.PRIVY_APP_ID || "";
const PRIVY_JWKS_URL =
  process.env.PRIVY_JWKS_URL ||
  (PRIVY_APP_ID
    ? `https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`
    : "");
const PRIVY_ISSUER = process.env.PRIVY_ISSUER || "privy.io";
// Privy issues ES256 tokens. Pinning the algorithm prevents the classic
// "alg=none" / "alg=HS256 with public key as secret" downgrade attacks.
const PRIVY_ALLOWED_ALGS = (process.env.PRIVY_ALLOWED_ALGS || "ES256")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// 60s allowance for client/server clock drift. Keep tight — Privy tokens
// are short-lived by design.
const PRIVY_CLOCK_TOLERANCE_S = parseInt(
  process.env.PRIVY_CLOCK_TOLERANCE_S || "60",
  10,
);

let jwks = null;
function getJwks() {
  if (!PRIVY_JWKS_URL) {
    throw new Error("PRIVY_APP_ID is not set; cannot verify Privy JWTs.");
  }
  if (!jwks) jwks = createRemoteJWKSet(new URL(PRIVY_JWKS_URL));
  return jwks;
}

/**
 * Verify a Privy JWT. Returns the verified claims on success, throws on
 * any failure (expired, signature invalid, issuer mismatch, etc.).
 *
 * Hardened against three classes of bypass:
 *   1. Algorithm confusion — `algorithms` is pinned; tokens claiming
 *      `alg: none` or `alg: HS256` are rejected even though the JWKS
 *      contains an EC public key.
 *   2. Audience confusion — when PRIVY_APP_ID is set we require the
 *      token's `aud` to match. A token minted for another Privy app
 *      cannot authenticate against this one.
 *   3. Issuer confusion — `iss` must match PRIVY_ISSUER (default
 *      "privy.io"). Without this, a self-signed token with a JWKS the
 *      attacker controls could pass.
 *
 * @param {string} token  — raw JWT, with or without "Bearer " prefix
 * @returns {Promise<{ did: string, sub: string, iss: string, ...claims }>}
 */
export async function verifyPrivyJwt(token) {
  if (!token || typeof token !== "string") {
    throw new Error("Privy JWT required");
  }
  const raw = token.startsWith("Bearer ") ? token.slice(7).trim() : token;
  if (!PRIVY_APP_ID) {
    // We refuse to verify without a configured audience. Returning
    // success without an `aud` check would allow any Privy-signed token
    // (including ones minted for other apps) to authenticate.
    throw new Error(
      "PRIVY_APP_ID not configured; refusing to verify token without audience binding",
    );
  }
  const { payload, protectedHeader } = await jwtVerify(raw, getJwks(), {
    issuer: PRIVY_ISSUER,
    audience: PRIVY_APP_ID,
    algorithms: PRIVY_ALLOWED_ALGS,
    clockTolerance: PRIVY_CLOCK_TOLERANCE_S,
  });
  // Defense-in-depth: jwtVerify already enforces algorithms, but a stray
  // alg slipping through here would be catastrophic. Verify explicitly.
  if (!PRIVY_ALLOWED_ALGS.includes(protectedHeader.alg)) {
    throw new Error(`unexpected JWT alg: ${protectedHeader.alg}`);
  }
  if (!payload.sub || typeof payload.sub !== "string") {
    throw new Error("JWT missing sub claim");
  }
  return {
    did: payload.sub,
    ...payload,
  };
}

/**
 * Extract a Privy JWT from an HTTP request.
 *
 * Sources, in order of preference:
 *   1. `Authorization: Bearer <token>` header (canonical)
 *   2. `x-privy-token` header (used by the iOS client)
 *   3. `?token=` query param — DEV ONLY. Query-string tokens land in
 *      proxy logs, browser histories, and Referer headers, so we refuse
 *      to read them in production. Set ALLOW_QUERY_TOKEN=1 to opt in
 *      explicitly (e.g. for an internal staging probe).
 */
export function extractPrivyToken(req) {
  const auth = req.headers?.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const hdr = req.headers?.["x-privy-token"];
  if (hdr) return String(hdr);
  const allowQuery =
    process.env.NODE_ENV !== "production" ||
    process.env.ALLOW_QUERY_TOKEN === "1";
  if (allowQuery) {
    try {
      const urlObj = new URL(req.url, "http://localhost");
      const qp = urlObj.searchParams.get("token");
      if (qp) return qp;
    } catch {}
  }
  return null;
}

/**
 * Middleware-style helper: verify a request's Privy JWT and attach the
 * decoded claims to `req.privy`. Returns true on success, writes 401 on
 * failure and returns false.
 */
export async function requirePrivyAuth(req, res) {
  const token = extractPrivyToken(req);
  if (!token) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "missing_privy_token" }));
    return false;
  }
  try {
    req.privy = await verifyPrivyJwt(token);
    return true;
  } catch (err) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "invalid_privy_token", reason: err.message }),
    );
    return false;
  }
}

export {
  PRIVY_APP_ID,
  PRIVY_JWKS_URL,
  PRIVY_ISSUER,
  PRIVY_ALLOWED_ALGS,
  PRIVY_CLOCK_TOLERANCE_S,
};
