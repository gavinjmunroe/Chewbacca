/**
 * Entry point for the per-tenant secrets v2 surface.
 *
 * Caleb hand-merges the mount into src/index.js as a separate change so this
 * PR stays additive and conflict-free with parallel work that also touches
 * the server bootstrap. The two lines required are:
 *
 *   import { registerSecretsV2 } from "./secrets-v2/index.js";
 *   registerSecretsV2(app);
 */

import { registerSecretsV2 as registerRoutes } from "../routes/secrets-v2.js";

export function registerSecretsV2(app) {
  registerRoutes(app);
}

export { isKekConfigured } from "./crypto.js";
