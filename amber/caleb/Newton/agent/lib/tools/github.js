/**
 * github.js — GitHub tools (barrel export over the OAuth-backed surface
 * in ./github/).
 *
 * Token resolution: per-tenant OAuth only. The OAuth callback in medha-id
 * persists GITHUB_OAUTH_ACCESS into the secrets bag; this surface reads
 * it via the identity-bridged secrets client. There is intentionally no
 * env fallback (per CLAUDE.md's per-tenant isolation rule) and no
 * GITHUB_PAT fallback (that path was removed when OAuth shipped — every
 * tenant must reconnect via /connect).
 *
 * To extend with a new tool: add the schema + dispatcher case in
 * ./github/tools.js. The dispatcher's exact-name routing in
 * tool-dispatcher.js reads GITHUB_TOOL_NAMES from this barrel.
 */

import { registerCapability } from "../capabilities.js";
import { executeGithubTool } from "./github/tools.js";

export {
  GITHUB_TOOLS,
  GITHUB_TOOL_NAMES,
  executeGithubTool,
  githubStatus,
} from "./github/tools.js";

export {
  githubFetch,
  githubFetchPaginated,
  resolveRepoName,
  resolveGithubAuth,
  buildNotConnected,
  connectPageUrl,
} from "./github/client.js";

/**
 * Back-compat alias for the old camelCase dispatcher name. Existing
 * imports in tool-dispatcher and any service code keep working.
 */
export const executeGitHubTool = executeGithubTool;

registerCapability(
  "_tools_GitHub",
  "Read + write repos, issues, PRs, branches, gists, GitHub Actions, notifications, and code search across the connected user's accessible repos",
);
