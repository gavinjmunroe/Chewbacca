/**
 * Send queued replies to Perplexity by hand (plan step 06).
 *
 *   npx tsx scripts/perplexity-dispatch.ts            # one reply
 *   npx tsx scripts/perplexity-dispatch.ts --limit=3
 *   npx tsx scripts/perplexity-dispatch.ts --dry-run  # show what would go
 *
 * Step 08 turns this into a cron. Until then this is how a reply actually
 * reaches the AI, and how step 11's end-to-end run is triggered.
 */

import { loadDotEnv } from "./load-env";

loadDotEnv();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=").trim() || undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const { findQueuedRows } = await import("../src/replies/store");
  const { dispatchQueued } = await import("../src/perplexity/dispatch");
  const { buildTaskMessage } = await import("../src/perplexity/task-message");
  const { perplexityAccountForClient } = await import("../src/perplexity/config");

  const limit = Number(arg("limit") ?? 1);

  if (has("dry-run")) {
    const rows = await findQueuedRows(limit);
    if (rows.length === 0) {
      console.log("\nNothing queued.\n");
      return;
    }
    for (const row of rows) {
      console.log(`\n──────── ${row.row_id} (client ${row.client_id ?? "?"}) ────────`);
      console.log(`would use Perplexity account: ${perplexityAccountForClient(row.client_id ?? "serif")}`);
      console.log(`\n${buildTaskMessage(row)}\n`);
    }
    console.log("Dry run — nothing was sent and no state changed.\n");
    return;
  }

  const outcomes = await dispatchQueued(limit);
  if (outcomes.length === 0) {
    console.log("\nNothing queued.\n");
    return;
  }
  for (const o of outcomes) {
    const line =
      o.status === "dispatched"
        ? `✓ ${o.rowId} -> dispatched (account ${o.account}, thread ${o.threadId ?? "none"}, task_state ${o.taskState ?? "?"})`
        : `${o.status === "skipped" ? "–" : "✗"} ${o.rowId} -> ${o.status}: ${o.reason ?? ""}`;
    console.log(line);
  }
  console.log(
    "\nA dispatched row is waiting on Perplexity to POST its draft to /replies/result.\n",
  );
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
