/**
 * retell/adapter.js — Retell voice-agent adapter (provider seam).
 *
 * Foundation for outbound voice. Camber, Samber, and (later) Togari /
 * Tiwari planning surfaces will call into this adapter rather than the
 * Retell SDK directly, so we can swap out providers, mock in tests, and
 * keep secret handling in one place.
 *
 * Hard rules — these are why this module exists at all:
 *
 *   1. RETELL_API_KEY only comes from env / Railway secrets. Never from
 *      a request body, never from the context wiki, never logged.
 *   2. AMBER_RETELL_ENABLED defaults false. With the flag off, every
 *      call-creation path short-circuits to a safe { ok:false } before
 *      we touch the SDK.
 *   3. Phone numbers are redacted in logs; transcripts/audio are never
 *      logged at all.
 *   4. Dynamic variables flow through `buildDynamicVariables`, which
 *      coerces everything to strings and drops unknown keys.
 *
 * This adapter does NOT wire itself into the Claude tool surface yet.
 * Coupling it to Camber/Samber/Togari is a follow-up PR — that's the
 * point of keeping it foundational.
 */

import { loadRetellConfig, loadRetellSecret } from "./config.js";
import { buildRetellClient } from "./client.js";
import { buildDynamicVariables } from "./variables.js";
import { redactApiKey, redactPhone, summarizeCallAttempt } from "./redact.js";

const LOG_PREFIX = "[retell]";

function logInfo(event, fields = {}) {
  // Single-line structured log so we can grep in Railway. We never put
  // raw secrets or full phone numbers in `fields` — callers are
  // responsible for redacting before they get here, and the fields
  // listed below are the only ones we accept by convention.
  const safe = { event, ...fields };
  // eslint-disable-next-line no-console
  console.log(LOG_PREFIX, JSON.stringify(safe));
}

function logWarn(event, fields = {}) {
  const safe = { event, ...fields };
  // eslint-disable-next-line no-console
  console.warn(LOG_PREFIX, JSON.stringify(safe));
}

/**
 * Is Retell wired up and turned on? True iff the feature flag is set
 * AND a RETELL_API_KEY is present in env. Callers should treat false
 * as "voice unavailable, fall back to text" — not as an error.
 */
export function isConfigured() {
  const cfg = loadRetellConfig();
  return cfg.enabled && cfg.hasKey;
}

/**
 * Inspect-only descriptor of the current Retell wiring. Safe to log.
 * Used by /health-style endpoints and by tests.
 */
export function describeConfig() {
  const cfg = loadRetellConfig();
  const secret = loadRetellSecret();
  return {
    enabled: cfg.enabled,
    hasKey: cfg.hasKey,
    keyLen: secret ? redactApiKey(secret) : "len=0",
    agentId: cfg.agentId || null,
    llmId: cfg.llmId || null,
    fromNumber: cfg.fromNumber ? redactPhone(cfg.fromNumber) : null,
  };
}

function disabledReason(cfg) {
  if (!cfg.enabled) return "feature_flag_off";
  if (!cfg.hasKey) return "missing_api_key";
  return null;
}

/**
 * Create an outbound phone call via Retell.
 *
 * Wrapped in a stable result shape — { ok:true, callId, raw } on
 * success, { ok:false, reason, detail? } on every other path. The
 * adapter never throws for "expected" disabled / misconfigured cases;
 * it throws only on actual SDK / network errors so the caller can log
 * and degrade.
 *
 * @param {Object} opts
 * @param {string} opts.toNumber  E.164 phone number to call
 * @param {Object} [opts.dynamicVariables]  pre-built map of strings, or
 *                  pass {tenant, contact, role, objective, safetyMode,
 *                  calendarSummary} and let the adapter build it.
 * @param {Object} [opts.metadata] free-form Retell metadata (kept opaque)
 * @param {string} [opts.fromNumber] override RETELL_FROM_NUMBER
 * @param {string} [opts.agentId]    override RETELL_AGENT_ID
 */
