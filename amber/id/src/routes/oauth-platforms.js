/**
 * Public OAuth platform capability surface.
 *
 *   GET /v1/oauth/platforms   no auth — returns one row per platform with
 *                             whether the server has the env vars to start
 *                             an OAuth flow. The frontend uses this to render
 *                             disabled connect buttons with "Connect API keys
 *                             to activate this integration" copy instead of
 *                             letting the user click into a 503.
 *
 * No secrets are returned. `missing_config` lists env-var NAMES the deployer
 * still needs to set — names are non-sensitive and already documented in the
 * OAuth init.js files.
 */

import { configCheck, SUPPORTED_PLATFORMS } from "../oauth/lib/env-check.js";

export function registerOauthPlatformsRoute(app) {
  app.get("/v1/oauth/platforms", async () => {
    const platforms = SUPPORTED_PLATFORMS.map((id) => {
      const cfg = configCheck(id);
      return {
        platform: id,
        configured: cfg.configured,
        missing_config: cfg.missing_config,
      };
    });
    return { platforms };
  });
}
