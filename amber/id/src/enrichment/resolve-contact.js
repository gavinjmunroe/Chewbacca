/**
 * Enrichment orchestrator: wire provider (F2 seam) + context ranker + F1
 * storage. Owner-scoped throughout.
 *
 *   resolveOneContact(ownerId, contactId)
 *     load contact + owner prior → provider.searchCandidates({ name }) →
 *     rankCandidates → persist:
 *       auto      → setContactEnrichment(resolved columns + enrichment jsonb)
 *       ambiguous → setContactEnrichmentCandidates(full ranked array)
 *       none      → 'failed' if the provider ran but found nothing;
 *                   left 'unenriched' if no provider was configured
 *   resolveContactsBatch(ownerId, contactIds[]) — bounded-concurrency loop.
 */

import {
  getContactById,
  getUserProfileByAmberId,
  getUserProfileExtraByAmberId,
  setContactEnrichment,
  setContactEnrichmentCandidates,
  tagContactFromEnrichment,
} from "../db/store.js";
import { selectEnrichmentProvider } from "./providers/enrichment-provider.js";
import { buildUserPrior, rankCandidates } from "./context-ranker.js";

// Map a chosen candidate to the dedicated contact columns setContactEnrichment
// whitelists. state/country live only in the enrichment jsonb (no columns).
// Exported so the confirm-resolution endpoint maps the chosen stored candidate
// to columns via the SAME mapping the auto path uses.
export function mapChosenToColumns(c) {
  const fields = {};
  if (c?.linkedinUrl) fields.linkedin_url = c.linkedinUrl;
  if (c?.title) fields.title = c.title;
  if (c?.company) fields.company = c.company;
  if (c?.city) fields.city = c.city;
  return fields;
}

// Fields passed to tagContactFromEnrichment. Exported so a future
// confirm-resolution path can synthesize the same verified tags/facts.
export function tagFieldsFromChosen(c) {
  return {
    title: c?.title ?? null,
    company: c?.company ?? null,
    city: c?.city ?? null,
    industry: c?.industry ?? c?.raw?.industry ?? null,
  };
}

async function loadPrior(ownerId) {
  const [profile, extra] = await Promise.all([
    getUserProfileByAmberId(ownerId).catch(() => null),
    getUserProfileExtraByAmberId(ownerId).catch(() => ({})),
  ]);
  // Merge users-columns object with profile_extra overflow for buildUserPrior.
  return buildUserPrior({ ...(profile || {}), ...(extra || {}) });
}

/**
 * Resolve one contact. Returns { resolution: 'auto'|'ambiguous'|'none', count }.
 */
export async function resolveOneContact(ownerId, contactId) {
  if (!ownerId || !contactId) return { resolution: "none", count: 0 };

  const contact = await getContactById(ownerId, contactId);
  const name = contact?.name ? String(contact.name).trim() : "";
  if (!name) return { resolution: "none", count: 0 };

  const prior = await loadPrior(ownerId);
  const provider = await selectEnrichmentProvider({ did: ownerId });
  const { configured, candidates } = await provider.searchCandidates({ name });

  const { resolution, chosen, ranked } = rankCandidates(candidates, prior, contact);
  const fetchedAt = new Date().toISOString();

  if (resolution === "auto") {
    await setContactEnrichment(ownerId, contactId, {
      fields: mapChosenToColumns(chosen),
      enrichment: {
        provider: provider.name,
        confidence: "auto",
        signals: ranked[0]?.signals ?? [],
        candidate: chosen,
        fetched_at: fetchedAt,
      },
      status: "resolved",
    });
    // Verified-data-only: synthesize tags + facts (feeds PeopleRank). ONLY on
    // the auto/resolved path — never for ambiguous/none.
    await tagContactFromEnrichment(ownerId, contactId, tagFieldsFromChosen(chosen));
    return { resolution, count: ranked.length };
  }

  if (resolution === "ambiguous") {
    // Store the FULL ranked array (never truncated).
    await setContactEnrichmentCandidates(ownerId, contactId, ranked);
    return { resolution, count: ranked.length };
  }

  // resolution === "none": mark failed only if a provider actually ran and
  // still found nothing; otherwise leave the contact unenriched.
  if (configured) {
    await setContactEnrichment(ownerId, contactId, {
      enrichment: { provider: provider.name, confidence: "none", fetched_at: fetchedAt },
      status: "failed",
    });
  }
  return { resolution: "none", count: 0 };
}

/**
 * Resolve a batch with bounded concurrency. Returns
 * { total, auto, ambiguous, none, results:[{ contactId, resolution }] }.
 * `results` preserves input order (workers write to a per-index slot).
 */
export async function resolveContactsBatch(ownerId, contactIds, { concurrency = 5 } = {}) {
  const ids = Array.isArray(contactIds) ? contactIds.filter(Boolean) : [];
  const tally = { total: ids.length, auto: 0, ambiguous: 0, none: 0 };
  const results = new Array(ids.length);
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const i = cursor++;
      const id = ids[i];
      let resolution = "none";
      try {
        ({ resolution } = await resolveOneContact(ownerId, id));
      } catch {
        resolution = "none";
      }
      if (resolution === "auto") tally.auto++;
      else if (resolution === "ambiguous") tally.ambiguous++;
      else tally.none++;
      results[i] = { contactId: String(id), resolution };
    }
  }
  const n = Math.max(1, Math.min(concurrency, ids.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return { ...tally, results };
}
