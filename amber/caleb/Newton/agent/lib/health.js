/**
 * 6 Dimensions of Health: the core framework through which Amber sees every person.
 * Masculine: Social, Financial, Intellectual
 * Feminine: Spiritual, Physical, Emotional
 *
 * Contains: health profile CRUD, check-in scheduling, signal inference,
 * daily check-in prompts, and health-aware response calibration.
 */

import {
  HEALTH_DIMS,
  HEALTH_DIM_DESCRIPTIONS,
  PERPLEXITY_API_KEY,
  CALEB_PHONE,
  AMBER_ID_API_URL,
  AMBER_ID_API_KEY,
} from "./constants.js";
import { sbGet, sbUpsert, sbQuery } from "./data.js";
import { ingestCheckin, ingestInferredSignal } from "./amber-id-ingest.js";

function storageAvailable() {
  return !!(AMBER_ID_API_URL && AMBER_ID_API_KEY);
}
import { sendMessage } from "./transport.js";
import { normalizeHandle } from "./permissions.js";
import { callPerplexityLight } from "./tiwari/context.js";

// Re-export for convenience
export { HEALTH_DIMS, HEALTH_DIM_DESCRIPTIONS };

/**
 * Health-aware response calibration: given a profile, return guidance for the AI.
 */
export function healthResponseGuidance(profile) {
  if (!profile) return "";
  const parts = [];
  const dims = HEALTH_DIMS.filter(
    (d) => profile[d] !== null && profile[d] !== undefined,
  );
  if (dims.length === 0) return "";

  // Find dimensions that need attention (below 4) and thriving (above 7)
  const struggling = dims.filter((d) => profile[d] < 4);
  const thriving = dims.filter((d) => profile[d] > 7);

  if (struggling.length > 0) {
    parts.push(
      `This person is struggling in: ${struggling.map((d) => `${d} (${profile[d]}/10)`).join(", ")}. Be extra gentle here. Don't push. Listen more. Validate before solving.`,
    );
  }
  if (thriving.length > 0) {
    parts.push(
      `Thriving in: ${thriving.map((d) => `${d} (${profile[d]}/10)`).join(", ")}. Celebrate this. Draw energy from their strengths.`,
    );
  }
  if (profile.lowest_dimension) {
    const lowestScore = profile[profile.lowest_dimension];
    if (lowestScore !== null && lowestScore < 5) {
      parts.push(
        `Their weakest area is ${profile.lowest_dimension} (${lowestScore}/10). This is where they need the most care. Don't bring it up directly unless they do, but calibrate your tone.`,
      );
    }
  }
  return parts.join("\n");
}

/**
 * Build the health lens block that goes into every system prompt.
 */
export function buildHealthLensBlock() {
  return `
THE 6 DIMENSIONS OF HEALTH (this is your core framework, know it cold):
Masculine: Social, Financial, Intellectual
Feminine: Spiritual, Physical, Emotional
Each scored 0-10. These are the ONLY 6. Never guess other dimensions. Never add "mental", "environmental", or anything else.

HOW TO USE THE HEALTH LENS:
- Every person you talk to has a health profile across these 6 dimensions
- When someone mentions their job, that's a financial signal
- When someone mentions friends or loneliness, that's social
- When someone talks about God, prayer, or purpose, that's spiritual
- When someone mentions sleep, exercise, or energy, that's physical
- When someone expresses frustration, joy, anxiety, or peace, that's emotional
- When someone talks about learning, reading, or ideas, that's intellectual
- You don't announce you're tracking this. You just listen, calibrate, and respond with the right energy.
- If someone is struggling in one dimension, you lean into warmth for that area without making it clinical.`;
}

/**
 * Load a contact's health profile from Supabase.
 */
export async function loadHealthProfile(handle, tenant = null) {
  const norm = normalizeHandle(handle);
  if (!storageAvailable()) return null;
  try {
    return await sbGet(
      "health_profiles",
      `handle=eq.${encodeURIComponent(norm)}`,
      tenant,
    );
  } catch {
    return null;
  }
}

/**
 * Helper: get ISO date string for N days ago.
 */
export function getPastDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

/**
 * Save a health check-in and recalculate the rolling profile.
 */
