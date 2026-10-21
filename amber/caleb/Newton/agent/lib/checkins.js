/**
 * Per-tenant health check-in scheduler.
 *
 * Reads tenant.checkInSchedule (see checkin-schedule.js for shape). Each
 * tenant carries their own windows, timezone, wake-alarm anchor, and
 * dimensions. The legacy hardcoded 07:00 / 21:00 PT windows now live only
 * as a fallback for the `_isFallback` startup tenant, so the agent can
 * still tick before medha-id is reachable on cold boot.
 *
 * Three named windows: morning, nightly, sunday.
 *   morning fires `morning.offsetMinutes` after `wakeAlarmTime`
 *   nightly fires `nightly.offsetMinutes` from the configured anchor
 *           (anchor: "wake_alarm" means relative to wakeAlarmTime; a
 *           negative offset puts the check-in in the previous evening —
 *           e.g. -485 = 8h05 before wake)
 *   sunday  fires at `sunday.time` on Sundays only
 *
 * The reply parser filters captured scores down to the dimensions the
 * firing window asked about, so a "physical 7 spiritual 8" reply to a
 * morning-emotional check-in only records emotional.
 *
 * Defense-in-depth: AMBER_CHECKIN_ALLOWLIST (Tab 1) gates which phones
 * are ever messaged regardless of per-tenant settings.
 */

import { sendMessage } from "./transport.js";
import { parseCheckinReply, saveHealthCheckin } from "./health.js";
import { ingestCheckin } from "./amber-id-ingest.js";
import { CALEB_PHONE } from "./constants.js";
import { getOwnerFirstName, getAgentName } from "./tenant.js";
import { isCheckinSchedulerEnabled } from "./proactive-prefs.js";
import { humanize } from "./voice-guard.js";
import {
  resolveSchedule,
  shouldFireNow,
  localPartsAt,
} from "./checkin-schedule.js";

