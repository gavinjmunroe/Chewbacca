/**
 * Save a client's Clay session, so Togari can read that client's Clay inbox
 * and campaigns from the server (src/integrations/clay/campaign-read.ts).
 *
 *   npx tsx scripts/save-clay-session.ts serif
 *
 * Sign in to app.clay.com as an account with access to the client's
 * workspace, open DevTools > Application > Cookies > https://app.clay.com,
 * copy the value of `claysession`, and paste it at the prompt. It is read
 * without echo and never takes a command-line argument, so it stays out of
 * shell history. The script then reads the workspace's campaigns once to
 * prove the session works.
 *
 * Needs in env (this script reads .env itself): TENANT_SECRETS_MASTER_KEY,
 * GCP_PROJECT_ID and GCP_CREDENTIALS_BASE64 (or GOOGLE_CREDENTIALS_BASE64).
 */
/* eslint-disable no-console */
import readline from "readline";
import { loadDotEnv } from "./load-env";

loadDotEnv();

function hidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    // readline clears the line as it redraws, so the prompt goes through it,
    // and what is pasted after shows as dots rather than the cookie.
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    let muted = false;
    out._writeToOutput = (s: string) => {
      if (!muted) process.stdout.write(s);
      else if (!/^[\r\n]/.test(s)) process.stdout.write(".");
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = true;
  });
}

async function main() {
  const clientId = process.argv[2];
  const { getReplybotClient, clayWorkspace } = await import(
    "../src/agents/replybot/client-config"
  );
  const client = clientId ? getReplybotClient(clientId) : null;
  const ws = client && clayWorkspace(client);
  if (!client || !ws) {
    console.error(
      `Usage: npx tsx scripts/save-clay-session.ts <client>. "${clientId ?? ""}" has no Clay workspace in client-config.ts.`,
    );
    process.exit(1);
  }
  const raw = await hidden(`claysession cookie for ${client.displayName}: `);
  const value = raw.replace(/^(?:__Host-)?claysession=/, "").split(";")[0];
  if (!value) {
    console.error("Nothing pasted; nothing saved.");
    process.exit(1);
  }
  const { saveSession, sequencerCampaigns } = await import(
    "../src/integrations/clay/campaign-read"
  );
  const { getTenantSecret, setTenantSecret } = await import(
    "../src/secrets/tenantSecrets"
  );
  // Kept until Clay accepts the new one, so a bad paste never replaces a
  // working session.
  const before = await getTenantSecret(client.clientId, "clay_session");
  await saveSession(client.clientId, value);
  try {
    const campaigns = await sequencerCampaigns(client.clientId, ws.workspaceId);
    console.log(
      `Saved. Clay workspace ${ws.workspaceId} answered with ${campaigns.length} Sequencer campaigns.`,
    );
  } catch (err) {
    await setTenantSecret(client.clientId, "clay_session", before || "");
    throw new Error(
      `Clay refused that cookie (${String(err)}); the previous session is kept.`,
    );
  }
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
