/**
 * calendar/profile.js — Per-tenant calendar policy profile.
 *
 * The profile is a small bundle of preferences + a priority weighting over
 * the six dimensions. It is loaded from the resolved tenant record and
 * tunes the shared calendar engine. It is NOT a code branch.
 *
 * See docs/CALENDAR-FIRST-SAMBER.md §2 and §9 for the contract.
 *
 * Today there are no hard-coded tenant names in this file. `tenant.role`
 * is the only personalization input recognized at this layer; the initial
 * production assignment (Camber = `hiring`, Samber = `selling`) lives in
 * amber-id, not here.
 */

import { DEFAULT_DIMENSION_WEIGHTS, DIMENSIONS, ROLE_WEIGHTS } from "./roles.js";

export { DEFAULT_DIMENSION_WEIGHTS, DIMENSIONS, ROLE_WEIGHTS };

const DEFAULTS = Object.freeze({
  role: null,
  timezone: "America/Los_Angeles",
  workingHours: { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] },
  defaultDurationMinutes: 30,
  defaultLocation: null,
  defaultSubCalendar: "intellectual",
  weekStart: "monday",
  quietHours: { start: "22:00", end: "07:00" },
  defaultAttendees: [],
  invitePolicy: "ask",
});

/**
 * Load a calendar policy profile from a resolved tenant object.
 *
 * @param {object} tenant - tenant returned by `lib/tenant.js`
 * @returns {{
 *   role: string|null,
 *   timezone: string,
 *   workingHours: object,
 *   defaultDurationMinutes: number,
 *   defaultLocation: string|null,
 *   defaultSubCalendar: string,
 *   weekStart: string,
 *   quietHours: object,
 *   defaultAttendees: string[],
 *   invitePolicy: string,
 *   dimensionWeights: Record<string, number>,
 * }}
 */
export function loadCalendarProfile(tenant) {
  const prefs = tenant?.preferences?.calendar ?? {};
  const role = normalizeRole(tenant?.role ?? prefs.role ?? null);
  const weights = normalizeWeights(prefs.dimensionWeights, role);

  return {
    role,
    timezone: prefs.timezone ?? DEFAULTS.timezone,
    workingHours: prefs.workingHours ?? DEFAULTS.workingHours,
    defaultDurationMinutes: prefs.defaultDurationMinutes ?? DEFAULTS.defaultDurationMinutes,
    defaultLocation: prefs.defaultLocation ?? DEFAULTS.defaultLocation,
    defaultSubCalendar: prefs.defaultSubCalendar ?? DEFAULTS.defaultSubCalendar,
    weekStart: prefs.weekStart ?? DEFAULTS.weekStart,
    quietHours: prefs.quietHours ?? DEFAULTS.quietHours,
    defaultAttendees: prefs.defaultAttendees ?? DEFAULTS.defaultAttendees,
    invitePolicy: prefs.invitePolicy ?? DEFAULTS.invitePolicy,
    dimensionWeights: weights,
  };
}

function normalizeRole(role) {
  if (!role) return null;
  const r = String(role).toLowerCase().trim();
  return ROLE_WEIGHTS[r] ? r : null;
}

function normalizeWeights(weights, role) {
  if (weights && typeof weights === "object") {
    const fromOverride = {};
    let sum = 0;
    for (const dim of DIMENSIONS) {
      const v = Number(weights[dim]);
      fromOverride[dim] = Number.isFinite(v) && v >= 0 ? v : 0;
      sum += fromOverride[dim];
    }
    if (sum > 0) {
      for (const dim of DIMENSIONS) fromOverride[dim] = fromOverride[dim] / sum;
      return fromOverride;
    }
  }
  if (role && ROLE_WEIGHTS[role]) return { ...ROLE_WEIGHTS[role] };
  return { ...DEFAULT_DIMENSION_WEIGHTS };
}
