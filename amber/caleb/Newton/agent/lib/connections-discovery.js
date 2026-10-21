/**
 * Connection discovery for the agent.
 *
 * Looks at the per-tenant secrets bag and returns a list of which third-
 * party services this user has actually linked (Google, Slack, LinkedIn,
 * etc). The capabilities block uses this to tell the model "Google
 * Calendar IS connected for foo@gmail.com — use it" or "Google is not
 * connected — if you try the tool you'll get back a connect link to
 * surface verbatim".
 *
 * Source of truth is the secrets bag — same place tools read from when
 * they run. No /v1/me/connections round-trip here; we'd just be reading
 * the same Firestore doc through a different door. Uses the existing
 * getSecret() client + circuit breaker so a degraded amber-id never
 * blocks the agent loop.
 */

import { getSecret } from "./secrets.js";

/**
 * Each entry: what to call the service in the prompt, which secrets-bag
 * keys to read for presence / account display, and the user-facing
 * capability line.
 */
const SERVICES = [
  {
    id: "google",
    name: "Google (Calendar + Gmail + Drive)",
    presenceKey: "GCAL_OAUTH_REFRESH",
    accountKey: "GOOGLE_OAUTH_ACCOUNT_EMAIL",
    connectedHint:
      "Use gcal_* / gmail_* / drive_* tools directly. They authenticate with the user's stored OAuth tokens.",
    disconnectedHint:
      "If asked about calendar / gmail / drive, attempt the tool anyway; the tool will return a connect link the user can click.",
  },
  {
    id: "slack",
    name: "Slack workspace",
    // Per-user xoxp drives "act AS the user" tools (DMs, search, status).
    // Workspace bot token alone is insufficient, so user-token presence
    // is the right signal for "Slack is wired up for this tenant".
    presenceKey: "SLACK_USER_TOKEN",
    // Composed at callback time as "<real_name> (<workspace> workspace)".
    accountKey: "SLACK_USER_ACCOUNT_NAME",
    connectedHint:
      "Use slack_* tools to read channels, list users, or send messages on behalf of the user.",
    disconnectedHint:
      "If asked to post to / read from Slack, attempt the tool; the failure result includes a connect link.",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    presenceKey: "LINKEDIN_OAUTH_REFRESH",
    accountKey: "LINKEDIN_OAUTH_ACCOUNT_HANDLE",
    connectedHint:
      "Use linkedin_* tools for profile, post composer, or org analytics.",
    disconnectedHint:
      "If asked about LinkedIn, attempt the tool; failure surfaces a connect link.",
  },
  {
    id: "notion",
    name: "Notion workspace",
    presenceKey: "NOTION_OAUTH_ACCESS",
    accountKey: "NOTION_OAUTH_WORKSPACE_NAME",
    connectedHint:
      "Use notion_* tools to read pages or write summaries back into the workspace.",
    disconnectedHint:
      "If asked about Notion, attempt the tool; failure surfaces a connect link.",
  },
  {
    id: "microsoft",
    name: "Microsoft (Outlook + Calendar + OneDrive + Teams)",
    presenceKey: "MS_OAUTH_REFRESH",
    accountKey: "MS_OAUTH_ACCOUNT_EMAIL",
    connectedHint:
      "Use outlook_* tools for Outlook mail, mscal_* for Microsoft Calendar, onedrive_* for OneDrive files, teams_* for Teams chat and presence.",
    disconnectedHint:
      "If asked about Outlook / Microsoft Calendar / OneDrive / Teams, attempt the relevant tool; failure returns a connect link the user can click verbatim.",
  },
  {
    id: "twitter",
    name: "X / Twitter",
    presenceKey: "TWITTER_OAUTH_REFRESH",
    accountKey: "TWITTER_OAUTH_HANDLE",
    connectedHint:
      "Use twitter_* tools to read engagement or post on behalf of the user.",
    disconnectedHint:
      "If asked about X / Twitter, attempt the tool; failure surfaces a connect link.",
  },
  {
    id: "github",
    name: "GitHub",
    // Classic OAuth Apps with non-expiring tokens — presence is keyed
    // off the access token itself (there is no refresh token).
    presenceKey: "GITHUB_OAUTH_ACCESS",
    accountKey: "GITHUB_OAUTH_ACCOUNT_HANDLE",
    connectedHint:
      "Use github_* tools to read or write the user's repos, issues, PRs, branches, gists, workflows, and notifications. Resolve short repo names against the connected handle.",
    disconnectedHint:
      "If asked about GitHub repos / issues / PRs / Actions, attempt the github_* tool; failure surfaces a connect link.",
  },
  {
    id: "railway",
    name: "Railway",
    // OAuth 2.0 + PKCE. Railway currently drops offline_access from the
    // granted scope set, so refresh_token comes back null in the bag.
    // Key presence on ACCESS so users with a valid access-only token
    // show as connected (the agent's resolveRailwayAuth accepts
    // access-only after PR #168). Parallel to medha-id #101 which made
    // the same change on the /v1/connections REST presence check.
    presenceKey: "RAILWAY_OAUTH_ACCESS",
    accountKey: "RAILWAY_OAUTH_ACCOUNT_EMAIL",
    connectedHint:
      "Use railway_* tools to trigger or roll back deploys, read deploy status + logs, list services, and list env var names. ALWAYS confirm verbally before triggering or rolling back a deploy — call railway_trigger_deploy / railway_rollback_deploy with confirm: true only after explicit user yes.",
    disconnectedHint:
      "If asked to deploy, redeploy, roll back, or read Railway logs, attempt the railway_* tool; failure surfaces a connect link.",
  },
];

/**
 * Discover which services the user has connected. Returns an array of
 * { id, name, connected, account, connectedHint, disconnectedHint }.
 * Best-effort: amber-id outage means everything reports disconnected,
 * which is fine — the agent will attempt tools and the tool error will
 * tell the user the same connect link either way.
 */
export async function discoverConnections(tenant) {
  if (!tenant) return SERVICES.map((s) => baseRow(s, false, null));
  const results = await Promise.all(
    SERVICES.map(async (s) => {
      const presence = await getSecret(tenant, s.presenceKey).catch(() => null);
      if (!presence) return baseRow(s, false, null);
      const account = s.accountKey
        ? await getSecret(tenant, s.accountKey).catch(() => null)
        : null;
      return baseRow(s, true, account);
    }),
  );
  return results;
}

function baseRow(svc, connected, account) {
  return {
    id: svc.id,
    name: svc.name,
    connected,
    account: account || null,
    connectedHint: svc.connectedHint,
    disconnectedHint: svc.disconnectedHint,
  };
}

/**
 * Render the dynamic OAuth-connections lines for the capabilities block.
 * For each service: one line declaring whether it's wired up and what
 * the model should do. No hardcoded "you do NOT have X" — connection
 * state is computed every request.
 */
export function renderConnectionsLines(connections) {
  if (!Array.isArray(connections) || connections.length === 0) return [];
  const lines = ["", "USER OAUTH CONNECTIONS (live, per-request lookup):"];
  for (const c of connections) {
    if (c.connected) {
      const who = c.account ? ` as ${c.account}` : "";
      lines.push(`- ${c.name}: CONNECTED${who}. ${c.connectedHint}`);
    } else {
      lines.push(`- ${c.name}: not connected. ${c.disconnectedHint}`);
    }
  }
  return lines;
}
