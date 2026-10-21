/**
 * calendar/roles.js — Role → dimension-weight defaults.
 *
 * The six-dimension ontology is load-bearing across the repo (see CLAUDE.md).
 * This module holds the default weighting per `tenant.role`. Tenants can
 * override via `tenant.preferences.calendar.dimensionWeights`.
 *
 * Initial roles, per docs/CALENDAR-FIRST-SAMBER.md §2:
 *   hiring   — protect hiring throughput; weight social + intellectual
 *   selling  — protect selling throughput; weight social + financial
 *   building — protect deep-work blocks; weight intellectual + physical
 *   learning — protect study time; weight intellectual + spiritual
 *
 * No tenant names appear in this file. Camber = hiring and Samber =
 * selling is an amber-id record, not a code constant.
 */

export const DIMENSIONS = Object.freeze([
  "financial",
  "intellectual",
  "social",
  "spiritual",
  "emotional",
  "physical",
]);

export const DEFAULT_DIMENSION_WEIGHTS = Object.freeze({
  financial: 1 / 6,
  intellectual: 1 / 6,
  social: 1 / 6,
  spiritual: 1 / 6,
  emotional: 1 / 6,
  physical: 1 / 6,
});

/**
 * Concrete role-keyed weight tables. Each table sums to 1.
 */
export const ROLE_WEIGHTS = Object.freeze({
  hiring: Object.freeze({
    financial: 0.10,
    intellectual: 0.25,
    social: 0.30,
    spiritual: 0.10,
    emotional: 0.10,
    physical: 0.15,
  }),
  selling: Object.freeze({
    financial: 0.30,
    intellectual: 0.10,
    social: 0.30,
    spiritual: 0.05,
    emotional: 0.10,
    physical: 0.15,
  }),
  building: Object.freeze({
    financial: 0.10,
    intellectual: 0.35,
    social: 0.10,
    spiritual: 0.10,
    emotional: 0.10,
    physical: 0.25,
  }),
  learning: Object.freeze({
    financial: 0.05,
    intellectual: 0.40,
    social: 0.10,
    spiritual: 0.20,
    emotional: 0.10,
    physical: 0.15,
  }),
});

/**
 * Sum of weights across all dimensions, for sanity-checks in tests.
 */
export function weightSum(weights) {
  return DIMENSIONS.reduce((acc, d) => acc + (Number(weights?.[d]) || 0), 0);
}
