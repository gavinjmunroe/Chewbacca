/**
 * scripts/test-data-pull.ts
 *
 * Bypasses Stripe entirely — inserts a DataPullRequest row via BigQuery DML
 * (not the streaming API) so it can be immediately updated by processDataPull(),
 * then runs processDataPull() directly.
 *
 * Why DML instead of streaming insert?
 *   createDataPullRecord() uses the BigQuery streaming API, which holds rows in
 *   a buffer for several minutes. Any UPDATE against a buffered row fails with:
 *   "would affect rows in the streaming buffer, which is not supported"
 *   DML INSERT goes straight to storage and is immediately updatable.
 *
 * Usage:
 *   npx tsx scripts/test-data-pull.ts
 *
 * NOTE: Do NOT use --env-file=.env — Node v23's parser breaks on non-ASCII
 * characters in .env comments. This script loads .env via dotenv directly.
 *
 * Optional env overrides:
 *   TEST_CLIENT_ID   TEST_QUERY   TEST_COUNT
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ override: true }); // override tsx's broken --env-file pre-load
import { randomUUID } from 'crypto';
import { BigQuery } from '@google-cloud/bigquery';
import {
  processDataPull,
  getDataPullRequest,
} from '../src/agents/opportunity-notifications/data-pull-pipeline';
import type { DataPullRequest } from '../src/agents/opportunity-notifications/types';

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
  CLIENT_ID : process.env.TEST_CLIENT_ID ?? 'test-qa-client',
  QUERY     : process.env.TEST_QUERY     ?? 'VP of Sales at Series B SaaS companies in New York',
  COUNT     : Number(process.env.TEST_COUNT ?? 10),
};
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT = process.env.GCP_PROJECT_ID      ?? 'midyear-glazing-485303-u3';
const DATASET = process.env.BIGQUERY_DATASET    ?? 'togari_data_lake';
const FQT     = (t: string) => `\`${PROJECT}.${DATASET}.${t}\``;

function getBqClient(): BigQuery {
  const opts: ConstructorParameters<typeof BigQuery>[0] = { projectId: PROJECT };
  const b64  = process.env.GCP_CREDENTIALS_BASE64;
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (b64)   opts.credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
  else if (path) opts.keyFilename = path;
  return new BigQuery(opts);
}

function estimateCost(count: number): number {
  // Tier 1: $0.50 (1-250), Tier 2: $0.30 (251-1000), Tier 3: $0.20 (1001+)
  let cost = 0;
  const t1 = Math.min(count, 250);
  const t2 = Math.min(Math.max(count - 250, 0), 750);
  const t3 = Math.max(count - 1000, 0);
  cost += t1 * 0.50 + t2 * 0.30 + t3 * 0.20;
  return cost;
}

function log(msg: string) { process.stdout.write(`\n${msg}\n`); }
function sep() { process.stdout.write('─'.repeat(60) + '\n'); }

async function insertViaDml(request: DataPullRequest): Promise<void> {
  const bq  = getBqClient();
  const now = request.created_at;
  await bq.query({
    query: `
      INSERT INTO ${FQT('data_pull_requests')}
        (pull_id, client_id, natural_language_query, requested_count,
         datalake_matches, enrichment_needed, status,
         csv_url, cost_usd, stripe_checkout_id, created_at, updated_at)
      VALUES
        (@pull_id, @client_id, @query, @count,
         0, 0, 'pending',
         NULL, @cost, NULL, TIMESTAMP(@created_at), TIMESTAMP(@updated_at))
    `,
    params: {
      pull_id    : request.pull_id,
      client_id  : request.client_id,
      query      : request.natural_language_query,
      count      : request.requested_count,
      cost       : request.cost_usd,
      created_at : now,
      updated_at : now,
    },
  });
}

async function main() {
  sep();
  log('Togari Opportunity Engine — Data Pull Test (no Stripe)');
  sep();
  log(`Client ID : ${CONFIG.CLIENT_ID}`);
  log(`Query     : ${CONFIG.QUERY}`);
  log(`Count     : ${CONFIG.COUNT}`);
  sep();

  // ── Step 1: Insert via DML so the row is immediately updatable ─────────────
  log('Step 1/3 — Inserting data_pull_requests record via BigQuery DML...');
  const now     = new Date().toISOString();
  const request: DataPullRequest = {
    pull_id               : randomUUID(),
    client_id             : CONFIG.CLIENT_ID,
    natural_language_query: CONFIG.QUERY,
    requested_count       : CONFIG.COUNT,
    datalake_matches      : 0,
    enrichment_needed     : 0,
    status                : 'pending',
    csv_url               : null,
    cost_usd              : estimateCost(CONFIG.COUNT),
    stripe_checkout_id    : null,
    created_at            : now,
    updated_at            : now,
  };

  try {
    await insertViaDml(request);
    log(`  pull_id   : ${request.pull_id}`);
    log(`  status    : ${request.status}`);
    log(`  est. cost : $${request.cost_usd.toFixed(2)}`);
  } catch (err) {
    process.stderr.write(`\nFAILED at Step 1 (BigQuery insert): ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }

  // ── Step 2: Run processDataPull directly ───────────────────────────────────
  log('\nStep 2/3 — Running processDataPull() (datalake → Exa → Clay)...');
  log('  Watch stderr for pipeline progress logs.\n');
  try {
    const result = await processDataPull(request);
    sep();
    log('Step 2 complete.');
    log(`  Contacts returned : ${result.contacts.length}`);
    log(`  Datalake hits     : ${result.total_from_datalake}`);
    log(`  Enriched new      : ${result.total_enriched_new}`);
    log(`  CSV URL           : ${result.csv_download_url ?? '(none — check GCS_DATA_PULL_BUCKET)'}`);
  } catch (err) {
    process.stderr.write(`\nFAILED at Step 2 (processDataPull): ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }

  // ── Step 3: Verify final status in BigQuery ────────────────────────────────
  log('\nStep 3/3 — Verifying final record in BigQuery...');
  try {
    const final = await getDataPullRequest(request.pull_id);
    if (!final) {
      process.stderr.write('\nWARN: record not found after processing.\n');
    } else {
      log(`  status     : ${final.status}`);
      log(`  csv_url    : ${final.csv_url ?? '(not set)'}`);

      sep();
      if (['ready', 'completed', 'delivered'].includes(final.status)) {
        log('PASS — data pull pipeline completed successfully.');
      } else {
        log(`WARN — unexpected final status: "${final.status}". Check stderr logs above.`);
      }
    }
  } catch (err) {
    process.stderr.write(`\nFAILED at Step 3 (verify): ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }

  sep();
}

main();
