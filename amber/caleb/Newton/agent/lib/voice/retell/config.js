/**
 * retell/config.js — Retell voice-agent configuration loader.
 *
 * Everything here reads from process.env so that secrets stay on Railway
 * (and, later, in amber-id's per-tenant secret bag). Nothing in this file
 * ever returns or logs the raw API key — callers ask for a redacted
 * descriptor and pass the live key into the SDK at call time.
 *
 * Feature flag: AMBER_RETELL_ENABLED. Default is false. Even if a key is
 * set, no outbound call is made unless the flag is explicitly truthy.
 *
 * Per-tenant secrets are out of scope for this foundation PR. When we
 * graduate Retell out of foundation, the lookup here moves to
 * `getSecret(tenant, "RETELL_API_KEY")` with this env fallback.
 */

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function readEnvFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultValue;
  return TRUE_VALUES.has(String(raw).toLowerCase());
}

function readEnvString(name) {
  const raw = process.env[name];
  if (raw == null) return "";
  const trimmed = String(raw).trim();
  return trimmed;
}

/**
 * Load the Retell config from process.env.
 *
 * Returns an object that is safe to log: `apiKey` is never included.
 * Use {@link loadRetellSecret} to obtain the raw key, and pass it
 * directly into the SDK without round-tripping it through logs.
 */
export function loadRetellConfig() {
  const enabled = readEnvFlag("AMBER_RETELL_ENABLED", false);
  const agentId = readEnvString("RETELL_AGENT_ID");
  const llmId = readEnvString("RETELL_LLM_ID");
  const fromNumber = readEnvString("RETELL_FROM_NUMBER");
  const hasKey = readEnvString("RETELL_API_KEY").length > 0;
  return { enabled, agentId, llmId, fromNumber, hasKey };
}

/**
 * Return the raw RETELL_API_KEY from env, or null if unset. Callers
 * MUST NOT log the return value. The only legitimate consumers are the
 * adapter that hands the key to the Retell SDK and the isConfigured()
 * predicate.
 */
export function loadRetellSecret() {
  const key = readEnvString("RETELL_API_KEY");
  return key.length > 0 ? key : null;
}
