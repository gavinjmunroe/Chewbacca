/**
 * Optional deployment + caller-attribution seams.
 *
 * amber-id is a single shared multi-tenant backend — every user is a tenant
 * inside the same deployment, keyed by their Privy DID. These helpers are
 * NOT a per-user partitioning mechanism; they exist for two unrelated
 * concerns that both default to no-ops in production:
 *
 *   1. Environment isolation — letting you stand up a `staging` or
 *      per-PR-preview amber-id alongside production *without* a forked
 *      Pinecone index or GCP project, by prefixing collection + namespace
 *      names. Production runs with both prefixes empty.
 *
 *   2. Service-to-service caller attribution — labeling which upstream
 *      product (amber-imessage, amber-ios-dev, amber-agent, etc.)
 *      authenticated a request, so audit logs and Pinecone metadata can
 *      tell traffic from different services apart. End users always
 *      authenticate with a Privy JWT against the shared backend.
 *
 * Do NOT use the prefix knobs to "give a user their own amber-id" — that
 * is what DIDs, cNFTs, and per-user Pinecone namespaces already do, and
 * it works inside the single shared deployment.
 *
 *   AMBER_INSTANCE_ID                  Logical name of this deployment
 *                                      (e.g. "default", "staging", a PR
 *                                      number). Stamped on audit + Pinecone
 *                                      metadata for debugging. Default:
 *                                      "default".
 *   FIRESTORE_COLLECTION_PREFIX        e.g. "staging_" → users/{x} becomes
 *                                      staging_users/{x}. Default: "".
 *   PINECONE_NAMESPACE_PREFIX          e.g. "staging:" → cnft:<mint> becomes
 *                                      staging:cnft:<mint>. Default: "".
 *   AMBER_ID_API_KEYS                  JSON array of {name, key} for multiple
 *                                      named caller keys. The legacy single
 *                                      AMBER_ID_API_KEY still works and is
 *                                      treated as the "legacy" client.
 */

let cachedKeys = null;
let cachedKeysSource = null;

export function instanceId() {
  return process.env.AMBER_INSTANCE_ID || "default";
}



export function collectionName(name) {
  return `${process.env.TABLE_PREFIX || ""}${name}`;
}


/**
 * Parse AMBER_ID_API_KEYS env var.
 *
 * Supports two formats:
 *   - JSON: `[{"name":"amber-imessage","key":"sk_..."},{"name":"amber-agent","key":"sk_..."}]`
 *   - Compact: `amber-imessage:sk_...,amber-agent:sk_...`
 *
 * Returns [{name, key}]. Cached until the env var changes.
 */
export function namedApiKeys() {
  const src = process.env.AMBER_ID_API_KEYS || "";
  if (cachedKeysSource === src) return cachedKeys || [];
  cachedKeysSource = src;
  cachedKeys = parseNamedKeys(src);
  return cachedKeys;
}

function parseNamedKeys(src) {
  if (!src) return [];
  const trimmed = src.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (e) =>
            e &&
            typeof e.name === "string" &&
            typeof e.key === "string" &&
            e.key.length > 0,
        )
        .map((e) => ({
          name: e.name,
          key: e.key,
          // Optional per-key owner DID. When set, requests authenticated with
          // this key default the `did` arg on identity/CRM tools to this value,
          // so a non-technical caller (e.g. a CEO with their own key) never has
          // to know or pass their DID. JSON format only — the compact format
          // can't carry a DID because DIDs contain colons.
          did: typeof e.did === "string" && e.did ? e.did : null,
        }));
    } catch {
      return [];
    }
  }
  return trimmed
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf(":");
      if (idx <= 0) return null;
      const name = pair.slice(0, idx).trim();
      const key = pair.slice(idx + 1).trim();
      if (!name || !key) return null;
      // Compact format carries no DID (DIDs contain colons); use JSON format
      // when a key needs an owner DID. Keep the shape consistent regardless.
      return { name, key, did: null };
    })
    .filter(Boolean);
}

/**
 * Reset the parse cache. Test-only.
 */
export function _resetNamedApiKeysCache() {
  cachedKeys = null;
  cachedKeysSource = null;
}
