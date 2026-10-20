import { App, LogLevel } from "@slack/bolt";
import { env } from "./env.js";
import { registerSubmit } from "./commands/submit.js";
import { registerActions } from "./actions/index.js";

const app = new App({
  token: env.slack.botToken,
  signingSecret: env.slack.signingSecret,
  socketMode: env.slack.socketMode,
  appToken: env.slack.socketMode ? env.slack.appToken : undefined,
  logLevel: LogLevel.INFO,
});

registerSubmit(app);
registerActions(app);

// Surface unhandled errors instead of silently dropping interactions.
app.error(async (error) => {
  console.error("Bolt app error:", error);
});

async function main() {
  if (env.slack.socketMode) {
    await app.start();
  } else {
    await app.start(env.port);
  }
  console.log(
    `BMA expenses bot running (${env.slack.socketMode ? "socket mode" : `http :${env.port}`}).`,
  );
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
