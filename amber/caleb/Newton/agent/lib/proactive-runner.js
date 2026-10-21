/**
 * Proactive runner — owns the daily check-in + outreach loop.
 *
 * Extracted from agent.js to honor the <800-line rule (see AGENTS.md).
 * Rate-limit state lives here as a small module singleton so agent.js
 * doesn't have to plumb counters back and forth.
 *
 * Note: lib/proactive.js is a separate module that owns the *outreach
 * targeting logic* (who to message, when, cadence). This file is the
 * *scheduler* that calls into both the brain (for proactive health
 * nudges) and proactive.js (for outreach).
 */

import { callClaudeRaw } from "./ai.js";
import { listActiveTenants } from "./tenant.js";
import { sendMessage } from "./transport.js";
import { loadAmberContext } from "./context.js";
import { HEALTH_DIMS, CALEB_PHONE } from "./constants.js";
import {
  loadHealthProfile,
  healthResponseGuidance,
  maybeSendDailyCheckin,
} from "./health.js";
import {
  getProactiveTargets,
  generateProactiveMessage,
  recordOutreach,
} from "./proactive.js";
import {
  isContextNudgeEnabled,
  isOutreachEnabled,
  isCheckinSchedulerEnabled,
  anyScheduledEnabled,
  describeProactiveGates,
} from "./proactive-prefs.js";
import { humanize } from "./voice-guard.js";
import { isAllowlisted } from "./checkins.js";

// ── Rate-limit state ────────────────────────────────────────────────────
const state = {
  lastProactiveMessage: Date.now(),
  proactiveMessageCount: 0,
  proactiveMessageDate: new Date().toDateString(),
};

const MAX_PROACTIVE_PER_DAY = 3;
const PROACTIVE_START_HOUR_PT = 8;
const PROACTIVE_END_HOUR_PT = 22;
const CHECK_PROACTIVE_START_HOUR = 9;
const CHECK_PROACTIVE_END_HOUR = 20;
const COOLDOWN_HOURS = 24;

export async function checkForProactiveUpdates(fullContext, tenant = null) {
  const hoursSinceLastMessage =
    (Date.now() - state.lastProactiveMessage) / (1000 * 60 * 60);
  if (hoursSinceLastMessage < COOLDOWN_HOURS) return null;

  const currentHour = new Date().getHours();
  if (
    currentHour < CHECK_PROACTIVE_START_HOUR ||
    currentHour > CHECK_PROACTIVE_END_HOUR
  ) {
    return null;
  }

  let healthContext = "";
  try {
    const ownerPhone = tenant?.phoneNumber || CALEB_PHONE;
    const profile = await loadHealthProfile(ownerPhone, tenant);
    if (profile) {
      const scores = HEALTH_DIMS.filter((d) => profile[d] !== null)
        .map((d) => `${d}: ${profile[d]}/10`)
        .join(", ");
      if (scores) {
        const guidance = healthResponseGuidance(profile);
        healthContext = `\n\nCaleb's health profile: ${scores}. Overall: ${profile.overall_score}/10. Lowest: ${profile.lowest_dimension}. Last check-in: ${profile.last_checkin_date || "unknown"}.${guidance ? `\n${guidance}` : ""}`;
      }
    }
  } catch (err) {
    console.warn("[proactive] Failed to load health profile:", err.message);
  }

  try {
    const data = await callClaudeRaw({
      max_tokens: 500,
      system: `You are Amber, deciding whether to send Caleb a proactive text. You see everything through the 6 dimensions of health: Social, Financial, Intellectual, Spiritual, Physical, Emotional.

Consider:
- Has Caleb checked in on his health recently? If not, nudge him.
- Are any of his projects at a critical point that needs attention?
- Is there a relationship he should follow up on?
- Is there something encouraging or grounding to share based on where he's at?

Only send truly valuable, timely messages. Quality over quantity.`,
      messages: [
        {
          role: "user",
          content: `Based on Caleb's context, projects, goals, and health profile, is there anything important or helpful you should proactively text him about today?

If yes, write a brief, casual text message (2-3 sentences max). If no, just reply with the single word: SKIP.

Context:
${fullContext.substring(0, 10000)}${healthContext}`,
        },
      ],
    });

    const message = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (message && message !== "SKIP" && !message.includes("SKIP")) {
      return message;
    }
  } catch (err) {
    console.warn("[proactive] brain call failed:", err.message);
  }
  return null;
}

function withinPtWakingWindow() {
  const hour = new Date().getUTCHours();
  const ptHour = (hour - 7 + 24) % 24;
  return ptHour >= PROACTIVE_START_HOUR_PT && ptHour < PROACTIVE_END_HOUR_PT;
}

function rolloverDailyCounter() {
  const today = new Date().toDateString();
  if (state.proactiveMessageDate !== today) {
    state.proactiveMessageDate = today;
    state.proactiveMessageCount = 0;
  }
}

