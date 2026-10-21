/**
 * tiwari-peoplerank — list building primitive.
 *
 * What is list building?
 *   > Search. Discovery. "Who / what matches this criteria?"
 *   > Exa for the web; togari-peoplerank for the BMA contact graph; amber-id
 *   > Pinecone for the user's private people. Tiwari braids all three.
 *
 * Inputs:  { query, filters, userCnft, token, options }
 * Outputs: { ok, source, results, personalized, tookMs, warnings, citations }
 *
 * The three-step recipe every tiwari-* service follows:
 *   1. Vendor togari  —  base list from togari-peoplerank (BigQuery contacts,
 *                        scoring, whatever it natively supports).
 *   2. Blend Newton   —  enrich ranking with Newton experimental ideas
 *                        (e.g. 6-health-dimension affinity, groups-aware weight).
 *   3. Inject amber-id —  if a userCnft is present AND we have the user's JWT,
 *                        query amber-id's private KB and promote results the
 *                        user already has context on.
 */

import amberId, { AmberIdError } from "../shared/amber-id-client/index.js";
import * as togari from "./src/togari-adapter.js";
import * as newton from "./src/newton-adapter.js";
import { blendResults } from "./src/blend.js";

/**
 * @typedef {Object} ListBuildRequest
 * @property {string}   query       — natural language intent ("SF-based founders under 35")
 * @property {object}  [filters]    — structured filters (city, role, tags, recency)
 * @property {string}  [userCnft]   — caller's Amber Identity cNFT; enables personalization
 * @property {string}  [token]      — caller's Privy JWT; required to read their KB
 * @property {object}  [options]    — { topK, includeNewton, includeAmberId, timeoutMs }
 */

export async function listBuild({
  query,
  filters = {},
  userCnft = null,
  token = null,
  ownerDid = null,
  options = {},
} = {}) {
  if (!query || typeof query !== "string") {
    throw new TypeError("listBuild requires `query: string`");
  }
  const started = Date.now();
  const {
    topK = 20,
    includeNewton = true,
    includeAmberId = Boolean(userCnft && token),
  } = options;

  const warnings = [];

  // ownerDid scopes the togari search to a single Medha-id pool (BMA
  // team member or external customer). Upstream may ignore it until
  // the WS-0 owner_did migration lands; the adapter still forwards it.
  const togariResults = await togari
    .search({ query, filters, topK, ownerDid })
    .catch((err) => {
      warnings.push(`togari_unavailable: ${err.message}`);
      return [];
    });

  // Step 2 — Newton bells and whistles (experimental re-ranking).
  let newtonBoosts = [];
  if (includeNewton) {
    try {
      newtonBoosts = await newton.rerank({ query, candidates: togariResults });
    } catch (err) {
      warnings.push(`newton_rerank_skipped: ${err.message}`);
    }
  }

  // Step 3 — amber-id personal context injection.
  let amberIdMatches = [];
  let personalized = false;
  if (includeAmberId) {
    try {
      const { matches } = await amberId.query({
        token,
        text: query,
        topK: Math.min(12, topK),
      });
      amberIdMatches = matches || [];
      personalized = amberIdMatches.length > 0;
    } catch (err) {
      // amber-id is best-effort — never block list building on personal context.
      if (err instanceof AmberIdError) {
        warnings.push(`amber_id_skipped: ${err.code || err.message}`);
      } else {
        warnings.push(`amber_id_skipped: ${err.message}`);
      }
    }
  }

  // Blend.
  const { results, citations, source } = blendResults({
    togari: togariResults,
    newton: newtonBoosts,
    amberId: amberIdMatches,
    topK,
  });

  return {
    ok: true,
    source,
    results,
    personalized,
    tookMs: Date.now() - started,
    warnings,
    citations,
  };
}

export default { listBuild };
