/**
 * gcal/provisioner.js — Six-dimension calendar provisioner.
 *
 * Ensures a Google Calendar exists for each of the six Amber dimensions.
 * Stores resulting calendar IDs back in amber-id as secrets.
 * Idempotent: safe to call repeatedly; skips creation if calendar already exists.
 *
 * Dimension → calendar name mapping:
 *   financial   → "Amber · Financial"
 *   intellectual → "Amber · Intellectual"
 *   social      → "Amber · Social"
 *   spiritual   → "Amber · Spiritual"
 *   emotional   → "Amber · Emotional"
 *   physical    → "Amber · Physical"
 */

import { getSecret } from "../../secrets.js";
import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../../constants.js";
import { listCalendarList, insertCalendar } from "./client.js";

// ── Dimension catalogue ───────────────────────────────────────────────────────

export const DIMENSIONS = [
  "financial",
  "intellectual",
  "social",
  "spiritual",
  "emotional",
  "physical",
];

/** Ambient display name → dimension key */
const CALENDAR_NAMES = {
  financial: "Amber · Financial",
  intellectual: "Amber · Intellectual",
  social: "Amber · Social",
  spiritual: "Amber · Spiritual",
  emotional: "Amber · Emotional",
  physical: "Amber · Physical",
};

/** Secret key in amber-id that stores the calendar ID for a dimension */
export function calSecretKey(dimension) {
  return `GCAL_CAL_${dimension.toUpperCase()}`;
}

// ── Secret write helper ───────────────────────────────────────────────────────

function tenantDid(tenant) {
  if (!tenant) return null;
  if (typeof tenant === "string") return tenant;
  return tenant.privyDid || tenant.amberId || tenant.id || null;
}

async function setSecret(tenant, key, value) {
  const did = tenantDid(tenant);
  if (!did || !AMBER_ID_API_URL || !AMBER_ID_API_KEY) return false;
  try {
    const res = await fetch(
      `${AMBER_ID_API_URL}/v1/secrets/${encodeURIComponent(did)}/${encodeURIComponent(key)}`,
      {
        method: "PUT",
        headers: {
          "x-api-key": AMBER_ID_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value }),
        signal: AbortSignal.timeout(8000),
      },
    );
    return res.ok;
  } catch (err) {
    console.warn(`[gcal/provisioner] setSecret ${key} failed:`, err?.message);
    return false;
  }
}

// ── Calendar ID cache lookup ──────────────────────────────────────────────────

/**
 * Resolve the Google Calendar ID for a dimension.
 * Reads from cached secrets first; falls back to provisioner if not set.
 *
 * Returns null if not connected (no refresh token).
 */
export async function resolveCalendarId(tenant, dimension) {
  const key = calSecretKey(dimension);
  const stored = await getSecret(tenant, key);
  if (stored) return stored;

  // Not provisioned yet — provision and return
  const result = await provisionHealthCalendars(tenant);
  return result?.calendarIds?.[dimension] || null;
}

// ── Core provisioner ─────────────────────────────────────────────────────────

/**
 * Ensure all six dimension calendars exist for the given tenant.
 * Creates any missing calendars and persists their IDs to amber-id secrets.
 *
 * @param {object} tenant  Tenant object (must have privyDid/amberId)
 * @returns {Promise<{ok: boolean, calendarIds: object, created: string[], error?: string}>}
 */
export async function provisionHealthCalendars(tenant) {
  // 1. Verify connectivity (refresh token presence)
  const refreshToken = await getSecret(tenant, "GCAL_OAUTH_REFRESH");
  if (!refreshToken) {
    return {
      ok: false,
      calendarIds: {},
      created: [],
      error: "gcal-not-connected",
    };
  }

  // 2. Read any already-stored calendar IDs from secrets
  const existing = {};
  await Promise.all(
    DIMENSIONS.map(async (dim) => {
      const id = await getSecret(tenant, calSecretKey(dim));
      if (id) existing[dim] = id;
    }),
  );

  const missingDims = DIMENSIONS.filter((d) => !existing[d]);
  if (missingDims.length === 0) {
    // All already provisioned
    return { ok: true, calendarIds: existing, created: [] };
  }

  // 3. Fetch the user's calendar list to find any that already exist by name
  let listRes;
  try {
    listRes = await listCalendarList(tenant);
  } catch (err) {
    // gcalRequest throws calendar_oauth_required when the refresh token
    // is missing or rejected mid-flight (race with our pre-flight check
    // above). Surface as gcal-not-connected so callers see the same
    // shape they've always seen for this provisioner path.
    if (err?.code === "calendar_oauth_required") {
      return {
        ok: false,
        calendarIds: existing,
        created: [],
        error: "gcal-not-connected",
      };
    }
    throw err;
  }
  if (!listRes.ok) {
    if (listRes.error === "gcal-not-connected") {
      return {
        ok: false,
        calendarIds: existing,
        created: [],
        error: "gcal-not-connected",
      };
    }
    return {
      ok: false,
      calendarIds: existing,
      created: [],
      error: `listCalendarList failed: ${listRes.error}`,
    };
  }

  const calendarList = listRes.data?.items || [];

  // Build a lookup of summary → calendarId from existing Google calendars
  const byName = {};
  for (const cal of calendarList) {
    if (cal.summary) byName[cal.summary] = cal.id;
  }

  // 4. For each missing dimension, find-or-create the calendar
  const created = [];
  const calendarIds = { ...existing };

  await Promise.all(
    missingDims.map(async (dim) => {
      const name = CALENDAR_NAMES[dim];
      if (byName[name]) {
        // Calendar already exists on Google — just wasn't in secrets yet
        calendarIds[dim] = byName[name];
      } else {
        // Need to create it
        try {
          const createRes = await insertCalendar(tenant, name);
          if (createRes.ok && createRes.data?.id) {
            calendarIds[dim] = createRes.data.id;
            created.push(dim);
          } else {
            console.warn(
              `[gcal/provisioner] Failed to create calendar "${name}":`,
              createRes.error,
            );
          }
        } catch (err) {
          // Tolerate a mid-flight OAuth failure on a single dimension —
          // we'll still return whatever calendars resolved. Caller sees
          // partial results rather than a hard throw.
          console.warn(
            `[gcal/provisioner] insertCalendar threw for "${name}":`,
            err?.code || err?.message,
          );
        }
      }
    }),
  );

  // 5. Persist all resolved IDs back to amber-id
  await Promise.all(
    DIMENSIONS.filter((d) => calendarIds[d]).map((dim) =>
      setSecret(tenant, calSecretKey(dim), calendarIds[dim]),
    ),
  );

  return { ok: true, calendarIds, created };
}

// ── Calendar color helper ─────────────────────────────────────────────────────
// Google Calendar color IDs (cosmetic, not required for functionality)
const DIMENSION_COLORS = {
  financial: "5", // banana
  intellectual: "9", // blueberry
  social: "6", // sage
  spiritual: "8", // graphite
  emotional: "11", // tomato
  physical: "2", // sage
};

export function dimensionColorId(dimension) {
  return DIMENSION_COLORS[dimension] || "1";
}
