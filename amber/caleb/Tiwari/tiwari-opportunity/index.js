/**
 * tiwari-opportunity — Sequencing primitive (yoga: bhakti / devotional).
 *
 * This is the right-info-right-moment layer. We blend three sources so that
 * a single `sequence(trigger)` call produces the best-possible nudge for
 * the user across whatever channel they've paid for:
 *
 *   1. togari-opportunity (vendored submodule)
 *      — the production B2B "Opportunity Engine V2" MCP server. Does signal
 *        subscriptions, data pulls, outreach drafting, and notification
 *        sending for BMA clients. We reuse its agent pipeline for any
 *        trigger whose `type` is "signal_scan" or "data_pull".
 *
 *   2. Newton experimental layer
 *      — pulls from Newton/agent/lib/health.js + contacts.js to decide
 *        *who* in the user's inner circle would benefit from a check-in
 *        today, scored across the 6 health dimensions.
 *
 *   3. amber-id /ask
 *      — for any trigger we don't have a specialised handler for, we fall
 *        back to a people-centric Q&A against the user's private Pinecone
 *        knowledge namespace. This is what makes `sequence` personalised.
 *
 * Billing gates are enforced here so amber-agent routes can return 402 on
 * paid channels (iMessage / SMS concierge) without any LLM work being done.
 */

import amberId from "../shared/amber-id-client/index.js";
import togari from "./src/togari-adapter.js";
import {
  DimensionAwareLinUCB,
  DIMENSIONS as BANDIT_DIMENSIONS,
  armId,
  computeReward,
} from "./src/bandit.js";

const DEFAULT_STYLE = "warm, human, one short paragraph";

// In-memory fallback bandit. Production stores (A_a, b_a) in Postgres via
// amber-id, keyed by userCnft. The fallback ensures sequence() is still
// useful in cold-boot / offline environments; snapshots are caller-managed.
const DEFAULT_BANDIT = new DimensionAwareLinUCB();

const CHANNEL_CANDIDATES = ["push", "email", "imessage", "sms"];

/** Channels and the entitlement key that gates each. */
const CHANNEL_GATES = {
  push: null, // free
  email: "email",
  imessage: "imessage_concierge",
  sms: "sms_concierge",
};

/** Trigger types the togari-opportunity engine natively handles. */
const TOGARI_TRIGGERS = new Set([
  "signal_scan",
  "signal_subscription",
  "data_pull",
]);

/**
 * Entry point.
 *
 * @param {object} args
 * @param {object} args.trigger           { type, context, at, channel, payload }
 * @param {string} args.userCnft          required
 * @param {string} args.token             Privy JWT, required
 * @param {object} args.entitlements      resolved by amber-agent proxy
 * @param {object} [args.options]         { style, title, topK, timeoutMs }
 */
export async function sequence({
  trigger,
  userCnft,
  token,
  entitlements = {},
  options = {},
} = {}) {
  const t0 = Date.now();
  const warnings = [];

  if (!trigger || typeof trigger !== "object") {
    return envelope({ ok: false, source: "empty", error: "missing_trigger" });
  }
  if (!userCnft || !token) {
    return envelope({
      ok: false,
      source: "empty",
      error: "missing_identity",
      message: "userCnft + token required for sequencing",
    });
  }

  const channel = trigger.channel || "push";
  const gateKey = CHANNEL_GATES[channel];
  if (gateKey === undefined) {
    return envelope({
      ok: false,
      source: "empty",
      error: "unsupported_channel",
      message: `channel "${channel}" not supported`,
    });
  }
  if (gateKey && !entitlements[gateKey]) {
    return envelope({
      ok: false,
      source: "billing-gate",
      error: "entitlement_required",
      channel,
      entitlement: gateKey,
      message: `channel "${channel}" requires entitlement "${gateKey}"`,
      tookMs: Date.now() - t0,
    });
  }

  // ── Branch by trigger type ────────────────────────────────────────────
  if (TOGARI_TRIGGERS.has(trigger.type)) {
    return await handleTogariTrigger({
      trigger,
      userCnft,
      token,
      channel,
      options,
      t0,
      warnings,
    });
  }

  return await handleAmberIdTrigger({
    trigger,
    userCnft,
    token,
    channel,
    options,
    entitlements,
    t0,
    warnings,
  });
}

