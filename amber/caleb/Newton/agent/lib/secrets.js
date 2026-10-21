/**
 * Per-user secret store client.
 *
 * Looks up third-party API keys (Composio, Google OAuth, Todoist, etc.) for
 * a tenant by their Privy DID, via amber-id's /v1/secrets/:did endpoints.
 *
 * Read-through cache with short TTL; values decrypt on amber-id's side so
 * we never handle ciphertext here. Falls back to process.env for keys not
 * yet migrated so we can roll this out incrementally.
 *
 * Usage:
 *   import { getSecret } from "./lib/secrets.js";
 *   const token = await getSecret(tenant, "TODOIST_API_KEY",
 *                                 { fallbackEnv: "TODOIST_API_KEY" });
 *
 *   // Or a list of env aliases, tried in order — useful when the deployed
 *   // env name and the per-tenant key name have drifted (see the GCAL_*
 *   // vs GOOGLE_* case in tools/gcal/client.js):
 *   const id = await getSecret(tenant, "GCAL_OAUTH_CLIENT_ID", {
 *     fallbackEnv: ["GCAL_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID"],
 *   });
 */

import { createHash } from "crypto";
import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "./constants.js";
import { getBreaker } from "./circuit-breaker.js";

// Reuse the same breaker name as tenant.js — they're talking to the
// same upstream, so failures should compound and open in unison.
const AMBER_ID_BREAKER = getBreaker("amber-id", {
  failureThreshold: 5,
  cooldownMs: 15_000,
  windowMs: 30_000,
  timeoutMs: 5000,
});

const CACHE_TTL_MS = 60_000; // 60s; small enough to pick up rotations quickly

// Map of `${did}::${key}` → { value, expiresAt }
const cache = new Map();

// Map of `${did}::${key}` → Promise<value> for in-flight fetches.
//
// Prevents the N-parallel-callers-on-the-same-key race: when a multi-tool
// turn fires ten gmail metadata requests in parallel, the old code made
// ten separate amber-id round trips for GMAIL_OAUTH_ACCESS, ten for
// GMAIL_OAUTH_EXPIRES_AT, ten for the refresh token, and so on. The
// in-flight map coalesces them — the first call does the fetch, the rest
// await its Promise. Entries are removed as soon as the fetch settles so
// the next miss still hits amber-id (we don't want to memoize a stale
// value past CACHE_TTL_MS).
const inflight = new Map();

function tenantDidOf(tenant) {
  if (!tenant) return null;
  if (typeof tenant === "string") return tenant;
  return tenant.privyDid || tenant.amberId || tenant.id || null;
}

/**
 * Convert a phone number to E.164 (best-effort). The medha-id OTP login
 * derives person_id = sha256(E.164(phone)).slice(0, 32) and writes the
 * user's OAuth tokens under that key. The agent's tenant.privyDid does
 * NOT match this person_id, so a plain getSecret(tenant, key) misses
 * tokens that the user successfully connected via the medha-frontend.
 *
 * tenantPersonId(tenant) derives the same person_id the OTP login uses,
 * so secret lookups can fall back to it when the primary DID lookup
 * misses. Returns null if we can't compose an E.164.
 */