// Belt-and-suspenders kill switch. Even when the per-tenant gate or env
// override says check-ins are enabled, this allowlist (if non-empty) limits
// scheduled outbound to the listed E.164 phones. Empty allowlist means "no
// allowlist restriction" — the regular gates govern. Set via Railway env
// AMBER_CHECKIN_ALLOWLIST=+1...,+1... (comma-separated).
const CHECKIN_ALLOWLIST = (process.env.AMBER_CHECKIN_ALLOWLIST || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function isAllowlisted(phone) {
  if (CHECKIN_ALLOWLIST.length === 0) return true;
  return CHECKIN_ALLOWLIST.includes(phone);
}

// ── Fallback schedule for the startup `_isFallback` tenant ───────────────

const LEGACY_FALLBACK_SCHEDULE = {
  enabled: true,
  timezone: "America/Los_Angeles",
  wakeAlarmTime: "07:00",
  morning: {
    enabled: true,
    offsetMinutes: 0,
    dimensions: ["physical", "emotional"],
  },
  // 21:00 local on the same day = 14 hours after a 07:00 wake.
  nightly: {
    enabled: true,
    anchor: "wake_alarm",
    offsetMinutes: 14 * 60,
    dimensions: ["physical", "emotional"],
  },
  sunday: { enabled: true, time: "19:00", dimensions: ["spiritual"] },
  context: ["environment", "people"],
  format: "plain_text",
};

// ── Per-tenant sent-state guard ──────────────────────────────────────────

const sentGuard = new Set();

function guardKey(phone, windowName, local) {
  if (windowName === "sunday") {
    // sunday only fires on Sundays, so the date key already dedupes per week.
    return `${phone}:${windowName}:${local.dateKey}`;
  }
  return `${phone}:${windowName}:${local.dateKey}`;
}

// ── Pending check-in state (awaiting reply) ─────────────────────────────

// phone -> { type, dimensions, context, sentAt }
const pendingCheckins = new Map();

export function getPendingCheckin(phone) {
  const entry = pendingCheckins.get(phone);
  if (!entry) return null;
  if (Date.now() - entry.sentAt > 2 * 60 * 60 * 1000) {
    pendingCheckins.delete(phone);
    return null;
  }
  return entry;
}

export function clearPendingCheckin(phone) {
  pendingCheckins.delete(phone);
}

/**
 * Called from the main message handler when the owner sends a reply.
 * Returns true if the message was consumed as a check-in response.
 */
export async function maybeHandleCheckinReply(phone, text, tenant) {
  const pending = getPendingCheckin(phone);
  if (!pending) return false;

  const scores = parseCheckinReply(text);
  if (!scores) return false;

  const allowed =
    Array.isArray(pending.dimensions) && pending.dimensions.length > 0
      ? pending.dimensions
      : ["physical", "emotional", "spiritual"];

  const filtered = {};
  for (const dim of allowed) {
    if (scores[dim] !== undefined) filtered[dim] = scores[dim];
  }
  if (Object.keys(filtered).length === 0) return false;

  clearPendingCheckin(phone);

  await saveHealthCheckin(
    phone,
    filtered,
    "self_report",
    text,
    null,
    tenant,
  ).catch((e) => console.warn("[checkin] saveHealthCheckin error:", e.message));

  ingestCheckin(phone, filtered, text, pending.type, tenant).catch((e) =>
    console.warn("[checkin] ingestCheckin error:", e.message),
  );

  console.log(`[checkin] ${pending.type} reply saved for ${phone}:`, filtered);
  return true;
}

// ── Prompt builder (dimension-driven) ────────────────────────────────────

function joinDims(dims) {
  if (dims.length === 1) return dims[0];
  if (dims.length === 2) return `${dims[0]} and ${dims[1]}`;
  return dims.slice(0, -1).join(", ") + ", and " + dims[dims.length - 1];
}

export function buildPrompt(windowName, dimensions, name) {
  const dimsLabel = joinDims(dimensions);
  const example = dimensions.map((d) => `${d} 7`).join(" ");
  const greeting =
    windowName === "morning"
      ? `Morning${name ? `, ${name}` : ""}.`
      : windowName === "sunday"
        ? `Sunday check-in${name ? `, ${name}` : ""}.`
        : `How'd the day land${name ? `, ${name}` : ""}?`;
  return humanize(
    `${greeting} Quick one: ${dimsLabel}, 0-10. Reply like "${example}" when you have a second.`,
  );
}

// ── Main scheduler ───────────────────────────────────────────────────────

/**
 * One tick for a single tenant. Exported for tests.
 *
 * `deps.send` is an injection seam for tests; production calls go through
 * the real `sendMessage` import.
 */
export async function tickForTenant(tenant, now = new Date(), deps = {}) {
  const send = deps.send || sendMessage;
  const phone = tenant?.phoneNumber || CALEB_PHONE;
  if (!phone) return;

  // Allowlist short-circuit (Tab 1). Empty list = open (existing behavior).
  if (!isAllowlisted(phone)) return;

  // Per-tenant / env-level kill switch.
  if (!isCheckinSchedulerEnabled(tenant)) return;

  // tenant.displayName is the AGENT name (Camber/Samber). The human owner's
  // first name comes from getOwnerFirstName — phone-mapped (Caleb/Sagar).

  let schedule = resolveSchedule(tenant);
  if (!schedule) {
    if (tenant?._isFallback) schedule = LEGACY_FALLBACK_SCHEDULE;
    else return;
  }
  if (!schedule.enabled) return;

  const name = getOwnerFirstName(tenant);
  const agentName = getAgentName(tenant);
  const ownerLabel = name || phone;
  const local = localPartsAt(now, schedule.timezone || "America/Los_Angeles");

  for (const windowName of ["morning", "nightly", "sunday"]) {
    const w = schedule[windowName];
    if (!w?.enabled) continue;
    if (!shouldFireNow(windowName, schedule, now)) continue;

    const dims = Array.isArray(w.dimensions) ? w.dimensions : [];
    if (dims.length === 0) continue;

    const key = guardKey(phone, windowName, local);
    if (sentGuard.has(key)) continue;
    sentGuard.add(key);

    try {
      // PR-I outbound audit: scheduled check-ins target the tenant owner.
      await send(phone, buildPrompt(windowName, dims, name), {
        tenant,
        auditOrigin: "scheduled",
      });
      pendingCheckins.set(phone, {
        type: windowName,
        dimensions: dims,
        context: Array.isArray(schedule.context) ? schedule.context : [],
        sentAt: Date.now(),
      });
      console.log(
        `[checkin] ${windowName} (${dims.join("+")}) sent from ${agentName} to ${ownerLabel}`,
      );
    } catch (e) {
      sentGuard.delete(key);
      console.warn(`[checkin] ${windowName} send failed:`, e.message);
    }
    return; // at most one window per tick per tenant
  }
}

/**
 * Reset all in-memory state. Test helper.
 */
export function _resetCheckinState() {
  sentGuard.clear();
  pendingCheckins.clear();
}

/**
 * Start the check-in scheduler. Ticks every 60 s.
 *
 * @param {Function} getActiveTenants - () => Tenant[] — live tenant list
 * @returns {() => void} stop
 */
export function startCheckinScheduler(getActiveTenants) {
  const tick = async () => {
    const tenants = await Promise.resolve(getActiveTenants()).catch(() => []);
    for (const tenant of tenants) {
      await tickForTenant(tenant).catch((e) =>
        console.warn("[checkin] tick error:", e.message),
      );
    }
  };

  const interval = setInterval(tick, 60_000);
  if (interval.unref) interval.unref();

  console.log(
    "[checkin] Scheduler started (per-tenant checkInSchedule; default OFF)",
  );
  return () => clearInterval(interval);
}