export async function createPhoneCall(opts = {}) {
  const cfg = loadRetellConfig();
  const reason = disabledReason(cfg);
  if (reason) {
    logInfo("createPhoneCall.skip", { reason });
    return { ok: false, reason };
  }

  const toNumber = opts.toNumber;
  if (!toNumber || typeof toNumber !== "string") {
    return { ok: false, reason: "missing_to_number" };
  }
  const fromNumber = opts.fromNumber || cfg.fromNumber;
  if (!fromNumber) {
    return { ok: false, reason: "missing_from_number" };
  }
  const agentId = opts.agentId || cfg.agentId;

  const variables = normalizeDynamicVariables(opts.dynamicVariables);
  const metadata = opts.metadata && typeof opts.metadata === "object"
    ? { ...opts.metadata }
    : undefined;

  logInfo(
    "createPhoneCall.attempt",
    summarizeCallAttempt({
      toNumber,
      fromNumber,
      agentId,
      variableNames: Object.keys(variables),
      metadataKeys: metadata ? Object.keys(metadata) : [],
      enabled: cfg.enabled,
      hasKey: cfg.hasKey,
    }),
  );

  const apiKey = loadRetellSecret();
  if (!apiKey) {
    // Race between describeConfig and call — defensive.
    return { ok: false, reason: "missing_api_key" };
  }

  let client;
  try {
    client = await buildRetellClient(apiKey);
  } catch (err) {
    logWarn("createPhoneCall.client_error", { message: safeMessage(err) });
    return { ok: false, reason: "sdk_init_failed", detail: safeMessage(err) };
  }

  const payload = {
    from_number: fromNumber,
    to_number: toNumber,
  };
  if (agentId) payload.override_agent_id = agentId;
  if (Object.keys(variables).length > 0) {
    payload.retell_llm_dynamic_variables = variables;
  }
  if (metadata) payload.metadata = metadata;

  try {
    const raw = await client.call.createPhoneCall(payload);
    const callId = raw?.call_id || raw?.callId || null;
    logInfo("createPhoneCall.ok", { callId });
    return { ok: true, callId, raw };
  } catch (err) {
    logWarn("createPhoneCall.api_error", { message: safeMessage(err) });
    return { ok: false, reason: "api_error", detail: safeMessage(err) };
  }
}

/**
 * Create a Retell agent. This is an admin-shaped action — we only
 * expose it so an operator can bootstrap an agent from a script. It is
 * intentionally not on the default tool surface, and it still respects
 * the feature flag so a stray import can't accidentally provision an
 * agent on a disabled tenant.
 */
export async function createAgent(spec = {}) {
  const cfg = loadRetellConfig();
  const reason = disabledReason(cfg);
  if (reason) {
    logInfo("createAgent.skip", { reason });
    return { ok: false, reason };
  }
  const apiKey = loadRetellSecret();
  if (!apiKey) return { ok: false, reason: "missing_api_key" };

  let client;
  try {
    client = await buildRetellClient(apiKey);
  } catch (err) {
    return { ok: false, reason: "sdk_init_failed", detail: safeMessage(err) };
  }

  try {
    const raw = await client.agent.create(spec);
    const agentId = raw?.agent_id || raw?.agentId || null;
    logInfo("createAgent.ok", { agentId });
    return { ok: true, agentId, raw };
  } catch (err) {
    logWarn("createAgent.api_error", { message: safeMessage(err) });
    return { ok: false, reason: "api_error", detail: safeMessage(err) };
  }
}

function normalizeDynamicVariables(input) {
  if (!input) return {};
  // Caller passed a pre-built flat map of strings.
  if (looksLikeFlatStringMap(input)) {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = typeof v === "string" ? v : String(v ?? "");
    }
    return out;
  }
  // Caller passed a {tenant, contact, …} shape; let the builder filter
  // unknown keys and stringify.
  return buildDynamicVariables(input);
}

function looksLikeFlatStringMap(obj) {
  if (!obj || typeof obj !== "object") return false;
  if ("tenant" in obj || "contact" in obj || "extra" in obj) return false;
  for (const v of Object.values(obj)) {
    if (v != null && typeof v === "object") return false;
  }
  return true;
}

function safeMessage(err) {
  if (!err) return "unknown_error";
  const m = err.message || String(err);
  // Defense in depth: if an SDK error ever surfaced the API key in the
  // message, redact it before we hand the string to a log line.
  const secret = loadRetellSecret();
  if (secret && m.includes(secret)) {
    return m.split(secret).join("[redacted]");
  }
  return m;
}
