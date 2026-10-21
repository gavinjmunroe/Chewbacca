#!/usr/bin/env node
/**
 * replay-dlq.js — replay every entry in the BigQuery dead-letter queue.
 *
 * Flaw #38: when BQ writes fail (network, schema, quota) the row gets
 * appended to /tmp/medha-pdw-dlq.jsonl by bq-dlq.js. This script reads
 * the file and re-attempts every entry against the live BQ client.
 *
 * Usage:
 *   node src/scripts/replay-dlq.js
 *   MEDHA_PDW_DLQ_PATH=./tmp.jsonl node src/scripts/replay-dlq.js
 *
 * Exit codes:
 *   0   one full pass completed
 *   1   BQ client not reachable / fatal error
 */

import { replayDlq, dlqPath } from "../pdw/bq-dlq.js";
import { insertRow, isReady } from "../pdw/bq-client.js";

async function main() {
  if (!isReady()) {
    console.error(
      `[replay-dlq] BQ client not ready — set GCP_PROJECT_ID + creds`,
    );
    process.exit(1);
  }
  console.log(`[replay-dlq] reading from ${dlqPath()}`);
  const result = await replayDlq((table, row) =>
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
