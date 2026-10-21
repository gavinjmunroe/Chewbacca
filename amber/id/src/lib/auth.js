/**
 * API key verification using timing-safe comparison.
 * Prevents timing attacks on server-to-server authentication.
 *
 * Also exports shared input validators used across route handlers.
 */

import { personalMcpIdentity } from "./personal-mcp-auth.js";
import { timingSafeEqual } from "crypto";
import { requireAuth } from "./auth-session.js";
import { namedApiKeys, instanceId } from "./instance.js";

// ─── Input validators ────────────────────────────────────────────────────────

/**
 * Validate a userId / Privy DID string.
 * Accepts the "did:privy:..." format Privy uses, or any non-empty string
 * that does not contain path-traversal characters.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateUserId(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "userId must be a non-empty string";
  }
  if (value.length > 256) {
    return "userId too long (max 256 characters)";
  }
  if (/[/\\.<>]/.test(value)) {
    return "userId contains disallowed characters";
  }
  return null;
}

/**
 * Validate a DID string. Must start with "did:" and contain no path chars.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateDid(value) {
  if (typeof value !== "string" || value.length === 0) {
    return "DID must be a non-empty string";
  }
  // Three accepted shapes:
  //   did:<method>:<rest>          Privy / amber-id native users
  //   <32-char lowercase hex>      OTP-login person_id from signMedhaSession
  //                                (sha256(E.164(phone)).slice(0,32)). Tokens
  //                                minted by the medha-frontend are stored
  //                                under this raw key; the agent's REST
  //                                lookups need to read them, so the
  //                                validator can't reject this shape.
  const isDid = value.startsWith("did:");
  const isPersonId = /^[a-f0-9]{32}$/.test(value);
  if (!isDid && !isPersonId) {
    return "DID must start with 'did:' or be a 32-char hex person_id";
  }
  if (value.length > 256) return "DID too long (max 256 characters)";
  if (/[/\\<>]/.test(value)) return "DID contains disallowed characters";
  return null;
}

/**
 * Validate an E.164 phone number (+15551234567).
 * Returns null if valid, or an error message string if invalid.
 */
export function validatePhone(value) {
  if (typeof value !== "string") return "phone must be a string";
  if (!/^\+[1-9]\d{6,14}$/.test(value)) {
    return "phone must be in E.164 format (e.g. +15551234567)";
  }
  return null;
}

