/**
 * tiwari-enrich — data enrichment primitive.
 *
 * What is enrichment?
 *   > Given a known entity (a person, a company, a thread), pile on context.
 *   > Crustdata for firmographic facts; amber-id for the user's own notes
 *   > and past conversations about that entity; Newton for experimental
 *   > signal fusion. Tiwari braids all three.
 *
 * The togari-enrich repo does not yet exist — the BMA team is building it
 * on their cadence. In the meantime, this service runs on Newton + amber-id
 * alone and clearly labels `source: "tiwari-newton-amberid"`. When togari-
 * enrich ships, we add it as a submodule in `vendor/togari/`, add an adapter
 * in `src/`, and update the blender — no API change for consumers.
 */

import amberId, { AmberIdError } from "../shared/amber-id-client/index.js";
import ds, {
  recordToBPA,
  discount,
  combineMany,
  beliefPlausibilityPerDim,
  pignistic,
  DIMENSIONS,
} from "./src/ds.js";

// Pipe trust scores mirror amber-id/src/lib/dimensions.js PIPE_TRUST.
const PIPE_TRUST = Object.freeze({
  agent: 0.65,
  health: 0.95,
  checkin: 1.0,
  relationship: 0.5,
  togari: 0.65, // web-scraped default
  newton: 0.7, // ego-specific heuristics
});

function trustFor(pipe) {
  return PIPE_TRUST[pipe] ?? 0.5;
}

/**
 * @typedef {Object} EnrichRequest
 * @property {object}  entity     — { id, name, email?, personId?, company? }
 * @property {string} [userCnft]  — caller's Amber Identity; enables personal notes
 * @property {string} [token]     — Privy JWT, required if userCnft set
 * @property {object} [options]   — { topK, timeoutMs }
 */

export async function enrich({
  entity,
  userCnft = null,
  token = null,
  options = {},
} = {}) {
  if (!entity || typeof entity !== "object") {
    throw new TypeError("enrich requires `entity: { ... }`");
  }
  const started = Date.now();
  const warnings = [];
  const facts = [];
  const citations = [];

  // Step 1 — togari-enrich (NOT YET AVAILABLE).
  warnings.push("togari_enrich_not_yet_shipped");

  // Collect per-record BPAs as we go, grouped by source so we can apply
  // source-level discounting and then fuse with Dempster's rule.
  const bpasBySource = { agent: [], health: [], checkin: [], relationship: [], togari: [], newton: [] };

  // Step 2 — Newton experimental signal fusion.
  // Placeholder hook — when Sagar promotes a Newton idea for enrichment,
  // wire it here. Newton ideas earmarked for this primitive:
  //   - Newton/agent/lib/crm.js  → relationship summary from iMessage history
  //   - Newton/agent/lib/health.js → rolling 6-dimension averages for a contact

  // Step 3 — amber-id personal context (the unique sauce).
  if (userCnft && token) {
    const nameOrId = entity.name || entity.id || entity.email || "";
    if (nameOrId) {
      try {
        const { matches } = await amberId.query({
          token,
          text: `Everything I know about ${nameOrId}`,
          topK: options.topK || 8,
          filter: entity.personId ? { person_id: entity.personId } : undefined,
        });
        for (const m of matches || []) {
          const md = m.metadata || {};
          const pipe = md.source || "agent"; // legacy records default to agent
          const bpa = recordToBPA({
            healthDimension: md.health_dimension,
            relevance: m.score || 0,
            trust: typeof md.trust === "number" ? md.trust : trustFor(pipe),
          });
          (bpasBySource[pipe] || bpasBySource.agent).push(bpa);
          facts.push({
            source: "amber-id",
            pipe,
            kind: md.kind || "observation",
            text: md.text || "",
            health_dimension: md.health_dimension || null,
            trust: md.trust ?? null,
            created_at: md.created_at || null,
            score: m.score || 0,
          });
          citations.push({
            ref: m.id,
            source: "amber-id",
            pipe,
            snippet: (md.text || "").slice(0, 280),
            kind: md.kind || null,
            health_dimension: md.health_dimension || null,
            created_at: md.created_at || null,
          });
        }
      } catch (err) {
        if (err instanceof AmberIdError) {
          warnings.push(`amber_id_skipped: ${err.code || err.message}`);
        } else {
          warnings.push(`amber_id_skipped: ${err.message}`);
        }
      }
    }
  }

  // Sort facts by recency then score.
  facts.sort((a, b) => {
    const aT = a.created_at ? Date.parse(a.created_at) : 0;
    const bT = b.created_at ? Date.parse(b.created_at) : 0;
    if (bT !== aT) return bT - aT;
    return (b.score || 0) - (a.score || 0);
  });

  // Dempster-Shafer fusion across all pipes. Each pipe gets its own
  // source-level discount before combination; see enrich.tex.
  const discounted = [];
  for (const [pipe, bpas] of Object.entries(bpasBySource)) {
    if (!bpas.length) continue;
    // Fuse within a pipe first so multiple records from the same pipe
    // reinforce each other before the pipe-trust discount is applied.
    const withinPipe = combineMany(bpas);
    discounted.push(discount(withinPipe.bpa, trustFor(pipe)));
  }
  const fused = discounted.length ? combineMany(discounted) : null;

  const beliefByDim = fused ? beliefPlausibilityPerDim(fused.bpa) : null;
  const pign = fused ? pignistic(fused.bpa) : null;

  return {
    ok: true,
    source: facts.length > 0 ? "amber-id" : "empty",
    results: [{ entity, facts, beliefByDim, pignistic: pign }],
    personalized: facts.length > 0,
    conflict: fused?.conflict ?? 0,
    tookMs: Date.now() - started,
    warnings,
    citations,
  };
}

export default { enrich };