// ── Trigger handlers ───────────────────────────────────────────────────────

async function handleTogariTrigger({
  trigger,
  userCnft,
  token,
  channel,
  options,
  t0,
  warnings,
}) {
  let togariResult = null;
  try {
    if (
      trigger.type === "signal_scan" ||
      trigger.type === "signal_subscription"
    ) {
      togariResult = await togari.triggerSignalScan({
        subscriptionId: trigger.payload?.subscriptionId,
        dryRun: trigger.payload?.dryRun ?? false,
      });
    } else if (trigger.type === "data_pull") {
      togariResult = await togari.createDataPull({
        clientId: trigger.payload?.clientId || userCnft,
        naturalLanguageQuery: trigger.context || trigger.payload?.query,
        maxContacts: trigger.payload?.maxContacts ?? 250,
      });
    }
  } catch (err) {
    warnings.push(`togari: ${err.message}`);
    return envelope({
      ok: false,
      source: "togari-opportunity",
      error: "togari_error",
      message: err.message,
      warnings,
      tookMs: Date.now() - t0,
    });
  }

  // Enrich with amber-id context when the caller wants a personal digest
  let personal = null;
  if (options.includePersonalContext !== false) {
    personal = await safeAsk({
      token,
      question: `Given this B2B opportunity context, what should I personally pay attention to? ${trigger.context || ""}`,
      topK: options.topK ?? 5,
    });
  }

  return envelope({
    ok: true,
    source: personal?.ok ? "blended" : "togari-opportunity",
    results: [packageForChannel(channel, togariResult, personal, options)],
    personalized: Boolean(personal?.ok),
    citations: personal?.citations ?? [],
    warnings,
    tookMs: Date.now() - t0,
  });
}

async function handleAmberIdTrigger({
  trigger,
  userCnft,
  token,
  channel,
  options,
  entitlements,
  t0,
  warnings,
}) {
  // ── Bandit selection ────────────────────────────────────────────────────
  // Decide which (channel, dimension, relationship) to nudge on using the
  // dimension-aware LinUCB from bandit.js. See Tiwari/papers/opportunity.tex.
  const bandit = options.bandit ?? DEFAULT_BANDIT;
  const banditContext = options.banditContext ?? null;
  let banditChoice = null;
  if (banditContext) {
    try {
      const candidates = buildBanditCandidates({
        trigger,
        channel,
        entitlements,
      });
      if (candidates.length) {
        const selection = bandit.select({
          candidates,
          context: banditContext,
        });
        banditChoice = {
          chosenId: selection.chosen.id,
          cand: selection.chosen.cand,
          mean: selection.chosen.mean,
          ucb: selection.chosen.ucb,
          diversityPenalty: selection.chosen.diversityPenalty,
          all: selection.all.slice(0, 5),
        };
      }
    } catch (err) {
      warnings.push(`bandit: ${err.message}`);
    }
  }

  const question = composeQuestionFromTrigger(trigger, banditChoice);
  const topK = options.topK ?? 6;
  const dimensionWeights = banditChoice
    ? weightsFor(banditChoice.cand.dimension)
    : undefined;

  const ask = await safeAsk({
    token,
    question,
    topK,
    dimensionWeights,
  });
  if (!ask?.ok) {
    return envelope({
      ok: false,
      source: "amber-id",
      error: ask?.error || "ask_failed",
      message: ask?.message,
      warnings,
      tookMs: Date.now() - t0,
    });
  }
  return envelope({
    ok: true,
    source: "amber-id",
    results: [packageForChannel(channel, null, ask, options)],
    personalized: true,
    citations: ask.citations ?? [],
    bandit: banditChoice,
    warnings,
    tookMs: Date.now() - t0,
  });
}

// ── Bandit helpers ─────────────────────────────────────────────────────────

function buildBanditCandidates({ trigger, channel, entitlements = {} }) {
  // Only the currently requested channel is a candidate for THIS call; the
  // bandit's job here is to pick which dimension to aim the nudge at. The
  // channel was already billing-gated upstream. For cross-channel selection,
  // the scheduler calls sequence() separately per channel with its own
  // banditContext.
  const cand = [];
  for (const dimension of BANDIT_DIMENSIONS) {
    cand.push({
      channel,
      dimension,
      relationship: trigger?.payload?.relationship ?? null,
    });
  }
  return cand;
}

