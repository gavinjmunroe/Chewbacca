#!/usr/bin/env node
/**
 * replay-dlq.js — replay every entry in the BigQuery dead-letter queue.
 *
 * Flaw #38: when BQ writes fail (network, schema, quota) the row gets
 * appended to /tmp/medha-pdw-dlq.jsonl by bq-dlq.js. This script reads
 * the file and re-attempts every entry against the live BQ client.
 *
 * Usage:
 *   node Newton/agent/scripts/replay-dlq.js
 *   MEDHA_PDW_DLQ_PATH=./tmp.jsonl node Newton/agent/scripts/replay-dlq.js
 *
 * Exit codes:
 *   0   one full pass completed (succeeded + remaining + dropped all logged)
 *   1   BQ client not reachable / fatal error
 *
 * The proactive-runner schedules an in-process replay every 60s (flaw
 * #37); this CLI is for manual backfills after a long outage.
 */

import { replayDlq, dlqPath } from "../lib/pdw/bq-dlq.js";
import { insertRow, isReady } from "../lib/pdw/bq-client.js";

async function main() {
  if (!isReady()) {
    console.error(
      `[replay-dlq] BQ client not ready — set GCP_PROJECT_ID + creds`,
    );
    process.exit(1);
  }
  console.log(`[replay-dlq] reading from ${dlqPath()}`);
  const result = await replayDlq((table, row) =>
    // Pass skipDlq:true so a fresh failure doesn't re-enqueue the
    // same row inside the same replay pass (the DLQ updates the
    // entry's attempts counter instead).
    insertRow(table, row, { skipDlq: true }),
  );
  console.log(
    `[replay-dlq] done — tried=${result.tried} succeeded=${result.succeeded} dropped=${result.dropped} remaining=${result.remaining}`,
  );
}

main().catch((err) => {
  console.error(`[replay-dlq] fatal: ${err.stack || err.message}`);
  process.exit(1);
});
