/**
 * Classify a natural-language query into a weighted distribution over the
 * six Amber health dimensions.
 *
 * Used by /ask to produce dimension-weighted retrieval: if the user asks
 * "who should I talk to when I feel anxious?", we upweight `emotional`
 * and `spiritual` over `financial`.
 *
 * Strategy: deterministic keyword scoring with a floor. No model call — this
 * is the read path, and it runs once per question asked. See the note on
 * classifyDimensions below for why that matters.
 *
 * Never returns zeros — every dimension retains a floor weight so
 * retrieval never fully excludes a dimension.
 */

import { DIMENSIONS } from "./dimensions.js";

const FLOOR = 0.15;

// Seed lexicons. These are intentionally small and conservative.
// Full taxonomy lives in the LLM call; this is just a fallback.
const LEXICON = {
  spiritual: [
    "purpose",
    "faith",
    "meaning",
    "alignment",
    "pray",
    "spiritual",
    "meditat",
    "dharma",
    "soul",
    "mindful",
    "god",
    "values",
  ],
  emotional: [
    "anxious",
    "anxiety",
    "sad",
    "angry",
    "upset",
    "happy",
    "feel",
    "feeling",
    "emotion",
    "mood",
    "cry",
    "depress",
    "lonely",
    "peace",
    "stress",
    "grief",
  ],
  physical: [
    "sleep",
    "tired",
    "energy",
    "workout",
    "exercise",
    "run",
    "gym",
    "sick",
    "body",
    "food",
    "eat",
    "nutrition",
    "movement",
    "rest",
    "sore",
    "pain",
  ],
  intellectual: [
    "learn",
    "study",
    "curious",
    "read",
    "book",
    "idea",
    "think",
    "knowledge",
    "research",
    "paper",
    "class",
    "course",
    "grow",
  ],
  social: [
    "friend",
    "family",
    "relationship",
    "connect",
    "lonely",
    "commun",
    "belong",
    "group",
    "party",
    "chat",
    "hang",
    "together",
    "date",
  ],
  financial: [
    "money",
    "career",
    "job",
    "work",
    "salary",
    "invest",
    "stock",
    "fund",
    "debt",
    "rich",
    "abundance",
    "business",
    "client",
    "professional",
    "network",
  ],
};

function heuristicWeights(text) {
  const t = String(text || "").toLowerCase();
  const raw = {};
  let total = 0;
  for (const d of DIMENSIONS) {
    let hits = 0;
    for (const kw of LEXICON[d]) {
      if (t.includes(kw)) hits += 1;
    }
    raw[d] = hits;
    total += hits;
  }
  const weights = {};
  if (total === 0) {
    for (const d of DIMENSIONS) weights[d] = 1 / DIMENSIONS.length;
    return weights;
  }
  for (const d of DIMENSIONS) {
    // Softmax-ish normalization with a floor so nothing is fully zeroed.
    weights[d] = FLOOR + (1 - FLOOR * DIMENSIONS.length) * (raw[d] / total);
  }
  // Rescale to sum=1 after the floor
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const d of DIMENSIONS) weights[d] /= sum;
  return weights;
}

/**
 * Weight a query across the six dimensions.
 *
 * WAS heuristic + an optional Perplexity `sonar` refinement, soft-blended at
 * alpha 0.5. The refinement is GONE, and removing it changes nothing that was
 * actually running: the LLM leg was gated on PERPLEXITY_API_KEY, so the moment
 * that key leaves Railway this function was already heuristic-only. Deleting it
 * makes the real behavior the only behavior instead of leaving a branch that
 * silently reactivates if somebody re-adds a key.
 *
 * AND IT SHOULD STAY DETERMINISTIC. This runs on the READ path, once per /ask
 * query. Putting a model call here means paying per question asked rather than
 * per fact stored — the opposite of how the rest of the pipeline is built,
 * where classification happens once on write (see lib/observation-dimensions.js
 * for that side, which IS a model call and is billed once per fact, forever).
 *
 * The heuristic never returns zeros: every dimension keeps a FLOOR weight, so
 * retrieval down-ranks an unrelated dimension rather than excluding it. A query
 * that matches no lexicon at all yields a flat distribution, which is the
 * correct "no signal" answer — retrieveHybrid then ranks on similarity and
 * recency alone.
 *
 * `opts` is accepted and ignored so existing callers passing { useLLM, alpha }
 * keep working without a signature change.
 */
export async function classifyDimensions(text, _opts = {}) {
  return heuristicWeights(text);
}

export { heuristicWeights };
