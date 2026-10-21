/**
 * Register preference resolver for Amber's MOTHER / SISTER / WIFE voice.
 *
 * The voice doctrine (lib/prompts.js, AMBER_VOICE_DOCTRINE_TEMPLATE) says
 * the model picks a register per-turn from context. Some tenants want a
 * baseline override — Sagar may prefer SISTER as his daytime default while
 * Caleb leaves it on auto. This module is the single place that decides
 * what override (if any) to inject.
 *
 * Resolution order (first non-null wins):
 *   1. tenant.onboardingProfile.preferredRegister  (per-tenant, set by amber-id)
 *   2. tenant.preferredRegister                    (legacy / register-tenant CLI)
 *   3. process.env.LOOP_REGISTER_OVERRIDE          (deploy-time global override)
 *   4. null                                        (no override → fully auto)
 *
 * Allowed values (case-insensitive): "mother", "sister", "wife", "auto".
 * Anything else is treated as null (auto) so a typo never silently changes
 * Amber's tone.
 */

const ALLOWED = new Set(["mother", "sister", "wife"]);

function normalize(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (!v || v === "auto" || v === "default") return null;
  return ALLOWED.has(v) ? v : null;
}

/**
 * Resolve the configured register override for a tenant.
 * Returns "mother" | "sister" | "wife" | null.
 */
export function getPreferredRegister(tenant) {
  const profile = (tenant && tenant.onboardingProfile) || {};
  const fromProfile = normalize(profile.preferredRegister);
  if (fromProfile) return fromProfile;

  const fromTenant = normalize(tenant && tenant.preferredRegister);
  if (fromTenant) return fromTenant;

  const fromEnv = normalize(process.env.LOOP_REGISTER_OVERRIDE);
  if (fromEnv) return fromEnv;

  return null;
}

/**
 * Build the prompt fragment that pins the baseline register when one is
 * configured. Returns "" when no override is set so the existing
 * auto-selection logic in AMBER_VOICE_DOCTRINE_TEMPLATE wins.
 */
export function buildRegisterOverrideBlock(tenant) {
  const register = getPreferredRegister(tenant);
  if (!register) return "";
  return (
    `\nREGISTER PREFERENCE (tenant-configured baseline): ${register.toUpperCase()}.\n` +
    `Treat ${register.toUpperCase()} as the default register for this owner. ` +
    `The Selection order in the voice doctrine still applies — explicit user direction, grief/illness, ` +
    `evening/Sunday spiritual context all override this baseline — but when nothing else triggers a shift, ` +
    `stay in ${register.toUpperCase()}. Never announce the register.\n`
  );
}

export const ALLOWED_REGISTERS = Array.from(ALLOWED);
