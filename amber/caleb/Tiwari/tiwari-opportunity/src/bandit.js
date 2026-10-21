/**
 * bandit.js — LinUCB with a dimension-diversity bonus.
 *
 * Formalism: Tiwari/papers/opportunity.tex (§ LinUCB with Diversity Bonus).
 *
 *   a_t = argmax_a  φᵀ θ̂_a + λ √(φᵀ A_a⁻¹ φ)  −  μ · π_t^{(d(a))}
 *
 * Arms are (channel, moment, relationship) triples. The policy is
 * deliberately conservative: unknown-arm confidence is high by design
 * so unexplored (channel, dimension) combos get probed early.
 *
 * This module is pure and in-memory. Persistence of (A_a, b_a) is the
 * caller's responsibility (Postgres or Redis) — the module exposes
 * (de)serialization helpers.
 */

export const DIMENSIONS = Object.freeze([
  "spiritual",
  "emotional",
  "physical",
  "intellectual",
  "social",
  "financial",
]);

const FEATURE_DIM = 12; // 6 dim-context + 6 rolling-action-distribution
const DEFAULT_LAMBDA = 1.0; // UCB exploration
const DEFAULT_MU = 0.35; // diversity penalty strength
const DEFAULT_RIDGE = 1.0; // ridge regularizer for A_0 = λI

// ── tiny dense linear algebra (12x12 is fine) ──────────────────────────────

function identity(n, k = 1) {
  const A = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) A[i][i] = k;
  return A;
}
function addOuter(A, x, y) {
  // A += x yᵀ
  const n = A.length;
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    if (xi === 0) continue;
    for (let j = 0; j < n; j++) A[i][j] += xi * y[j];
  }
}
function matVec(A, x) {
  const n = A.length;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += A[i][j] * x[j];
    y[i] = s;
  }
  return y;
}
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
/** Invert via Gauss-Jordan; fine for n=12. */
function invert(A) {
  const n = A.length;
  const M = A.map((r) => Float64Array.from(r));
  const I = identity(n);
  for (let col = 0; col < n; col++) {
    // Pivot
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) {
      throw new Error("singular matrix");
    }
    if (piv !== col) {
      [M[col], M[piv]] = [M[piv], M[col]];
      [I[col], I[piv]] = [I[piv], I[col]];
    }
    const d = M[col][col];
    for (let j = 0; j < n; j++) {
      M[col][j] /= d;
      I[col][j] /= d;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let j = 0; j < n; j++) {
        M[r][j] -= f * M[col][j];
        I[r][j] -= f * I[col][j];
      }
    }
  }
  return I;
}

// ── feature map ────────────────────────────────────────────────────────────

/**
 * φ(x, a) ∈ R^12 = [α_t; π_t]
 * where α_t is the user's dim-profile from the last check-in,
 * and π_t is the rolling 7-day distribution over action-dimension.
 *
 * Arms share the base context; the per-arm estimator θ̂_a absorbs the
 * arm-specific effect, so the feature map does not include arm one-hots.
 */
export function buildFeature({ alpha, pi }) {
  const phi = new Float64Array(FEATURE_DIM);
  for (let i = 0; i < DIMENSIONS.length; i++) {
    phi[i] = alpha?.[DIMENSIONS[i]] ?? 0;
    phi[i + DIMENSIONS.length] = pi?.[DIMENSIONS[i]] ?? 0;
  }
  return phi;
}

// ── arm id and mask ────────────────────────────────────────────────────────

export function armId({ channel, dimension, relationship = null }) {
  return `${channel}|${dimension}|${relationship ?? "none"}`;
}

export function dimensionOf(armId_) {
  return armId_.split("|")[1];
}

// ── the policy ──────────────────────────────────────────────────────────────

/**
 * A per-arm ridge estimator.
 *   A_a = ridgeλI + Σ φ φᵀ
 *   b_a = Σ r φ
 *   θ̂_a = A_a⁻¹ b_a
 */
