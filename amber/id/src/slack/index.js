/**
 * Mount the Slack identity-link routes onto a Fastify app instance.
 *
 * Intentionally separate from src/index.js so this PR doesn't conflict
 * with other in-flight parallel PRs that also add new route surfaces
 * (mcp, secrets-v2, etc.). Caleb merges the two-line mount manually:
 *
 *   import { registerSlackLinks } from "./slack/index.js";
 *   ...
 *   registerSlackLinks(app);
 *
 * after this PR lands.
 */

import { registerSlackLinksRoutes } from "../routes/slack-links.js";

export function registerSlackLinks(app) {
  registerSlackLinksRoutes(app);
}