function weightsFor(dimension) {
  const base = 0.1;
  const peak = 1.0;
  const w = {};
  for (const d of BANDIT_DIMENSIONS) w[d] = base;
  w[dimension] = peak;
  return w;
}

/**
 * Public hook so amber-agent can record the reward after a post-nudge
 * check-in arrives. Callers persist the snapshot to Postgres; this function
 * only updates the in-memory bandit state + returns the computed reward.
 */
export function observe({
  bandit = DEFAULT_BANDIT,
  chosenId,
  context,
  postCheckin,
  chosenDimension,
}) {
  const reward = computeReward({
    postCheckin,
    pi: context?.pi,
    alpha: context?.alpha,
    chosenDimension,
  });
  bandit.update({ chosenId, context, reward });
  return { reward, snapshot: bandit.snapshot() };
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function safeAsk({ token, question, topK, dimensionWeights }) {
  try {
    const args = { token, question, topK };
    if (dimensionWeights) args.dimensionWeights = dimensionWeights;
    return await amberId.ask(args);
  } catch (err) {
    return { ok: false, error: "ask_error", message: err.message };
  }
}

function composeQuestionFromTrigger(trigger, banditChoice = null) {
  const parts = [];
  if (banditChoice?.cand?.dimension) {
    parts.push(
      `Focus the answer on the ${banditChoice.cand.dimension} dimension of health.`,
    );
  }
  switch (trigger.type) {
    case "daily_digest":
      parts.push(
        "Who in my network should I check in on today, across spiritual, emotional, physical, intellectual, social, and financial dimensions?",
      );
      break;
    case "calendar_event":
      parts.push(
        `I have "${trigger.context}" on my calendar. Who is involved, and what should I know about them before it starts?`,
      );
      break;
    case "missed_conversation":
      parts.push(
        `I owe ${trigger.context} a reply. Draft a thoughtful next message that reflects what I know about them.`,
      );
      break;
    case "imessage_reply":
      parts.push(
        `Incoming iMessage: "${trigger.context}". Based on our history, what is the right response?`,
      );
      break;
    case "arbitrary_prompt":
    default:
      parts.push(trigger.context || "Who should I talk to today?");
      break;
  }
  return parts.join(" ");
}

function packageForChannel(channel, togariResult, ask, options = {}) {
  const style = options.style || DEFAULT_STYLE;
  const title = options.title || defaultTitle(channel);
  const body = renderBody({ togariResult, ask });
  const common = { channel, title, body, style };

  switch (channel) {
    case "push":
      return { ...common, type: "push_notification" };
    case "email":
      return {
        ...common,
        type: "email",
        subject: title,
        html: bodyToHtml(body),
      };
    case "imessage":
      return {
        ...common,
        type: "imessage",
        service: "loop_message",
        text: body,
      };
    case "sms":
      return { ...common, type: "sms", service: "twilio", text: body };
    default:
      return { ...common, type: "unknown" };
  }
}

function renderBody({ togariResult, ask }) {
  const chunks = [];
  if (ask?.answer) chunks.push(ask.answer.trim());
  if (togariResult?.summary) chunks.push(togariResult.summary.trim());
  if (togariResult?.opportunities?.length) {
    const preview = togariResult.opportunities
      .slice(0, 3)
      .map((o, i) => `${i + 1}. ${o.title || o.name || "Opportunity"}`)
      .join("\n");
    chunks.push(preview);
  }
  if (!chunks.length) chunks.push("No new opportunities right now.");
  return chunks.join("\n\n");
}

function bodyToHtml(body) {
  return body
    .split("\n\n")
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function defaultTitle(channel) {
  switch (channel) {
    case "email":
      return "Your Amber briefing";
    case "imessage":
    case "sms":
      return "Amber";
    default:
      return "Amber";
  }
}

function envelope(partial) {
  return {
    ok: false,
    source: "empty",
    results: [],
    personalized: false,
    tookMs: 0,
    warnings: [],
    citations: [],
    ...partial,
  };
}

export default { sequence, observe };