export async function saveHealthCheckin(
  handle,
  scores,
  source = "inferred",
  rawMessage = null,
  notes = null,
  tenant = null,
) {
  const norm = normalizeHandle(handle);
  if (!storageAvailable()) return;
  try {
    // Upsert the check-in for today
    const checkinRow = {
      handle: norm,
      checkin_date: new Date().toISOString().split("T")[0],
      source,
      ...(rawMessage && { raw_message: rawMessage.slice(0, 500) }),
      ...(notes && { notes }),
    };
    HEALTH_DIMS.forEach((dim) => {
      if (scores[dim] !== undefined && scores[dim] !== null) {
        checkinRow[dim] = scores[dim];
      }
    });
    await sbUpsert("health_checkins", checkinRow, tenant);

    // Recalculate the rolling 7-day average. sbQuery routes through amber-id
    // when configured, which handles the gte date filter on the jsonb column.
    const rows = await sbQuery(
      "health_checkins",
      `handle=eq.${encodeURIComponent(norm)}&checkin_date=gte.${getPastDate(7)}`,
      { order: "checkin_date.desc", tenant },
    );

    if (!rows.length) return;
    const avg = {};
    HEALTH_DIMS.forEach((dim) => {
      const vals = rows.map((r) => r[dim]).filter((v) => v !== null);
      avg[dim] = vals.length
        ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
        : null;
    });
    const defined = HEALTH_DIMS.filter((d) => avg[d] !== null);
    const overall = defined.length
      ? Math.round(
          (defined.reduce((a, d) => a + avg[d], 0) / defined.length) * 10,
        ) / 10
      : null;
    const lowest = defined.length
      ? defined.reduce((a, d) => (avg[d] < avg[a] ? d : a))
      : null;
    const highest = defined.length
      ? defined.reduce((a, d) => (avg[d] > avg[a] ? d : a))
      : null;
    const latestDate = rows[0]?.checkin_date || null;
    const totalCheckins = new Set(rows.map((r) => r.checkin_date)).size;

    await sbUpsert(
      "health_profiles",
      {
        handle: norm,
        ...avg,
        overall_score: overall,
        lowest_dimension: lowest,
        highest_dimension: highest,
        last_checkin_date: latestDate,
        total_checkins: totalCheckins,
      },
      tenant,
    );

    // Push to amber-id Pinecone. Fire-and-forget — never block the caller.
    // Only ingest for the tenant owner (norm === owner phone) since
    // saveHealthCheckin is also called for contacts via inferHealthSignals.
    const ownerPhone = tenant?.phoneNumber || CALEB_PHONE;
    if (norm === normalizeHandle(ownerPhone) && source === "self_report") {
      const checkinType = rawMessage?.includes("spiritual")
        ? "spiritual_weekly"
        : "daily";
      ingestCheckin(ownerPhone, scores, rawMessage, checkinType, tenant).catch(
        () => {},
      );
    }
  } catch (err) {
    console.error("[saveHealthCheckin] error:", err.message);
  }
}

/**
 * Infer health signals from a message using Haiku. Runs in background, no UX cost.
 */
