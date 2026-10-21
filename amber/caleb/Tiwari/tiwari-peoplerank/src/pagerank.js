/**
 * pagerank.js — dimension-aware personalized PageRank.
 *
 * Implements the math of `Tiwari/papers/peoplerank.tex`:
 *   - Six row-stochastic transition matrices P^(d), one per health dimension.
 *   - Six personalized teleport vectors v^(d) seeded by the ego + Pinecone-
 *     recalled vertices, weighted by cosine × pipe trust.
 *   - Power-iterate the fixed point π^(d) = (1-β)v^(d) + β (P^(d))ᵀ π^(d).
 *   - Fuse the six π^(d) on the simplex with a weighted geometric mean
 *     (Aitchison) multiplied by an exponentiated dimension-diversity bonus.
 *
 * The graph is assumed sparse and is passed in as an adjacency list keyed by
 * person_id; this is a pure function with no external I/O so it is trivial
 * to test and to migrate to a GPU path later.
 */

export const DIMENSIONS = Object.freeze([
  "spiritual",
  "emotional",
  "physical",
  "intellectual",
  "social",
  "financial",
]);

const DEFAULT_BETA = 0.85;
const DEFAULT_EPS = 1e-6;
const DEFAULT_MAX_ITERS = 64;
const DEFAULT_DIVERSITY_GAMMA = 0.5;

/**
 * Normalize a value-map to sum to 1. Empty maps stay empty.
 */
function l1Normalize(map) {
  let sum = 0;
  for (const v of map.values()) sum += v;
  if (sum <= 0) return map;
  for (const [k, v] of map) map.set(k, v / sum);
  return map;
}

/**
 * Build per-dimension row-stochastic transition on a dense vertex list.
 * `edges[d]` is a Map<from, Map<to, rawWeight>>. Rows that don't sum to
 * anything are replaced with a self-loop, which preserves row-stochasticity
 * without adding spurious flow.
 */
function rowStochastic(vertices, edges) {
  const N = vertices.length;
  const P = new Array(N);
  const idx = new Map(vertices.map((v, i) => [v, i]));
  for (let i = 0; i < N; i++) {
    const from = vertices[i];
    const row = new Float64Array(N);
    const out = edges.get(from);
    let s = 0;
    if (out) {
      for (const [to, w] of out) {
        const j = idx.get(to);
        if (j !== undefined && w > 0) {
          row[j] = w;
          s += w;
        }
      }
    }
    if (s <= 0) {
      row[i] = 1;
    } else {
      for (let j = 0; j < N; j++) row[j] /= s;
    }
    P[i] = row;
  }
  return { P, idx };
}

/**
 * Personalized PageRank for one dimension.
 *   π_{t+1} = (1-β) v + β Pᵀ π_t
 */
function personalizedPageRank(P, v, { beta, eps, maxIters }) {
  const N = P.length;
  let pi = Float64Array.from(v);
  for (let it = 0; it < maxIters; it++) {
    const next = new Float64Array(N);
    // Pᵀ π = Σ_i P[i][j] * π[i]
    for (let i = 0; i < N; i++) {
      const pii = pi[i];
      if (pii === 0) continue;
      const row = P[i];
      for (let j = 0; j < N; j++) next[j] += row[j] * pii;
    }
    let delta = 0;
    for (let j = 0; j < N; j++) {
      const x = (1 - beta) * v[j] + beta * next[j];
      delta += Math.abs(x - pi[j]);
      next[j] = x;
    }
    pi = next;
    if (delta < eps) break;
  }
  return pi;
}

/**
 * Weighted geometric mean of per-dimension scores plus Shannon-entropy
 * diversity bonus (Eq. 3 of peoplerank.tex):
 *
 *   π*(p) ∝  Π_d π^(d)(p)^{α_d}  ·  exp(γ · H(π_p))
 *
 * where π_p is the ℓ1-normalized row of per-dimension scores for vertex p.
 */
function fuse({ perDim, alpha, gamma = DEFAULT_DIVERSITY_GAMMA }) {
  const N = perDim[0].length;
  const scores = new Float64Array(N);
  const EPS = 1e-12;
  for (let p = 0; p < N; p++) {
    // Weighted geometric mean in log space for numerical stability.
    let logGm = 0;
    const row = new Float64Array(DIMENSIONS.length);
    for (let d = 0; d < DIMENSIONS.length; d++) {
      const pid = perDim[d][p];
      row[d] = pid;
      logGm += alpha[DIMENSIONS[d]] * Math.log(pid + EPS);
    }
    // Diversity: H(row_normalized)
    let rs = 0;
    for (let d = 0; d < DIMENSIONS.length; d++) rs += row[d];
    let H = 0;
    if (rs > 0) {
      for (let d = 0; d < DIMENSIONS.length; d++) {
        const q = row[d] / rs;
        if (q > 0) H -= q * Math.log(q);
      }
    }
    scores[p] = Math.exp(logGm + gamma * H);
  }
  // ℓ1 normalize
  let s = 0;
  for (let p = 0; p < N; p++) s += scores[p];
  if (s > 0) for (let p = 0; p < N; p++) scores[p] /= s;
  return scores;
}