function freshArm(ridge) {
  return {
    A: identity(FEATURE_DIM, ridge),
    b: new Float64Array(FEATURE_DIM),
  };
}

export class DimensionAwareLinUCB {
  constructor({
    lambda = DEFAULT_LAMBDA,
    mu = DEFAULT_MU,
    ridge = DEFAULT_RIDGE,
  } = {}) {
    this.lambda = lambda;
    this.mu = mu;
    this.ridge = ridge;
    this.arms = new Map(); // armId -> { A, b }
  }

  _arm(id) {
    if (!this.arms.has(id)) this.arms.set(id, freshArm(this.ridge));
    return this.arms.get(id);
  }

  /**
   * Return the chosen arm and scores for every candidate.
   * `candidates`: array of { channel, dimension, relationship? }.
   */
  select({ candidates, context }) {
    if (!candidates?.length) throw new Error("no candidates");
    const phi = buildFeature(context);
    const pi = context.pi || {};

    const scored = candidates.map((cand) => {
      const id = armId(cand);
      const { A, b } = this._arm(id);
      const Ainv = invert(A);
      const theta = matVec(Ainv, b);
      const mean = dot(theta, phi);
      const q = dot(phi, matVec(Ainv, phi));
      const ucb = this.lambda * Math.sqrt(Math.max(q, 0));
      const diversityPenalty = this.mu * (pi[cand.dimension] ?? 0);
      const score = mean + ucb - diversityPenalty;
      return { id, cand, mean, ucb, diversityPenalty, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return { chosen: scored[0], all: scored };
  }

  /**
   * Update the chosen arm with an observed reward from the reward function
   * defined in opportunity.tex Eq. 1. Callers compute r upstream (it depends
   * on post-nudge check-in deltas) and pass it in here.
   */
  update({ chosenId, context, reward }) {
    const phi = buildFeature(context);
    const arm = this._arm(chosenId);
    addOuter(arm.A, phi, phi);
    for (let i = 0; i < FEATURE_DIM; i++) arm.b[i] += reward * phi[i];
  }

  /** JSON snapshot for persistence. */
  snapshot() {
    return {
      lambda: this.lambda,
      mu: this.mu,
      ridge: this.ridge,
      arms: Array.from(this.arms.entries()).map(([id, { A, b }]) => [
        id,
        A.map((r) => Array.from(r)),
        Array.from(b),
      ]),
    };
  }

  static restore(snap) {
    const bandit = new DimensionAwareLinUCB({
      lambda: snap.lambda,
      mu: snap.mu,
      ridge: snap.ridge,
    });
    for (const [id, A, b] of snap.arms) {
      bandit.arms.set(id, {
        A: A.map((r) => Float64Array.from(r)),
        b: Float64Array.from(b),
      });
    }
    return bandit;
  }
}

/**
 * Reward from a post-nudge check-in — Eq. 1 of opportunity.tex.
 *
 *   r = -||u_{t+Δ} - 1/6||² + γ H(π_t) + μ α_tᵀ 1_{d(a)}
 */
export function computeReward({
  postCheckin, // { spiritual: p, emotional: p, ... } summing to ~1
  pi, // rolling 7-day action distribution
  alpha, // last-checkin dimension profile
  chosenDimension,
  gamma = 0.25,
  muAlignment = 0.5,
}) {
  const uniform = 1 / DIMENSIONS.length;
  let sq = 0;
  for (const d of DIMENSIONS) {
    const u = postCheckin?.[d] ?? uniform;
    sq += (u - uniform) ** 2;
  }
  const balance = -sq;
  let H = 0;
  for (const d of DIMENSIONS) {
    const q = pi?.[d] ?? 0;
    if (q > 0) H -= q * Math.log(q);
  }
  const alignment = muAlignment * (alpha?.[chosenDimension] ?? 0);
  return balance + gamma * H + alignment;
}

export default {
  DIMENSIONS,
  DimensionAwareLinUCB,
  buildFeature,
  armId,
  dimensionOf,
  computeReward,
};