async function sendHealthAndContextMessage(tenant) {
  try {
    const fullContext = await loadAmberContext(tenant);
    const proactiveMessage = await checkForProactiveUpdates(
      fullContext,
      tenant,
    );
    if (!proactiveMessage) return;
    console.log(
      `Sending proactive message to ${tenant.displayName || "owner"}...`,
    );
    await sendMessage(tenant.phoneNumber, humanize(proactiveMessage), {
      tenant,
      auditOrigin: "scheduled",
    });
    state.lastProactiveMessage = Date.now();
    state.proactiveMessageCount++;
    console.log(
      `✅ Proactive message sent to ${tenant.displayName} (${state.proactiveMessageCount}/${MAX_PROACTIVE_PER_DAY} today)\n`,
    );
  } catch (error) {
    console.error(
      `⚠️  Proactive check error for ${tenant.displayName} (non-fatal):`,
      error.message,
    );
  }
}

async function sendOutreachBatch(tenant) {
  if (state.proactiveMessageCount >= MAX_PROACTIVE_PER_DAY) return;
  try {
    const targets = await getProactiveTargets(tenant);
    for (const target of targets.slice(0, 2)) {
      if (state.proactiveMessageCount >= MAX_PROACTIVE_PER_DAY) break;
      const msg = await generateProactiveMessage(target);
      if (!msg) continue;
      await sendMessage(target.handle, humanize(msg), {
        tenant,
        auditOrigin: "scheduled",
      });
      recordOutreach(target.handle, tenant);
      state.proactiveMessageCount++;
      console.log(
        `✅ Proactive outreach (${tenant.displayName}) to ${target.displayName} (${target.daysSince}d, ${state.proactiveMessageCount}/${MAX_PROACTIVE_PER_DAY} today)`,
      );
    }
  } catch (err) {
    console.warn(
      `[proactive-outreach] error for ${tenant.displayName}:`,
      err.message,
    );
  }
}

/**
 * Top-level proactive loop. Caller passes `isProcessing` so we don't
 * step on an in-flight webhook turn.
 */
export async function runProactiveCheck({ isProcessing = false } = {}) {
  if (isProcessing) return;
  if (!withinPtWakingWindow()) {
    const hour = new Date().getUTCHours();
    const ptHour = (hour - 7 + 24) % 24;
    console.log(`⏭️ Skipping proactive check — quiet hours (${ptHour}:00 PT)`);
    return;
  }

  rolloverDailyCounter();
  if (state.proactiveMessageCount >= MAX_PROACTIVE_PER_DAY) {
    console.log(
      `⏭️ Skipping proactive check — daily limit reached (${MAX_PROACTIVE_PER_DAY}/day)`,
    );
    return;
  }

  const tenants = await listActiveTenants(null).catch(() => []);
  if (!tenants.length) {
    console.log("⏭️ Skipping proactive check — no active tenants");
    return;
  }

  for (const tenant of tenants) {
    if (state.proactiveMessageCount >= MAX_PROACTIVE_PER_DAY) break;
    if (!tenant?.loopSenderId || !tenant?.phoneNumber) continue;

    // Honor the same kill switch checkins.js uses (AMBER_CHECKIN_ALLOWLIST).
    // Without this, the context-nudge path sent proactive health texts to the
    // owner even when their phone was removed from the allowlist (Sagar was
    // still getting daily texts after being de-allowlisted, 2026-06-04).
    if (!isAllowlisted(tenant.phoneNumber)) {
      console.log(
        `⏭️ [proactive] ${tenant.displayName} not in AMBER_CHECKIN_ALLOWLIST — skipping all proactive sends`,
      );
      continue;
    }

    if (!anyScheduledEnabled(tenant)) {
      console.log(
        `⏭️ [proactive] all scheduled surfaces off for ${tenant.displayName}`,
        describeProactiveGates(tenant),
      );
      continue;
    }

    if (isCheckinSchedulerEnabled(tenant)) {
      await maybeSendDailyCheckin(tenant).catch((e) =>
        console.warn(
          `[health-checkin] error for ${tenant.displayName}:`,
          e.message,
        ),
      );
    }

    if (isContextNudgeEnabled(tenant)) {
      await sendHealthAndContextMessage(tenant);
    }

    if (isOutreachEnabled(tenant)) {
      await sendOutreachBatch(tenant);
    }
  }

  // flaw #30: T-24h commitment reminders. Runs once per tick (BQ-backed,
  // self-deduping via reminded_at + a 3-DM-per-event cap), so piggy-
  // backing on the existing proactive cadence avoids a second timer.
  try {
    const { runCommitmentReminderTick } =
      await import("./commitment-reminder.js");
    await runCommitmentReminderTick();
  } catch (err) {
    console.warn(`[commitment-reminder] tick failed: ${err.message}`);
  }
}