/**
 * Public entry point.
 *
 * @param {object} args
 * @param {string}   args.ego          — the querying user's person id (must be in `vertices`)
 * @param {string[]} args.vertices     — dense list of person ids in the graph
 * @param {Map<string, Map<string,number>>[]} args.edgesByDim
 *                                       one adjacency-list per dimension (length 6, ordered
 *                                       per DIMENSIONS above)
 * @param {{id:string, cosine:number, trust:number, healthDimension:string}[]} args.seeds
 *                                       Pinecone-recalled vertices to boost in the teleport
 *                                       vector for their declared dimension (and a small bit
 *                                       for the others).
 * @param {Object.<string,number>} args.alpha
 *                                       query-derived dimension simplex ({spiritual:0.3,...})
 * @param {object} [args.opts]          { beta, eps, maxIters, lambda, gamma }
 *
 * @returns {{ id: string, score: number, perDimension: Object.<string,number> }[]}
 *          sorted descending by fused score.
 */
export function dimensionAwarePageRank({
  ego,
  vertices,
  edgesByDim,
  seeds = [],
  alpha,
  opts = {},
}) {
  if (!vertices.includes(ego)) {
    throw new Error(`ego ${ego} missing from vertices`);
  }
  if (!Array.isArray(edgesByDim) || edgesByDim.length !== DIMENSIONS.length) {
    throw new Error(`edgesByDim must have ${DIMENSIONS.length} entries (one per dimension)`);
  }
  const beta = opts.beta ?? DEFAULT_BETA;
  const eps = opts.eps ?? DEFAULT_EPS;
  const maxIters = opts.maxIters ?? DEFAULT_MAX_ITERS;
  const lambda = opts.lambda ?? 1.0;
  const gamma = opts.gamma ?? DEFAULT_DIVERSITY_GAMMA;

  const normalizedAlpha = Object.fromEntries(DIMENSIONS.map((d) => [d, 0]));
  let aSum = 0;
  for (const d of DIMENSIONS) {
    normalizedAlpha[d] = Math.max(0, alpha?.[d] ?? 0);
    aSum += normalizedAlpha[d];
  }
  if (aSum <= 0) for (const d of DIMENSIONS) normalizedAlpha[d] = 1 / DIMENSIONS.length;
  else for (const d of DIMENSIONS) normalizedAlpha[d] /= aSum;

  // Build per-dim transition matrices.
  const perDim = new Array(DIMENSIONS.length);
  let idx = null;
  for (let d = 0; d < DIMENSIONS.length; d++) {
    const { P, idx: thisIdx } = rowStochastic(vertices, edgesByDim[d] || new Map());
    if (d === 0) idx = thisIdx;
    // Build personalized teleport vector v^(d).
    const N = vertices.length;
    const v = new Float64Array(N);
    v[thisIdx.get(ego)] = 1;
    for (const s of seeds) {
      const j = thisIdx.get(s.id);
      if (j === undefined) continue;
      const match = s.healthDimension === DIMENSIONS[d];
      const weight = match ? 1.0 : 0.1; // small cross-dimensional leakage
      v[j] += lambda * weight * (s.cosine || 0) * (s.trust ?? 0.65);
    }
    // Normalize v
    let vs = 0;
    for (let i = 0; i < N; i++) vs += v[i];
    if (vs > 0) for (let i = 0; i < N; i++) v[i] /= vs;

    perDim[d] = personalizedPageRank(P, v, { beta, eps, maxIters });
  }

  const fused = fuse({ perDim, alpha: normalizedAlpha, gamma });

  const out = [];
  for (let p = 0; p < vertices.length; p++) {
    if (vertices[p] === ego) continue; // never recommend the ego back to themselves
    const perDimension = {};
    for (let d = 0; d < DIMENSIONS.length; d++) {
      perDimension[DIMENSIONS[d]] = perDim[d][p];
    }
    out.push({ id: vertices[p], score: fused[p], perDimension });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export default { dimensionAwarePageRank, DIMENSIONS };

// Small internal helpers exported for tests.
export const __test = { rowStochastic, personalizedPageRank, fuse, l1Normalize };
