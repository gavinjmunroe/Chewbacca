/**
 * @togari/transports/slack — Installations in other workspaces
 *
 * Togari's home workspace (Amber Intelligence) authenticates with
 * SLACK_BOT_TOKEN, as it always has. A client that wants its reply cards in
 * its *own* Slack workspace installs the app there through
 * /slack/oauth_callback (see docs/SLACK_EXTERNAL_WORKSPACE.md), and that
 * install's bot token is kept here: encrypted in the tenant secret store, one
 * record per workspace.
 *
 * Only the replybot reaches for these tokens, through the client config's
 * `slackTeamId`. Everything else (the @Togari assistant, reminders, alerts)
 * stays on SLACK_BOT_TOKEN, and requests from other workspaces never get to
 * it (see workspace-gate.ts).
 */

import { getTenantSecret, setTenantSecret } from '../../secrets/tenantSecrets';
import { createLogger } from '../../observability/logger';

const logger = createLogger('slack/installations');

const KEY_NAME = 'SLACK_BOT_INSTALLATION';

// Every getTenantSecret is a BigQuery round trip, and a card post or button
// click can make several Slack calls. Bot tokens don't rotate on their own,
// so ten minutes of staleness only matters right after a reinstall.
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface SlackInstallation {
  teamId: string;
  teamName: string;
  enterpriseId: string | null;
  appId: string;
  botToken: string;
  botUserId: string;
  scope: string;
  installerUserId: string | null;
  /**
   * The replybot client the install link was minted for. A record of intent
   * only: what actually routes a client's cards to this workspace is
   * `slackTeamId` in client-config.ts.
   */
  clientId: string;
  installedAt: string;
}

const cache = new Map<string, { installation: SlackInstallation; expiresAt: number }>();

/** The secret store's tenant column holds a Slack team here, the way it
 *  holds an account for Perplexity's tokens. */
function slotFor(teamId: string): string {
  return `slack-team:${teamId}`;
}

export async function saveSlackInstallation(installation: SlackInstallation): Promise<void> {
  await setTenantSecret(slotFor(installation.teamId), KEY_NAME, JSON.stringify(installation));
  cache.set(installation.teamId, { installation, expiresAt: Date.now() + CACHE_TTL_MS });
  logger.info('Slack installation saved', {
    teamId: installation.teamId,
    teamName: installation.teamName,
    clientId: installation.clientId,
    scope: installation.scope,
  });
}

export async function getSlackInstallation(teamId: string): Promise<SlackInstallation | null> {
  const hit = cache.get(teamId);
  if (hit && hit.expiresAt > Date.now()) return hit.installation;

  const raw = await getTenantSecret(slotFor(teamId), KEY_NAME);
  if (!raw) {
    cache.delete(teamId);
    return null;
  }
  const installation = JSON.parse(raw) as SlackInstallation;
  cache.set(teamId, { installation, expiresAt: Date.now() + CACHE_TTL_MS });
  return installation;
}

/**
 * The bot token for a workspace. No team id means the home workspace, which
 * is what every client without a `slackTeamId` gets, so existing behaviour is
 * unchanged for them.
 */
export async function slackBotTokenFor(teamId?: string): Promise<string> {
  if (!teamId) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error('SLACK_BOT_TOKEN not set');
    return token;
  }

  const installation = await getSlackInstallation(teamId);
  if (!installation) {
    throw new Error(
      `Togari isn't installed in Slack workspace ${teamId}. Mint a link with ` +
        '`npx tsx scripts/slack-install-link.ts <clientId>` and have an admin ' +
        'of that workspace approve it.',
    );
  }
  return installation.botToken;
}

/** Test-only: forget cached installations. */
export function _resetSlackInstallationCache(): void {
  cache.clear();
}