function toE164(rawPhone) {
  if (!rawPhone || typeof rawPhone !== "string") return null;
  const digits = rawPhone.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  // 10-digit US default, matching the OTP route's behavior.
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function tenantPersonId(tenant) {
  if (!tenant || typeof tenant === "string") return null;
  // Explicit personId from the inbound transport trumps phone derivation.
  // The Slack inbound envelope sets meta.personId from the slack-links
  // lookup, which is the source of truth (the OAuth callback wrote the
  // link with this exact personId). When set, prefer it directly so
  // users whose slack-link record has phone_e164=null (OAuth-flow users
  // who never went through the legacy "send me your phone" ceremony)
  // still bridge correctly.
  if (typeof tenant.personId === "string" && tenant.personId) {
    return tenant.personId;
  }
  const phone = tenant.phoneNumber || tenant.loopSenderPhone || tenant.phone;
  const e164 = toE164(phone);
  if (!e164) return null;
  return createHash("sha256")
    .update(e164.toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

function cacheKey(did, key) {
  return `${did}::${key}`;
}

function getCached(did, key) {
  const entry = cache.get(cacheKey(did, key));
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(cacheKey(did, key));
    return undefined;
  }
  return entry.value;
}

function setCached(did, key, value) {
  cache.set(cacheKey(did, key), {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function fetchSecret(did, key) {
  if (!AMBER_ID_API_URL || !AMBER_ID_API_KEY) return null;
  const url = `${AMBER_ID_API_URL}/v1/secrets/${encodeURIComponent(did)}/${encodeURIComponent(key)}`;
  // Run through the breaker so a sustained amber-id outage fails fast
  // here too — without this, every tool call that needs a per-tenant
  // secret stalls for 5s while the secret service is unreachable.
  const res = await AMBER_ID_BREAKER.run(
    async () =>
      fetch(url, {
        method: "GET",
        headers: { "x-api-key": AMBER_ID_API_KEY },
        signal: AbortSignal.timeout(5000),
      }),
    { fallback: null },
  );
  if (!res || !res.ok) return null;
  try {
    const body = await res.json().catch(() => null);
    return body?.value ?? null;
  } catch (err) {
    console.warn(`[secrets] fetch ${key} failed:`, err?.message);
    return null;
  }
}

/**
 * Resolve a `fallbackEnv` (string | string[] | null | undefined) against
 * process.env. Returns the first matching value, or null if none match.
 *
 * Exported for tests.
 */
export function resolveEnvFallback(fallbackEnv) {
  if (!fallbackEnv) return null;
  const names = Array.isArray(fallbackEnv) ? fallbackEnv : [fallbackEnv];
  for (const name of names) {
    if (!name) continue;
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

/**
 * Get a per-user secret. If the user has no value stored, optionally fall
 * back to a process.env variable so we can migrate incrementally.
 *
 *   getSecret(tenant, "TODOIST_API_KEY")
 *   getSecret(tenant, "COMPOSIO_API_KEY", { fallbackEnv: "COMPOSIO_API_KEY" })
 *   getSecret(tenant, "GCAL_OAUTH_CLIENT_ID", {
 *     fallbackEnv: ["GCAL_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID"],
 *   })
 */
export async function getSecret(tenant, key, { fallbackEnv = null } = {}) {
  const did = tenantDidOf(tenant);
  if (!did) {
    return resolveEnvFallback(fallbackEnv);
  }
  const cached = getCached(did, key);
  if (cached !== undefined) return cached;

  // Coalesce concurrent misses on the same (did, key). If another caller
  // already kicked off the fetch this turn, await its result instead of
  // racing to amber-id with the same request.
  const flightKey = cacheKey(did, key);
  const inflightFetch = inflight.get(flightKey);
  if (inflightFetch) return inflightFetch;

  const fetchPromise = resolveAndCacheSecret(did, tenant, key, fallbackEnv);
  inflight.set(flightKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inflight.delete(flightKey);
  }
}

async function resolveAndCacheSecret(did, tenant, key, fallbackEnv) {
  const value = await fetchSecret(did, key);
  if (value) {
    setCached(did, key, value);
    console.log(`[secrets] resolved key=${key} did=${did} source=tenant_bag`);
    return value;
  }

  // Identity bridge: OTP-login users have their OAuth tokens stored
  // under person_id = sha256(E.164(phone)), NOT under the Privy DID
  // the agent sees on tenant.privyDid. If the primary lookup misses,
  // try the derived person_id before declaring "not found". This
  // unblocks "Medha, what's on my calendar?" for users who connected
  // Google via the medha-frontend.
  const personId = tenantPersonId(tenant);
  if (personId && personId !== did) {
    const cachedPid = getCached(personId, key);
    if (cachedPid !== undefined && cachedPid !== null) {
      setCached(did, key, cachedPid);
      console.log(
        `[secrets] resolved key=${key} did=${did} source=person_bridge_cache personId=${personId}`,
      );
      return cachedPid;
    }
    const fallbackValue = await fetchSecret(personId, key);
    if (fallbackValue) {
      setCached(personId, key, fallbackValue);
      // Mirror under the primary DID so subsequent lookups skip the bridge.
      setCached(did, key, fallbackValue);
      console.log(
        `[secrets] resolved key=${key} did=${did} source=person_bridge personId=${personId}`,
      );
      return fallbackValue;
    }
    setCached(personId, key, null);
  }

  // Resolve the env fallback BEFORE caching null, then cache whichever
  // value the caller will actually receive. The old code cached null
  // unconditionally, which meant: parallel callers asking for the same
  // key with a fallbackEnv configured would all hit the cached null on
  // subsequent reads and skip the env path entirely. That's exactly the
  // race that made gmail's 10 parallel detail fetches fail with "Missing
  // OAuth client credentials" even when GOOGLE_OAUTH_CLIENT_ID was set
  // in env: the first call's bag-miss cached null, the next 9 returned
  // that null and never asked env.
  //
  // fallbackEnv may be a string or an array. resolveEnvFallback iterates
  // the array and returns the first non-empty match. We list the names
  // we tried in the log so future env-name-mismatch bugs are obvious
  // (the GCAL_* vs GOOGLE_* divergence cost us a debugging session).
  //
  // Env values don't change at runtime, so caching the env value is
  // safe for the duration of the CACHE_TTL_MS window.
  const envValue = resolveEnvFallback(fallbackEnv);
  setCached(did, key, envValue);
  const envNames = fallbackEnv
    ? Array.isArray(fallbackEnv)
      ? fallbackEnv.join(",")
      : fallbackEnv
    : "(none)";
  console.log(
    `[secrets] resolved key=${key} did=${did} source=${envValue ? "env" : "miss"} env_names=${envNames}`,
  );
  return envValue;
}

/**
 * Fetch the full decrypted bag for a tenant. Useful for bulk consumers like
 * the Composio initializer that needs key + entity ID together.
 */
export async function getSecrets(tenant) {
  const did = tenantDidOf(tenant);
  if (!did || !AMBER_ID_API_URL || !AMBER_ID_API_KEY) return {};
  const url = `${AMBER_ID_API_URL}/v1/secrets/${encodeURIComponent(did)}`;
  const res = await AMBER_ID_BREAKER.run(
    async () =>
      fetch(url, {
        method: "GET",
        headers: { "x-api-key": AMBER_ID_API_KEY },
        signal: AbortSignal.timeout(5000),
      }),
    { fallback: null },
  );
  if (!res || !res.ok) return {};
  try {
    const body = await res.json().catch(() => null);
    return body?.values || {};
  } catch (err) {
    console.warn("[secrets] bulk fetch failed:", err?.message);
    return {};
  }
}

/** Force-invalidate the cache for a tenant (after a rotation). */
export function invalidateSecrets(tenant) {
  const did = tenantDidOf(tenant);
  if (!did) return;
  for (const k of cache.keys()) {
    if (k.startsWith(`${did}::`)) cache.delete(k);
  }
}
