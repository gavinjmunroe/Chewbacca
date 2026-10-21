/**
 * Sign in with Apple.
 *
 * The flow moved to routes/social-auth.js when Google joined it: the two are the
 * same two-step reconciliation and the parts that differ are four values, so a
 * second copy of the most security-critical route in the service would have been
 * a second place to fix every break. This file stays so that
 * `registerAppleAuthRoutes` keeps its name and its import path.
 */
export { registerAppleAuthRoutes } from "./social-auth.js";
