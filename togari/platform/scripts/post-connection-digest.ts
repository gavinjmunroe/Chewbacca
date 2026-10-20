/**
 * Post a client's warm-intro digest now, without waiting for the weekday
 * morning window.
 *
 *   npx tsx scripts/post-connection-digest.ts --client=serif_test
 *   npx tsx scripts/post-connection-digest.ts --client=serif
 *
 * For testing and for catching up after an outage. It posts whatever is
 * waiting in connection_paths for that client, exactly as the timer would,
 * to the client's digest channel (serif_test -> #test-channel). A path is
 * only ever posted once, so running this and then the timer firing does not
 * double-post; it does mean that morning's timer finds nothing new.
 *
 * Needs the same .env as the server: GCP credentials, SLACK_BOT_TOKEN.
 */

import { loadDotEnv } from "./load-env";

loadDotEnv();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=").trim() || undefined;
}

async function main(): Promise<void> {
  const { getReplybotClient, resolveChannel } = await import("../src/agents/replybot/client-config");
  const { postDigest } = await import("../src/connections/digest");

  const clientId = arg("client");
  const client = clientId ? getReplybotClient(clientId) : undefined;
  if (!client?.connections) {
    console.error(`\nUsage: --client=<id> for a client with connection research (e.g. serif_test).\n`);
    process.exit(1);
  }

  const n = await postDigest(client);
  console.log(
    n === 0
      ? `\nNothing waiting for ${client.clientId}. Run the Clay column on a row first.\n`
      : `\nPosted ${n} path(s) to ${resolveChannel(client, "connections")}.\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
