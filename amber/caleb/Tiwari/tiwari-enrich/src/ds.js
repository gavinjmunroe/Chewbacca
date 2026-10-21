/**
 * ds.js — Dempster-Shafer evidence combination over the six dimensions.
 *
 * Formalism: Tiwari/papers/enrich.tex
 *
 *   Frame Θ = {spi, emo, phy, int, soc, fin}
 *   A Basic Probability Assignment (BPA) is a Map<subsetKey, mass>.
 *   We encode subsets as sorted-CSV of dimension codes, e.g. "emo,spi",
 *   with the special key "*" for the full frame Θ.
 *
 * The scale is small (|Θ| = 6, so 2^6 = 64 possible focal elements) so
 * the rule of combination is O(n^2) per fuse and we don't need FFT tricks.
 */

export const DIMENSIONS = Object.freeze([
  "spiritual",
  "emotional",
  "physical",
  "intellectual",
  "social",
  "financial",
]);

const DIM_CODE = Object.freeze({
  spiritual: "spi",
  emotional: "emo",
  physical: "phy",
  intellectual: "int",
  social: "soc",
  financial: "fin",
});
const CODE_DIM = Object.freeze(
  Object.fromEntries(Object.entries(DIM_CODE).map(([k, v]) => [v, k]))
);
const FRAME_KEY = "*";

/** Canonical subset key: sorted unique dim codes separated by commas, or "*". */
export function subsetKey(dims) {
  if (!dims || dims === FRAME_KEY) return FRAME_KEY;
  const arr = Array.isArray(dims) ? dims : [dims];
  const codes = [];
  for (const d of arr) {
    const code = CODE_DIM[d] ? d : CODE_DIM[d] || DIM_CODE[d];
    const norm = DIM_CODE[d] || (CODE_DIM[d] ? d : null);
    if (!norm) continue;
    if (!codes.includes(norm)) codes.push(norm);
  }
  if (codes.length === 0) return FRAME_KEY;
  if (codes.length === DIMENSIONS.length) return FRAME_KEY;
  return codes.sort().join(",");
}

function codesOf(key) {
  if (key === FRAME_KEY) return new Set(Object.values(DIM_CODE));
  return new Set(key.split(","));
}

function intersectKey(a, b) {
  if (a === FRAME_KEY) return b;
  if (b === FRAME_KEY) return a;
  const A = codesOf(a);
  const B = codesOf(b);
  const c = [];
  for (const x of A) if (B.has(x)) c.push(x);
  if (c.length === 0) return null;
  if (c.length === Object.keys(DIM_CODE).length) return FRAME_KEY;
  return c.sort().join(",");
}

/**
 * Build a BPA from a single record:
 *   m({d}) = trust * relevance,   m(Θ) = 1 - trust * relevance
 * For cross-dimensional records (healthDimension === "*"), all mass
 * goes to Θ.
 */
export function recordToBPA({ healthDimension, relevance, trust }) {
  const m = new Map();
  if (!healthDimension || healthDimension === "*") {
    m.set(FRAME_KEY, 1.0);
    return m;
  }
  const q = Math.max(0, Math.min(1, Number(relevance) || 0));
  const t = Math.max(0, Math.min(1, Number(trust) || 0));
  const mass = q * t;
  const key = subsetKey([healthDimension]);
  if (mass <= 0) {
    m.set(FRAME_KEY, 1.0);
    return m;
  }
  m.set(key, mass);
  m.set(FRAME_KEY, 1 - mass);
  return m;
}

/** Shafer's discounting: m'(A≠Θ) = τ m(A); m'(Θ) = 1 - τ(1 - m(Θ)). */
export function discount(bpa, tau) {
  const t = Math.max(0, Math.min(1, Number(tau) || 0));
  const out = new Map();
  let residualToFrame = 0;
  for (const [k, v] of bpa) {
    if (k === FRAME_KEY) continue;
    const nv = t * v;
    out.set(k, nv);
    residualToFrame += v - nv;
  }
  const frame = bpa.get(FRAME_KEY) || 0;
  out.set(FRAME_KEY, frame + residualToFrame);
  return out;
}

/** Dempster's rule of combination: (m1 ⊕ m2)(A) = Σ_{B∩C=A} m1(B)m2(C) / (1-K). */
export function combine(m1, m2) {
  let K = 0;
  const agg = new Map();
  for (const [kb, vb] of m1) {
    if (vb === 0) continue;
    for (const [kc, vc] of m2) {
      if (vc === 0) continue;
      const inter = intersectKey(kb, kc);
      const prod = vb * vc;
      if (inter === null) {
        K += prod;
      } else {
        agg.set(inter, (agg.get(inter) || 0) + prod);
      }
    }
  }
  if (K >= 1 - 1e-12) {
    // Total conflict: return the frame as pure ignorance; upstream should warn.
    const fallback = new Map();
    fallback.set(FRAME_KEY, 1);
    return { bpa: fallback, conflict: 1 };
  }
  const scale = 1 / (1 - K);
  const out = new Map();
  for (const [k, v] of agg) out.set(k, v * scale);
  return { bpa: out, conflict: K };
}

/** Combine any number of BPAs left-to-right. */
export function combineMany(bpas) {
  if (bpas.length === 0) {
    const empty = new Map();
    empty.set(FRAME_KEY, 1);
    return { bpa: empty, conflict: 0 };
  }
  let cur = bpas[0];
  let totalK = 0;
  for (let i = 1; i < bpas.length; i++) {
    const { bpa, conflict } = combine(cur, bpas[i]);
    cur = bpa;
    totalK = 1 - (1 - totalK) * (1 - conflict); // 1 - Π(1-K_i)
  }
  return { bpa: cur, conflict: totalK };
}

/** Bel(d) = sum of mass on subsets ⊆ {d} — i.e. the singleton itself. */
export function belief(bpa, dim) {
  const key = subsetKey([dim]);
  return bpa.get(key) || 0;
}

/** Pl(d) = sum of mass on subsets that intersect {d}. */
export function plausibility(bpa, dim) {
  const code = DIM_CODE[dim];
  if (!code) return 0;
  let s = 0;
  for (const [k, v] of bpa) {
    if (k === FRAME_KEY || codesOf(k).has(code)) s += v;
  }
  return s;
}

/** Pignistic (BetP): uniformly distribute subset mass across its members. */
export function pignistic(bpa) {
  const out = Object.fromEntries(DIMENSIONS.map((d) => [d, 0]));
  for (const [k, v] of bpa) {
    const codes = k === FRAME_KEY ? Object.values(DIM_CODE) : [...codesOf(k)];
    if (codes.length === 0) continue;
    const share = v / codes.length;
    for (const c of codes) out[CODE_DIM[c]] += share;
  }
  return out;
}

/** Convenience: build per-dimension {bel, pl} from an iterable of BPAs. */
export function beliefPlausibilityPerDim(bpa) {
  return Object.fromEntries(
    DIMENSIONS.map((d) => [d, { bel: belief(bpa, d), pl: plausibility(bpa, d) }])
  );
}

export default {
  DIMENSIONS,
  subsetKey,
  recordToBPA,
  discount,
  combine,
  combineMany,
  belief,
  plausibility,
  pignistic,
  beliefPlausibilityPerDim,
};
