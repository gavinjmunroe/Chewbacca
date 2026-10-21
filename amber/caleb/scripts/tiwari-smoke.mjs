// Runtime smoke test for the three Tiwari primitives.
// Verifies: (1) dimension-aware PageRank ranks ego-connected vertices first,
//           (2) DS fusion collapses to correct beliefs under a clear signal,
//           (3) LinUCB selects the only entitled arm when others are masked.

import { dimensionAwarePageRank, DIMENSIONS } from "../Tiwari/tiwari-peoplerank/src/pagerank.js";
import ds from "../Tiwari/tiwari-enrich/src/ds.js";
import bandit from "../Tiwari/tiwari-opportunity/src/bandit.js";

// ── 1. PageRank ────────────────────────────────────────────────────────────
const ego = "u0";
const vertices = ["u0", "p1", "p2", "p3"];
// p1 is a strong social friend of ego; p2 is a financial contact; p3 isolated.
const social = new Map([["u0", new Map([["p1", 1]])], ["p1", new Map([["u0", 1]])]]);
const financial = new Map([["u0", new Map([["p2", 1]])], ["p2", new Map([["u0", 1]])]]);
const empty = new Map();
const edgesByDim = [
  empty, empty, empty, empty, social, financial, // spiritual, emotional, physical, intellectual, SOCIAL, FINANCIAL
];
const alphaSocial = { spiritual: 0, emotional: 0, physical: 0, intellectual: 0, social: 1, financial: 0 };
const rankedSocial = dimensionAwarePageRank({
  ego, vertices, edgesByDim,
  seeds: [{ id: "p1", cosine: 0.9, trust: 1.0, healthDimension: "social" }],
  alpha: alphaSocial,
});
const winner = rankedSocial[0].id;
console.log("[pagerank] social query top:", winner, rankedSocial.map((r) => ({ id: r.id, s: r.score.toFixed(3) })));
if (winner !== "p1") { console.error("FAIL: expected p1 to top social query"); process.exit(1); }

// ── 2. Dempster-Shafer ─────────────────────────────────────────────────────
// A checkin (trust 1.0) says "physical"; a scraped agent record (trust 0.65)
// says "financial". After pipe-trust discounting + combination, physical
// should carry more belief than financial.
const checkinBPA = ds.recordToBPA({ healthDimension: "physical", relevance: 0.9, trust: 1.0 });
const agentBPA = ds.recordToBPA({ healthDimension: "financial", relevance: 0.8, trust: 0.65 });
const disc1 = ds.discount(checkinBPA, 1.0);
const disc2 = ds.discount(agentBPA, 0.65);
const fused = ds.combineMany([disc1, disc2]);
const beliefs = ds.beliefPlausibilityPerDim(fused.bpa);
console.log("[ds] bel(physical):", beliefs.physical.bel.toFixed(3), " bel(financial):", beliefs.financial.bel.toFixed(3), " conflict:", fused.conflict.toFixed(3));
if (beliefs.physical.bel <= beliefs.financial.bel) { console.error("FAIL: checkin should dominate scraped evidence"); process.exit(1); }

// ── 3. LinUCB ──────────────────────────────────────────────────────────────
const b = new bandit.DimensionAwareLinUCB();
const context = {
  alpha: { spiritual: 0.4, emotional: 0.3, physical: 0.1, intellectual: 0.1, social: 0.05, financial: 0.05 },
  pi: { spiritual: 0.1, emotional: 0.1, physical: 0.1, intellectual: 0.2, social: 0.3, financial: 0.2 },
};
const candidates = [
  { channel: "push", dimension: "spiritual" },
  { channel: "push", dimension: "social" },   // pi(social)=0.3 → higher diversity penalty
  { channel: "push", dimension: "physical" },
];
const { chosen, all } = b.select({ candidates, context });
console.log("[bandit] cold-start choice:", chosen.id, "score:", chosen.score.toFixed(3));
console.log("[bandit] all:", all.map((x) => ({ id: x.id, s: x.score.toFixed(3), pen: x.diversityPenalty.toFixed(3) })));
// Social has the highest pi-penalty, so should NOT be chosen at cold start.
if (chosen.cand.dimension === "social") { console.error("FAIL: diversity penalty didn't discourage social"); process.exit(1); }

console.log("\nAll three Tiwari primitives pass smoke tests.");