export async function inferHealthSignals(
  handle,
  message,
  reply,
  tenant = null,
) {
  if (!PERPLEXITY_API_KEY || !storageAvailable()) return null;
  const norm = normalizeHandle(handle);
  // Rate limit: max once per 15 minutes per contact
  const lastInferred = inferHealthSignals._lastRun?.get(norm) || 0;
  if (Date.now() - lastInferred < 15 * 60 * 1000) return null;
  if (!inferHealthSignals._lastRun) inferHealthSignals._lastRun = new Map();
  inferHealthSignals._lastRun.set(norm, Date.now());

  const dimDescriptions = HEALTH_DIMS.map(
    (d) => `${d}: ${HEALTH_DIM_DESCRIPTIONS[d]}`,
  ).join("\n");

  try {
    const raw = await callPerplexityLight(
      `Their message: "${message.slice(0, 400)}"\nAmber replied: "${(reply || "").slice(0, 200)}"`,
      {
        maxTokens: 300,
        timeoutMs: 15_000,
        system: `You are a health dimension analyst. You read iMessage conversations and extract signals across 6 dimensions of health. Each dimension is scored 0-10 (10 = thriving).

THE 6 DIMENSIONS:
${dimDescriptions}

Return a JSON object with:
- "scores": { dimension: score } only for dimensions with clear signals. Omit uncertain ones.
- "confidence": 0.0-1.0. 0.9+ = explicit statement. 0.6-0.8 = strong implication. Below 0.6 = don't include.
- "signal": one sentence describing what you picked up
- "urgent": true if any dimension appears critically low (2 or below)

Return {"scores": {}, "confidence": 0, "signal": "", "urgent": false} if nothing is clear.

Examples:
"i've been so lonely lately, nobody texts me back" -> {"scores": {"social": 2}, "confidence": 0.9, "signal": "expressing loneliness and social rejection", "urgent": true}
"just got promoted and my team celebrated!" -> {"scores": {"financial": 8, "social": 8, "emotional": 8}, "confidence": 0.85, "signal": "career win with social celebration", "urgent": false}
"haven't slept in 3 days" -> {"scores": {"physical": 2, "emotional": 3}, "confidence": 0.9, "signal": "severe sleep deprivation affecting mood", "urgent": true}
"feeling really disconnected from God" -> {"scores": {"spiritual": 3}, "confidence": 0.9, "signal": "spiritual disconnection", "urgent": false}
"lol ok" -> {"scores": {}, "confidence": 0, "signal": "", "urgent": false}`,
      },
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const scores = parsed.scores || {};
    const confidence = parsed.confidence || 0;

    if (Object.keys(scores).length > 0 && confidence >= 0.6) {
      await saveHealthCheckin(
        handle,
        scores,
        "inferred",
        message,
        parsed.signal || null,
        tenant,
      );

      // Push inferred signal to amber-id Pinecone (background, trust=0.65)
      ingestInferredSignal(
        normalizeHandle(handle),
        parsed.signal || "inferred health signal",
        scores,
        tenant,
      ).catch(() => {});

      console.log(
        `[health] ${norm}: ${parsed.signal} (conf: ${confidence}${parsed.urgent ? ", URGENT" : ""})`,
      );

      // Urgent health alert: notify tenant owner when someone is in a bad place
      const ownerPhone = tenant?.phoneNumber || CALEB_PHONE;
      if (parsed.urgent && norm !== normalizeHandle(ownerPhone)) {
        const displayName = norm;
        sendMessage(
          ownerPhone,
          `[Health Alert] ${displayName} may need attention. Signal: ${parsed.signal}. Scores: ${Object.entries(
            scores,
          )
            .map(([d, s]) => `${d} ${s}/10`)
            .join(", ")}`,
          { tenant, auditOrigin: "scheduled" },
        ).catch(() => {});
      }
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the daily check-in prompt for Caleb.
 */
export function buildDailyCheckinPrompt(profile) {
  const dims = HEALTH_DIMS;
  const scores = profile
    ? dims
        .map(
          (d) =>
            `${d}: ${profile[d] !== null ? profile[d] + "/10" : "no data"}`,
        )
        .join(", ")
    : "no prior data";
  return `Time for your daily 6-dimension check-in.\n\nYour last scores: ${scores}\n\nRate each 0-10 right now:\n- *Social* (connections, relationships, community)\n- *Financial* (stability, momentum, abundance)\n- *Intellectual* (learning, growth, stimulation)\n- *Spiritual* (faith, purpose, alignment)\n- *Physical* (energy, sleep, movement)\n- *Emotional* (mood, regulation, peace)\n\nJust send the numbers like: "social 7 financial 6 intellectual 8 spiritual 9 physical 5 emotional 7"`;
}

/**
 * Parse a structured check-in reply like "social 7 financial 6 ..."
 */
export function parseCheckinReply(text) {
  const scores = {};
  const pattern =
    /(social|financial|intellectual|spiritual|physical|emotional)[:\s]+(\d+(?:\.\d+)?)/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const dim = match[1].toLowerCase();
    const val = parseFloat(match[2]);
    if (val >= 0 && val <= 10) scores[dim] = val;
  }
  return Object.keys(scores).length > 0 ? scores : null;
}

/**
 * Daily health check-in scheduler. Sends the tenant owner a prompt at optimal time.
 */
let lastCheckinSentDate = ""; // track date to send max once per day

// Duplicate of the AMBER_CHECKIN_ALLOWLIST gate in checkins.js. checkins.js
// already imports from this file, so re-importing would be circular. Deduping
// to a shared module is a follow-up; today the two copies stay in sync via
// the same env var name and parsing rules.
const HEALTH_CHECKIN_ALLOWLIST = (process.env.AMBER_CHECKIN_ALLOWLIST || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isHealthAllowlisted(phone) {
  if (HEALTH_CHECKIN_ALLOWLIST.length === 0) return true;
  return HEALTH_CHECKIN_ALLOWLIST.includes(phone);
}

export async function maybeSendDailyCheckin(tenant = null) {
  const ownerPhone = tenant?.phoneNumber || CALEB_PHONE;

  // Allowlist short-circuit. Mirrors the gate in lib/checkins.js so neither
  // scheduler can fire to a number that wasn't explicitly approved when the
  // env var is set.
  if (!isHealthAllowlisted(ownerPhone)) return;

  const today = new Date().toISOString().split("T")[0];
  if (lastCheckinSentDate === today) return; // already sent today

  // Only send between 8-9am PT (optimal morning reflection)
  const hour = new Date().getUTCHours();
  const ptHour = (hour - 7 + 24) % 24;
  if (ptHour < 8 || ptHour >= 9) return;

  try {
    const profile = await loadHealthProfile(ownerPhone, tenant);
    const lastCheckin = profile?.last_checkin_date;

    // Only send if last check-in was yesterday or earlier
    if (lastCheckin === today) return;

    const prompt = buildDailyCheckinPrompt(profile);
    await sendMessage(ownerPhone, prompt, {
      tenant,
      auditOrigin: "scheduled",
    });
    lastCheckinSentDate = today;
    console.log(
      `[health-checkin] Daily check-in sent to ${tenant?.displayName || "owner"}`,
    );
  } catch (err) {
    console.error("[health-checkin] error:", err.message);
  }
}