// ── Flaw #37: DLQ replayer ─────────────────────────────────────────────
//
// Every 60s we drain whatever sits in /tmp/medha-pdw-dlq.jsonl back into
// BigQuery. Survives transient BQ outages (network blip, quota, retry)
// without losing the row. /tmp resets on Railway redeploy — acceptable
// for v1.
const DLQ_REPLAY_INTERVAL_MS = 60 * 1000;
let dlqTimer = null;

export function startDlqReplayer() {
  if (dlqTimer) return;
  dlqTimer = setInterval(async () => {
    try {
      const [{ replayDlq }, { insertRow, isReady: bqReady }] =
        await Promise.all([
          import("./pdw/bq-dlq.js"),
          import("./pdw/bq-client.js"),
        ]);
      if (!bqReady()) return;
      const result = await replayDlq((table, row) =>
        insertRow(table, row, { skipDlq: true }),
      );
      if (result.tried > 0) {
        console.log(
          `[pdw-dlq] tick — tried=${result.tried} succeeded=${result.succeeded} dropped=${result.dropped} remaining=${result.remaining}`,
        );
      }
    } catch (err) {
      console.warn(`[pdw-dlq] replay tick failed: ${err.message}`);
    }
  }, DLQ_REPLAY_INTERVAL_MS);
  if (dlqTimer.unref) dlqTimer.unref();
}

// ── Flaw #52: background contact_facts batch ───────────────────────────
//
// Every 6 hours we ask medha-id for recent outbound messages (if it
// exposes /v1/embeddings/recent), run them through the local extractor,
// and let recordContactFact write the results back. If the recent
// endpoint isn't available yet, we silently skip — the per-reply
// extractor (flaw #31) already covers the live path; this is just a
// catch-up sweep.
const CONTACT_FACTS_INTERVAL_MS = 6 * 60 * 60 * 1000;
let contactFactsTimer = null;

async function runContactFactsBatch() {
  try {
    const { MEDHA_ID_URL, MEDHA_ID_API_KEY } = await import("./constants.js");
    if (!MEDHA_ID_URL || !MEDHA_ID_API_KEY) return;
    const res = await fetch(`${MEDHA_ID_URL}/v1/embeddings/recent?limit=100`, {
      headers: { "x-api-key": MEDHA_ID_API_KEY },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // 404 just means medha-id doesn't have /recent yet — skip quietly.
      return;
    }
    const data = await res.json().catch(() => null);
    const items = Array.isArray(data?.items) ? data.items : [];
    if (items.length === 0) return;
    const { extractAndStoreFacts } = await import("./fact-extractor.js");
    for (const it of items) {
      if (!it?.text || !it?.tenant_did) continue;
      await extractAndStoreFacts({
        text: it.text,
        tenantDid: it.tenant_did,
        sourceContact: it.contact || "amber",
        sourceMessageId: it.message_id || null,
      }).catch(() => {});
    }
    console.log(`[contact-facts] batch processed ${items.length} messages`);
  } catch (err) {
    console.warn(`[contact-facts] batch failed: ${err.message}`);
  }
}

export function startContactFactsBatch() {
  if (contactFactsTimer) return;
  contactFactsTimer = setInterval(
    runContactFactsBatch,
    CONTACT_FACTS_INTERVAL_MS,
  );
  if (contactFactsTimer.unref) contactFactsTimer.unref();
}

// ── Flaw #54: daily memory TTL decay ───────────────────────────────────
//
// Once a day we ask medha-id to halve decay_score on contact_facts that
// haven't been referenced in 30d. Search results multiply similarity by
// decay_score (flaw #54 in the search route) so stale facts naturally
// drop out of recall without losing the underlying row.
const DECAY_INTERVAL_MS = 24 * 60 * 60 * 1000;
let decayTimer = null;

async function runDecayTick() {
  try {
    const { MEDHA_ID_URL, MEDHA_ID_API_KEY } = await import("./constants.js");
    if (!MEDHA_ID_URL || !MEDHA_ID_API_KEY) return;
    const res = await fetch(`${MEDHA_ID_URL}/v1/embeddings/decay`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": MEDHA_ID_API_KEY,
      },
      body: JSON.stringify({ threshold_days: 30 }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      console.log(`[memory-decay] decayed ${data?.decayed ?? 0} facts`);
    }
  } catch (err) {
    console.warn(`[memory-decay] tick failed: ${err.message}`);
  }
}

export function startMemoryDecay() {
  if (decayTimer) return;
  decayTimer = setInterval(runDecayTick, DECAY_INTERVAL_MS);
  if (decayTimer.unref) decayTimer.unref();
}

export function getProactiveState() {
  return { ...state };
}
