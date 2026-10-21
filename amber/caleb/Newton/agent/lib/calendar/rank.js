/**
 * calendar/rank.js — Slot-ranker.
 *
 * One ranker, two tenants. Given the same slate of legal slots, two tenants
 * with different `tenant.role` weights should produce different orderings;
 * with flattened weights they converge to identical ordering.
 *
 * This is the ONLY place where the policy profile reaches into scheduling
 * logic. Every other module is preferences-as-defaults.
 *
 * Slot shape:
 *   { start: ISO, end: ISO, dimension: oneOfSix, attendeeDimensions?: oneOfSix[] }
 *
 * Score:
 *   weight[slot.dimension]
 *   + 0.5 * sum(weight[attendeeDimension]) / attendees.length   (capped at +0.5)
 *
 * Stable sort: ties break by slot.start ascending.
 */

import { DIMENSIONS } from "./roles.js";

/**
 * Rank a slate of slots by a tenant's dimension weights.
 *
 * @param {Array<object>} slots
 * @param {Record<string, number>} weights
 * @returns {Array<object>} same slots, sorted by descending score (stable).
 */
export function rankSlots(slots, weights) {
  if (!Array.isArray(slots) || slots.length === 0) return [];
  const w = normalize(weights);
  const scored = slots.map((slot, idx) => ({
    slot,
    idx,
    score: scoreSlot(slot, w),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.slot.start && b.slot.start && a.slot.start !== b.slot.start) {
      return a.slot.start < b.slot.start ? -1 : 1;
    }
    return a.idx - b.idx;
  });
  return scored.map((s) => s.slot);
}

function scoreSlot(slot, weights) {
  const dim = slot?.dimension;
  let score = DIMENSIONS.includes(dim) ? weights[dim] ?? 0 : 0;
  const attendeeDims = Array.isArray(slot?.attendeeDimensions)
    ? slot.attendeeDimensions
    : [];
  if (attendeeDims.length > 0) {
    const sum = attendeeDims.reduce(
      (acc, d) => acc + (DIMENSIONS.includes(d) ? weights[d] ?? 0 : 0),
      0,
    );
    const bonus = Math.min(0.5, 0.5 * (sum / attendeeDims.length));
    score += bonus;
  }
  return score;
}

function normalize(weights) {
  const out = {};
  let sum = 0;
  for (const d of DIMENSIONS) {
    const v = Number(weights?.[d]);
    out[d] = Number.isFinite(v) && v >= 0 ? v : 0;
    sum += out[d];
  }
  if (sum <= 0) {
    for (const d of DIMENSIONS) out[d] = 1 / DIMENSIONS.length;
    return out;
  }
  for (const d of DIMENSIONS) out[d] = out[d] / sum;
  return out;
}
