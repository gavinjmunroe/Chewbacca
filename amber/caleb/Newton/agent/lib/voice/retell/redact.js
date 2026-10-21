/**
 * retell/redact.js — log-safe redaction for Retell secrets and PII.
 *
 * No raw API key, no full phone number, no transcript content ever
 * reaches a log line by default. These helpers are used by the adapter
 * before any console.* call and are re-exported for tests so we can
 * assert that nothing leaks.
 */

/**
 * Redact an API key down to "len=…" so we can confirm a key was loaded
 * without ever exposing its value. Returns "len=0" for empty / null.
 */
export function redactApiKey(key) {
  if (!key || typeof key !== "string") return "len=0";
  return `len=${key.length}`;
}

/**
 * Redact a phone number to the last 4 digits ("…1234"). Returns "***"
 * for anything that doesn't look phone-shaped.
 */
export function redactPhone(phone) {
  if (!phone || typeof phone !== "string") return "***";
  const digits = phone.replace(/\D+/g, "");
  if (digits.length < 4) return "***";
  return `…${digits.slice(-4)}`;
}

/**
 * Shape a Retell call attempt into a structured, log-safe summary. No
 * dynamic-variable values, no transcript, no audio. Variable names are
 * preserved so we can debug missing context, but values are not.
 */
export function summarizeCallAttempt({
  toNumber,
  fromNumber,
  agentId,
  variableNames,
  metadataKeys,
  enabled,
  hasKey,
}) {
  return {
    to: redactPhone(toNumber),
    from: redactPhone(fromNumber),
    agentId: agentId || null,
    variableNames: Array.isArray(variableNames) ? variableNames.slice() : [],
    metadataKeys: Array.isArray(metadataKeys) ? metadataKeys.slice() : [],
    enabled: Boolean(enabled),
    hasKey: Boolean(hasKey),
  };
}
