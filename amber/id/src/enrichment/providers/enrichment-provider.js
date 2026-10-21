/**
 * Enrichment provider seam. Selects the real Clay provider when an API key is
 * resolvable, else the deterministic stub. `ENRICHMENT_PROVIDER=stub|clay`
 * forces the choice. The Clay key is per-user (secrets bag) with an app-level
 * env fallback; with no key at all, selection falls back to the stub, so the
 * live Clay call stays dormant until a key exists.
 *
 * Provider interface:
 *   async searchCandidates({ name, country?, limit=30 })
 *     → { configured:boolean, candidates:[{ name, linkedinUrl, title, company,
 *         city, state, country, raw }] }
 */

import { getSecret } from "../../db/secrets.js";
import { makeClayProvider } from "./clay-provider.js";
import { makeStubProvider } from "./stub-provider.js";

/**
 * Resolve the Clay API key for a caller: per-user secret first, then app-level
 * env. Returns null when neither is set. Never throws.
 */
export async function getClayKey(did) {
  let perUser = null;
  if (did) {
    try {
      perUser = await getSecret(did, "CLAY_API_KEY");
    } catch {
      perUser = null;
    }
  }
  return perUser ?? process.env.CLAY_API_KEY ?? null;
}

/**
 * Pick the enrichment provider. Optional `{ did }` lets a per-user Clay key win
 * over the app-level env key. `ENRICHMENT_PROVIDER` forces 'stub' or 'clay'
 * (forced 'clay' with no key still returns the Clay provider, which no-ops as
 * { configured:false }). Default: Clay iff a key resolves, else stub.
 */
export async function selectEnrichmentProvider({ did } = {}) {
  const forced = (process.env.ENRICHMENT_PROVIDER || "").trim().toLowerCase();
  if (forced === "stub") return makeStubProvider();
  const key = await getClayKey(did);
  if (forced === "clay") return makeClayProvider(key);
  return key ? makeClayProvider(key) : makeStubProvider();
}
