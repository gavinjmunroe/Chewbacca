/**
 * Mint the link that installs Togari into a client's own Slack workspace.
 *
 *   npx tsx scripts/slack-install-link.ts --client=zeutara
 *
 * Send the printed link to an admin of that workspace, or open it yourself if
 * you are one. After they approve, Slack sends them to /slack/oauth_callback
 * on Railway, which stores the workspace's bot token and shows its team id.
 * Then set slackTeamId and slackChannelId on the client in client-config.ts.
 * The whole procedure is in docs/SLACK_EXTERNAL_WORKSPACE.md.
 *
 * Why a script and not a link from Slack's app settings: the link carries a
 * state signed with SLACK_CLIENT_SECRET, and the callback refuses anything
 * without one, Slack's own shareable URL included. SLACK_CLIENT_SECRET must
 * therefore be THE SAME here and in Railway, or the callback rejects the link.
 *
 * The link works for 72 hours, and whoever holds it can install Togari into a
 * workspace they admin. Send it to the person who will approve it, not to a
 * channel.
 *
 * Needs in env (this script reads .env itself): SLACK_CLIENT_ID,
 * SLACK_CLIENT_SECRET, and TOGARI_PUBLIC_BASE_URL only when the callback
 * isn't on togari-bma-prod.
 */

/* eslint-disable no-console */

import { loadDotEnv } from "./load-env";

loadDotEnv();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=").trim() || undefined;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  // Imported after loadDotEnv(), so nothing reads env before .env is in
  // place. Dynamic rather than top-level await: this project compiles to CJS.
  const { buildInstallUrl, slackRedirectUri } = await import("../src/transports/slack/oauth");
  const { getReplybotClient } = await import("../src/agents/replybot/client-config");

  const clientId = arg("client");
  if (!clientId) {
    fail(
      "Say which client this is for:\n" +
        "    npx tsx scripts/slack-install-link.ts --client=zeutara",
    );
  }

  for (const name of ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"]) {
    if (!process.env[name]) {
      fail(
        `${name} is not set. Copy it from the Slack app's Basic Information page ` +
          "into .env, the same value as Railway's.",
      );
    }
  }

  const client = getReplybotClient(clientId);
  if (client?.retired) {
    fail(`${client.displayName} is retired. Nothing to install.`);
  }
  if (!client) {
    // Not fatal: the client's registry entry may live on a branch that isn't
    // this checkout. The id only labels the install; slackTeamId in
    // client-config.ts is what routes cards.
    console.warn(`! "${clientId}" isn't a replybot client in this checkout. Minting anyway.`);
  }

  console.log(`\nInstall link for ${client?.displayName ?? clientId} (valid 72 hours):\n`);
  console.log(buildInstallUrl(clientId));
  console.log(
    `\nAfter approval Slack redirects to ${slackRedirectUri()}, which shows the\n` +
      "workspace ID. That URL must be listed under OAuth & Permissions → Redirect URLs.\n",
  );
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