function timingSafeStringEqual(a, b) {
  if (typeof a !== "string" || a.length === 0) return false;
  if (typeof b !== "string" || b.length === 0) return false;
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function verifyApiKey(provided) {
  return identifyApiKey(provided) !== null;
}

/**
 * Identify which caller a presented API key belongs to.
 *
 * Returns `{ name }` on match, where `name` is "legacy" for the original
 * single-key path or the named entry from AMBER_ID_API_KEYS. Returns null
 * if no key matches. Used by requireApiKey* helpers to stamp request.clientId
 * for audit and Pinecone metadata.
 */
export function identifyApiKey(provided) {
  if (typeof provided !== "string" || provided.length === 0) return null;
  // Global fallback owner DID. Lets a single-key deployment bind every
  // authenticated call to one tenant without per-key config. Per-key `did`
  // (named keys) always wins over this.
  const fallbackDid = process.env.DEFAULT_OWNER_DID || null;
  const legacy = process.env.AMBER_ID_API_KEY;
  if (legacy && timingSafeStringEqual(provided, legacy)) {
    return { name: "legacy", did: fallbackDid };
  }
  for (const entry of namedApiKeys()) {
    if (timingSafeStringEqual(provided, entry.key)) {
      return { name: entry.name, did: entry.did || fallbackDid };
    }
  }
  return null;
}

/**
 * If a header is duplicated, Node returns an array. Pick the first string
 * value so verifyApiKey only ever sees a single string.
 */
function firstHeaderValue(value) {
  if (Array.isArray(value))
    return typeof value[0] === "string" ? value[0] : null;
  return typeof value === "string" ? value : null;
}

/**
 * THE SAME KEY, IN THE HEADER THE CLIENT ACTUALLY SENDS.
 *
 * /mcp is the door every agent comes through -- Claude's custom connectors,
 * Cursor, Perplexity, whatever ships next -- and most of them can send exactly
 * one thing: `Authorization: Bearer <token>`. A surface that only reads
 * `x-api-key` is not "an MCP server you can add anywhere", it is one you can
 * add to the clients that happen to support custom headers.
 *
 * So Bearer is accepted as an alias for the API key, and ONLY here. It is the
 * same credential checked the same way -- this widens which header carries it,
 * never what it unlocks. requireApiKey is left alone so no other route's
 * contract moves.
 *
 * A Privy user JWT also arrives as Bearer. It is not an API key, so
 * identifyApiKey refuses it and the caller gets the same 401 as any other bad
 * credential: this cannot be used to smuggle a user token into service auth.
 */
export async function requireMcpKey(request, reply) {
  let apiKey = firstHeaderValue(request.headers["x-api-key"]);
  if (!apiKey) {
    const auth = firstHeaderValue(request.headers.authorization);
    const m = /^Bearer\s+(.+)$/i.exec(String(auth ?? "").trim());
    if (m) apiKey = m[1].trim();
  }
  const personal = await personalMcpIdentity(apiKey).catch(() => null);
  if (personal) {
    request.ownerDid = personal.ownerDid;
    request.mcpKeyId = personal.keyId;
    request.serviceAuth = false;
    return;
  }
  const ident = identifyApiKey(apiKey);
  if (!ident) {
    return reply.code(401).send({
      error: "Invalid API key",
      code: "invalid_api_key",
      message:
        "Send your Amber API key as `Authorization: Bearer <key>` or `x-api-key: <key>`.",
    });
  }
  stampCaller(request, ident);
}

export async function requireApiKey(request, reply) {
  const apiKey = firstHeaderValue(request.headers["x-api-key"]);
  const ident = identifyApiKey(apiKey);
  if (!ident) {
    return reply
      .code(401)
      .send({ error: "Invalid API key", code: "invalid_api_key" });
  }
  stampCaller(request, ident);
}

/**
 * Annotate the request with caller identity so audit log + downstream
 * metadata stamping can attribute writes correctly. The optional
 * `x-amber-client` header takes precedence over the API-key-derived name
 * — useful when one shared key is used and the caller wants to self-identify
 * (e.g. a sub-component inside a larger service tagging itself separately
 * from the parent). Caller identity is service-level only; it never
 * affects which tenant a request operates on.
 */
function stampCaller(request, ident) {
  request.serviceAuth = true;
  request.instanceId = instanceId();
  const headerClient = firstHeaderValue(request.headers["x-amber-client"]);
  request.clientId = (headerClient && headerClient.slice(0, 64)) || ident.name;
  // Owner DID bound to this API key (per-key `did`, else DEFAULT_OWNER_DID,
  // else null). MCP tools that take a `did` arg fall back to this when the
  // caller omits it, so a key-holder never has to know their own DID.
  request.ownerDid = ident.did || null;
}

/**
 * Dual-mode auth: accept EITHER a valid `x-api-key` (service-to-service
 * calls from amber-agent) OR a Privy Bearer JWT (user-scoped calls from
 * the iOS app / dashboard). Used by /ingest/:pipe so the agent can write
 * on the user's behalf without holding their JWT.
 *
 * When service-auth wins, the route handler must read `x-amber-phone` (or
 * a body-level identifier) to know which tenant the data belongs to. When
 * Privy auth wins, `request.privyUser` is populated as usual.
 *
 * `request.serviceAuth = true` is set on the service-auth path so handlers
 * can branch.
 */
export async function requireApiKeyOrAuth(request, reply) {
  const apiKey = firstHeaderValue(request.headers["x-api-key"]);
  const ident = apiKey ? identifyApiKey(apiKey) : null;
  if (ident) {
    stampCaller(request, ident);
    return; // pass
  }
  // Fall through to Privy JWT verification.
  return requireAuth(request, reply);
}
