/**
 * blend — merge togari + Newton boosts + amber-id matches into one ranked list.
 *
 * Scoring model (Eq. 5 of Tiwari/papers/peoplerank.tex):
 *   score(p) = ω_T · togari'(p)  +  ω_N · newton'(p)  +  ω_A · π*(p)
 *   defaults:  ω_T = 0.55, ω_N = 0.20, ω_A = 0.25
 *
 * π*(p) is the dimension-aware fused PageRank from pagerank.js when a
 * graph + query simplex are provided. Otherwise we fall back to the
 * previous amber-id cosine score so legacy callers still work.
 *
 * All inputs are min-max normalized to [0, 1] before blending. A candidate
 * that appears only in amber-id (not in togari) still surfaces — the
 * whole point of the "Perplexity for People" injection. Candidates that
 * appear only in togari surface unchanged.
 */

import { dimensionAwarePageRank, DIMENSIONS } from "./pagerank.js";

const W_TOGARI = 0.55;
const W_AMBERID = 0.25;
const W_NEWTON = 0.20;

function normalize(arr, getScore) {
  if (arr.length === 0) return new Map();
  const scores = arr.map(getScore).filter((s) => typeof s === "number");
  if (scores.length === 0) return new Map();
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;
  const map = new Map();
  for (const item of arr) {
    const raw = getScore(item);
    if (typeof raw !== "number") continue;
    map.set(item.id || item.personId || item.key, (raw - min) / range);
  }
  return map;
}

/**
 * Optional dimension-aware PageRank inputs. Pass `graph` and `alpha` to
 * activate Eq. 2–4 of peoplerank.tex. If omitted, we use the cosine-only
 * amberId score as a back-compat fallback.
 *
 *   graph:  { ego, vertices, edgesByDim }
 *   alpha:  query-derived dim simplex
 */
export function blendResults({
  togari = [],
  newton = [],
  amberId = [],
  topK = 20,
  graph = null,
  alpha = null,
}) {
  const byId = new Map();
  const citations = [];

  // Seed from togari
  const togariNorm = normalize(togari, (r) => r.score ?? 0);
  for (const r of togari) {
    if (!r.id) continue;
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      meta: r.meta || {},
      togariScore: togariNorm.get(r.id) || 0,
      newtonBoost: 0,
      amberIdScore: 0,
      amberIdEvidence: [],
      reasons: [],
    });
  }

  // Apply Newton boosts
  for (const b of newton) {
    const row = byId.get(b.id);
    if (!row) continue;
    row.newtonBoost = Math.min(W_NEWTON, b.boost);
    row.reasons.push(...(b.reasons || []));
  }

  // Fold in amber-id matches — this is the key injection step.
  // Group Pinecone matches by person_id first so we don't double-count.
  const byPerson = new Map();
  for (const m of amberId) {
    const md = m.metadata || {};
    const key = md.person_id || md.person_name || `amberid:${m.id}`;
    if (!byPerson.has(key)) {
      byPerson.set(key, {
        id: key,
        name: md.person_name || null,
        bestScore: m.score || 0,
        trust: typeof md.trust === "number" ? md.trust : 0.65,
        healthDimension: md.health_dimension || "*",
        evidence: [],
      });
    }
    const rec = byPerson.get(key);
    if ((m.score || 0) > rec.bestScore) rec.bestScore = m.score;
    // Prefer highest-trust dimension seen for this person.
    if ((md.trust ?? 0) > (rec.trust ?? 0)) {
      rec.trust = md.trust;
      if (md.health_dimension) rec.healthDimension = md.health_dimension;
    }
    rec.evidence.push({
      id: m.id,
      snippet: (md.text || "").slice(0, 280),
      kind: md.kind || null,
      created_at: md.created_at || null,
      score: m.score || 0,
    });
  }

  // Dimension-aware personalized PageRank path (Eq. 2–4 of peoplerank.tex).
  // Only runs when the caller passes a graph + query simplex. Otherwise
  // we fall back to raw cosine, which was the original behavior.
  let prScores = null;
  if (graph && graph.vertices?.length && graph.ego) {
    try {
      const seeds = [];
      for (const rec of byPerson.values()) {
        seeds.push({
          id: rec.id,
          cosine: rec.bestScore || 0,
          trust: rec.trust ?? 0.65,
          healthDimension: rec.healthDimension || "*",
        });
      }
      const ranked = dimensionAwarePageRank({
        ego: graph.ego,
        vertices: graph.vertices,
        edgesByDim: graph.edgesByDim,
        seeds,
        alpha: alpha || Object.fromEntries(DIMENSIONS.map((d) => [d, 1 / DIMENSIONS.length])),
      });
      prScores = new Map(ranked.map((r) => [r.id, r.score]));
    } catch (e) {
      // Bad graph? Fall through to cosine path and warn via return shape.
      prScores = null;
    }
  }

  const amberNorm = prScores
    ? normalize([...byPerson.values()], (r) => prScores.get(r.id) || 0)
    : normalize([...byPerson.values()], (r) => r.bestScore);
  for (const rec of byPerson.values()) {
    const existing = byId.get(rec.id);
    const amberScore = amberNorm.get(rec.id) || 0;
    if (existing) {
      existing.amberIdScore = amberScore;
      existing.amberIdEvidence = rec.evidence;
      existing.reasons.push(`amber_id_context:${rec.evidence.length}_snippets`);
    } else {
      byId.set(rec.id, {
        id: rec.id,
        name: rec.name,
        meta: {},
        togariScore: 0,
        newtonBoost: 0,
        amberIdScore: amberScore,
        amberIdEvidence: rec.evidence,
        reasons: ["amber_id_only_surface"],
      });
    }
  }

  // Compute final score, sort, shape output.
  const scored = [];
  for (const row of byId.values()) {
    const finalScore =
      W_TOGARI * row.togariScore +
      W_AMBERID * row.amberIdScore +
      row.newtonBoost; // already capped at W_NEWTON
    scored.push({
      id: row.id,
      name: row.name,
      score: Number(finalScore.toFixed(4)),
      source: decideSource(row),
      breakdown: {
        togari: Number(row.togariScore.toFixed(4)),
        amberId: Number(row.amberIdScore.toFixed(4)),
        newtonBoost: Number(row.newtonBoost.toFixed(4)),
      },
      reasons: row.reasons,
      meta: row.meta,
      personalEvidence: row.amberIdEvidence,
    });

    // Emit citations for amber-id evidence
    for (const ev of row.amberIdEvidence.slice(0, 3)) {
      citations.push({
        ref: `${row.id}:${ev.id}`,
        personId: row.id,
        name: row.name,
        kind: ev.kind,
        snippet: ev.snippet,
        source: "amber-id",
        created_at: ev.created_at,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);

  // Label the overall source
  const hasTogari = togari.length > 0;
  const hasAmberId = amberId.length > 0;
  const hasNewton = newton.length > 0;
  let source = "empty";
  if (hasTogari && hasAmberId) source = "blended";
  else if (hasTogari && hasNewton) source = "togari+newton";
  else if (hasTogari) source = "togari";
  else if (hasAmberId) source = "amber-id";
  else if (hasNewton) source = "newton";

  return { results: top, citations, source };
}
