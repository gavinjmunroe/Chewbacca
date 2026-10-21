/**
 * Resolve a tenant by an OAuth-connected account email.
 *
 * The existing /v1/tenants/by-email path uses Privy's getUserByEmail, which
 * only matches the user's Privy primary / linked-account email. But tenants
 * routinely have additional emails surfaced through OAuth integrations
 * (Google, Microsoft, GitHub, Railway, Notion, Slack) — those land in the
 * per-tenant secrets bag under keys named `<PROVIDER>_OAUTH_ACCOUNT_EMAIL`
 * (or aliases like `GMAIL_OAUTH_ACCOUNT_EMAIL`, `GDRIVE_OAUTH_ACCOUNT_EMAIL`).
 *
 * When Sagar messages Medha on Slack with his Microsoft work email
 * (caleb@bluemodernadvisory.com) the Privy primary lookup misses, but the
 * MS_OAUTH_ACCOUNT_EMAIL in his tenant's bag matches. This module closes
 * that gap.
 *
 * Lookup shape:
 *   1. Iterate all known tenants (cheap: in-memory tenantIndex).
 *   2. For each, listSecretNames(did) and keep only key names that end with
 *      `_OAUTH_ACCOUNT_EMAIL`. No decryption yet — we only fetch the bytes
 *      for keys we actually need.
 *   3. Decrypt each candidate; lowercase-compare against the target email.
 *   4. Return the first matching tenant.
 *
 * In-memory caching (positive AND negative hits) bounds the cost:
 *   - Cold miss: O(tenants × oauth providers) Firestore reads, ~60 in
 *     practice for ~10 tenants × ~6 providers.
 *   - Warm hits: O(1) map lookup.
 *   - TTL: 5 minutes. After that, re-scan. Slack auto-bind permanently
 *     stamps slack-links so subsequent messages from the same user never
 *     re-enter this resolver.
 */

import {
  getSecret,
  listSecretNames,
  createDekCache,
} from "../secrets-v2/store.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const OAUTH_EMAIL_KEY_SUFFIX = "_OAUTH_ACCOUNT_EMAIL";

const cache = new Map();

export function _resetCacheForTests() {
  cache.clear();
}

function cacheGet(emailLower) {
  const hit = cache.get(emailLower);
  if (!hit) return undefined;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(emailLower);
    return undefined;
  }
  return hit;
}

function cacheSet(emailLower, entry) {
  cache.set(emailLower, { ...entry, ts: Date.now() });
}

function isOAuthAccountEmailKey(keyName) {
  return (
    typeof keyName === "string" &&
    keyName.endsWith(OAUTH_EMAIL_KEY_SUFFIX) &&
    keyName.length > OAUTH_EMAIL_KEY_SUFFIX.length
  );
}

/**
 * Scan one tenant's secrets bag for any *_OAUTH_ACCOUNT_EMAIL value that
 * matches `emailLower`. Returns the matching key name on hit, null on miss.
 * Failures during decrypt of any single key are swallowed (logged) so a
 * broken DEK on one provider never aborts the scan.
 */
async function tenantHasOAuthEmail(did, emailLower) {
  let names;
  try {
    names = await listSecretNames(did);
  } catch (err) {
    console.warn(
      `[tenant-email-resolver] listSecretNames(${did}) failed: ${err.message}`,
    );
    return null;
  }
  const dekCache = createDekCache();
  for (const entry of names) {
    if (!isOAuthAccountEmailKey(entry.keyName)) continue;
    let value;
    try {
      value = await getSecret(did, entry.keyName, { dekCache });
    } catch (err) {
      console.warn(
        `[tenant-email-resolver] getSecret(${did}, ${entry.keyName}) failed: ${err.message}`,
      );
      continue;
    }
    if (typeof value !== "string") continue;
    if (value.trim().toLowerCase() === emailLower) {
      return entry.keyName;
    }
  }
  return null;
}

/**
 * Find the tenant whose secrets bag contains an OAuth-account email matching
 * the supplied email. Returns:
 *   { did, matchedKey }   on hit
 *   null                   on miss / invalid input / no tenants
 *
 * `listAllTenants` is injected (rather than imported) so the resolver stays
 * testable and so we don't pull a heavy Privy module into the lib layer.
 * Pass a function returning a list of objects each with at least
 * `{ id: string }` (the Privy DID).
 */
export async function findTenantByOAuthEmail(email, { listAllTenants } = {}) {
  if (typeof email !== "string") return null;
  const emailLower = email.trim().toLowerCase();
  if (!emailLower) return null;
  if (typeof listAllTenants !== "function") return null;

  const cached = cacheGet(emailLower);
  if (cached) {
    return cached.did
      ? { did: cached.did, matchedKey: cached.matchedKey, cached: true }
      : null;
  }

  let tenants;
  try {
    tenants = await listAllTenants();
  } catch (err) {
    console.warn(
      `[tenant-email-resolver] listAllTenants failed: ${err.message}`,
    );
    return null;
  }

  if (!Array.isArray(tenants) || tenants.length === 0) {
    cacheSet(emailLower, { did: null });
    return null;
  }

  for (const t of tenants) {
    const did = t?.id;
    if (typeof did !== "string" || !did) continue;
    const matchedKey = await tenantHasOAuthEmail(did, emailLower);
    if (matchedKey) {
      cacheSet(emailLower, { did, matchedKey });
      return { did, matchedKey, cached: false };
    }
  }

  cacheSet(emailLower, { did: null });
  return null;
}
