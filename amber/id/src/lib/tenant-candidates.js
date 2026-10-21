/**
 * Shared multi-tenant enumeration for the intelligence-layer jobs
 * (people-rank, contact-edges, relationship-snapshot, memory-consolidator,
 * drift-detector).
 *
 * WHY: each job used to hardcode `[MEDHA_TENANT_DID]` as its default candidate
 * set, so only the founder ever got ranking / edges / snapshots / highlights /
 * drift. Every OTHER provisioned Amber user was silently skipped. This helper
 * enumerates ALL currently-provisioned tenant DIDs from the authoritative
 * source — the Cloud SQL `users` table exposed via the `tenantIndex` cache that
 * `/tenants/list?active=true` reads from — so a newly onboarded user is picked
 * up automatically on the next job tick with NO env change.
 *
 * Data stays siloed: this only produces the LIST of tenant DIDs. Each job still
 * resolves per-DID (getUserByPrivyDid → that tenant's cNFT namespace) and reads
 * / writes only that one namespace, so there is no cross-tenant mixing.
 *
 * Precedence:
 *   1. Explicit override env (e.g. PEOPLE_RANK_TENANTS) — comma-separated DIDs.
 *   2. All provisioned tenants from tenantIndex (Cloud SQL).
 *   3. Fallback to the single MEDHA_TENANT_DID (when enumeration is unavailable
 *      — e.g. Cloud SQL unreachable — so a job degrades instead of crashing).
 *
 * Togari (and any caller-supplied system DIDs) are ALWAYS excluded, and the
 * result is de-duplicated.
 */

import { tenantIndex } from "./auth-session.js";

export const MEDHA_TENANT_DID = "did:privy:cmobxrpvr00ml0cjp5gq5mdyd";
export const TOGARI_TENANT_DID = "did:privy:cmo0ay9oy001u0cl7h1wb7thy";

function dedupe(dids) {
  return [...new Set(dids)];
}

/**
 * Resolve the in-scope tenant DIDs for a job.
 *
 * @param {object}   opts
 * @param {string=}  opts.overrideEnv   Raw comma-separated override (e.g.
 *                                       process.env.PEOPLE_RANK_TENANTS).
 * @param {string=}  opts.fallbackDid   DID to fall back to when enumeration
 *                                       yields nothing (default MEDHA).
 * @param {string[]=} opts.excludeDids  Extra system/non-user DIDs to strip.
 * @param {object=}  opts.log           Logger (default console).
 * @returns {Promise<string[]>} de-duplicated, TOGARI-excluded tenant DIDs.
 */
export async function enumerateTenantDids({
  overrideEnv,
  fallbackDid = MEDHA_TENANT_DID,
  excludeDids = [],
  log = console,
} = {}) {
  const exclude = new Set([TOGARI_TENANT_DID, ...excludeDids]);

  // 1. Explicit override — behaves exactly like the legacy env-split path.
  const raw = (overrideEnv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (raw.length) {
    return dedupe(raw.filter((did) => !exclude.has(did)));
  }

  // 2. Enumerate every provisioned tenant from Cloud SQL (the same source that
  //    backs /tenants/list). forceRefresh swallows its own errors and leaves
  //    the snapshot empty on failure, so a Cloud SQL outage surfaces here as an
  //    empty list rather than a throw.
  try {
    await tenantIndex.forceRefresh();
    const all = tenantIndex.getAll() || [];
    const dids = dedupe(
      all
        .map((t) => t?.did || t?.id)
        .filter(Boolean)
        .filter((did) => !exclude.has(did)),
    );
    if (dids.length) return dids;
    log?.warn?.(
      `[tenant-candidates] enumeration returned no tenants; falling back to ${fallbackDid}`,
    );
  } catch (err) {
    log?.warn?.(
      `[tenant-candidates] enumeration failed (${err.message}); falling back to ${fallbackDid}`,
    );
  }

  // 3. Fallback so the job degrades to the founder rather than crashing.
  return dedupe([fallbackDid].filter((did) => did && !exclude.has(did)));
}
