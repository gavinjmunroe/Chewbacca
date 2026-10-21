/**
 * retell/variables.js — dynamic-variable builder for Retell agents.
 *
 * Retell expects `retell_llm_dynamic_variables` to be a flat object whose
 * values are strings (numbers/booleans get coerced server-side, but the
 * SDK's typings treat the values as strings and the safe path is to
 * stringify everything ourselves).
 *
 * The shape we settle on here is what Camber / Samber and, eventually,
 * the Togari planning surface will fill in before placing a call:
 *
 *   - agent_name        — "camber" | "samber" | "amber" (caller persona)
 *   - tenant_name       — first name of the person Amber is acting for
 *   - tenant_phone_last4— last 4 digits of the tenant's phone (no full PII)
 *   - contact_name      — first name of the person being called (optional)
 *   - role              — "concierge" | "scheduler" | "outreach" | …
 *   - objective         — one-line "why this call exists"
 *   - safety_mode       — "safe" | "alert" | "festival" (festival/safety
 *                         flow can downshift the agent before pickup)
 *   - calendar_summary  — short string the LLM can read out ("free until 5")
 *
 * Anything we don't have we simply omit — Retell tolerates missing keys
 * and will fall back to the agent's prompt defaults.
 *
 * No tenant DID, no full phone number, no API keys, and no raw Pinecone
 * recall payloads are ever placed in dynamic variables. The Retell
 * server logs every variable value, so this is treated as third-party
 * surface.
 */

const KNOWN_KEYS = [
  "agent_name",
  "tenant_name",
  "tenant_phone_last4",
  "contact_name",
  "role",
  "objective",
  "safety_mode",
  "calendar_summary",
];

function lastFourDigits(phone) {
  if (!phone || typeof phone !== "string") return "";
  const digits = phone.replace(/\D+/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

function coerceToString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Objects/arrays would leak structure into Retell's server; refuse them.
  return "";
}

/**
 * Build a sanitized, all-strings dynamic-variable map. Unknown keys are
 * dropped on purpose so a caller can't smuggle e.g. an API key through
 * by naming the variable "key".
 *
 * @param {Object} input
 * @param {Object} [input.tenant] tenant object resolved by lib/tenant.js
 * @param {Object} [input.contact] optional contact context
 * @param {string} [input.role]
 * @param {string} [input.objective]
 * @param {string} [input.safetyMode]
 * @param {string} [input.calendarSummary]
 * @param {Object} [input.extra] free-form overrides; only KNOWN_KEYS survive
 * @returns {Object<string,string>}
 */
export function buildDynamicVariables(input = {}) {
  const { tenant, contact, role, objective, safetyMode, calendarSummary, extra } = input;

  const out = {
    agent_name: coerceToString(tenant?.agentName || tenant?.persona || ""),
    tenant_name: coerceToString(tenant?.firstName || tenant?.name || ""),
    tenant_phone_last4: lastFourDigits(tenant?.phoneNumber || tenant?.phone),
    contact_name: coerceToString(contact?.firstName || contact?.name || ""),
    role: coerceToString(role || ""),
    objective: coerceToString(objective || ""),
    safety_mode: coerceToString(safetyMode || ""),
    calendar_summary: coerceToString(calendarSummary || ""),
  };

  if (extra && typeof extra === "object") {
    for (const key of KNOWN_KEYS) {
      if (key in extra && !out[key]) {
        out[key] = coerceToString(extra[key]);
      }
    }
  }

  // Drop empty values so we don't bake "" into Retell server state.
  const trimmed = {};
  for (const [k, v] of Object.entries(out)) {
    if (v !== "") trimmed[k] = v;
  }
  return trimmed;
}

export const RETELL_KNOWN_VARIABLE_KEYS = Object.freeze(KNOWN_KEYS.slice());
