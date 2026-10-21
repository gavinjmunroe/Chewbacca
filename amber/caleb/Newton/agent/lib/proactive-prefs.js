/**
 * proactive-prefs.js — central tenant gating for scheduled / proactive
 * outbound messages.
 *
 * Background: the agent currently runs several scheduled services that
 * push messages without the user asking for them: the morning / evening /
 * Sunday check-in scheduler (`lib/checkins.js`), the per-tenant proactive
 * runner that calls Claude to decide whether to send a "how's your day"
 * nudge (`lib/proactive-runner.js`), and the outreach batch that messages
 * dormant contacts on the owner's behalf. Combined, this reads as
 * scheduled-service spam — exactly what the de-botification work is
 * trying to dial down.
 *
 * The fix is a single resolver that answers four boolean questions, with
 * the same precedence ordering everywhere:
 *
 *   1. tenant.preferences.proactive.<key>  (per-tenant, set by amber-id)
 *   2. process.env.AMBER_PROACTIVE_<KEY>   (deploy-time global override)
 *   3. default                             (quiet)
 *
 * Defaults are intentionally quiet:
 *
 *   - check-ins ........................ disabled (opt-in per tenant)
 *   - context/health "nudge" messages .. disabled
 *   - outreach to dormant contacts ..... disabled
 *
 * SAFE / crisis / first-contact replies do NOT go through this gate.
 * Those are reactive (they fire on inbound text), never scheduled, and
 * are the one thing we never want quieted.
 */

const TRUTHY = new Set(["1", "true", "on", "yes"]);
const FALSY = new Set(["0", "false", "off", "no"]);

function envBool(value, fallback) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (TRUTHY.has(v)) return true;
  if (FALSY.has(v)) return false;
  return fallback;
}

function tenantBool(tenant, key, fallback) {
  const pref = tenant?.preferences?.proactive?.[key];
  if (pref === true) return true;
  if (pref === false) return false;
  return fallback;
}

/**
 * Should the morning/evening/Sunday check-in scheduler text this tenant?
 * Defaults FALSE — check-ins are opt-in per tenant. The previous default of
 * TRUE relied on listActiveTenants surfacing per-tenant preferences, which it
 * did not, so every active tenant was getting scheduled outbound regardless
 * of consent. Flip the default and require explicit opt-in either via
 * tenant.preferences.proactive.checkins=true or AMBER_PROACTIVE_CHECKINS=1.
 */
export function isCheckinSchedulerEnabled(tenant, env = process.env) {
  const envDefault = envBool(env.AMBER_PROACTIVE_CHECKINS, false);
  return tenantBool(tenant, "checkins", envDefault);
}

/**
 * Should the proactive runner call Claude to decide whether to send a
 * "did you check your health today / project nudge" message? Defaults
 * FALSE — this is the primary source of botty-feeling outbound traffic.
 */
export function isContextNudgeEnabled(tenant, env = process.env) {
  const envDefault = envBool(env.AMBER_PROACTIVE_CONTEXT_NUDGE, false);
  return tenantBool(tenant, "contextNudge", envDefault);
}

/**
 * Should the proactive runner message dormant contacts on the owner's
 * behalf (the outreach batch)? Defaults FALSE — outreach is opt-in.
 */
export function isOutreachEnabled(tenant, env = process.env) {
  const envDefault = envBool(env.AMBER_PROACTIVE_OUTREACH, false);
  return tenantBool(tenant, "outreach", envDefault);
}

/**
 * Convenience for the runner: returns true if any scheduled outbound
 * surface is enabled. When false the runner can short-circuit before
 * doing any per-tenant work.
 */
export function anyScheduledEnabled(tenant, env = process.env) {
  return (
    isCheckinSchedulerEnabled(tenant, env) ||
    isContextNudgeEnabled(tenant, env) ||
    isOutreachEnabled(tenant, env)
  );
}

/**
 * For logging / observability: snapshot the resolved gates for a tenant.
 */
export function describeProactiveGates(tenant, env = process.env) {
  return {
    checkins: isCheckinSchedulerEnabled(tenant, env),
    contextNudge: isContextNudgeEnabled(tenant, env),
    outreach: isOutreachEnabled(tenant, env),
  };
}
