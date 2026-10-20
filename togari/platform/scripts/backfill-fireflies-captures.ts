/**
 * Patch L — Backfill togari_captures from historical Fireflies meetings.
 *
 * Paginates the Fireflies transcript list, dedups against togari_captures
 * by (source='fireflies', source_id=meetingId), and feeds each new
 * meeting through the same processFirefliesMeeting() helper the live
 * webhook uses — so the backfill and the live path stay byte-identical
 * in their handling.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-fireflies-captures.ts                          (dry run — default)
 *   pnpm tsx scripts/backfill-fireflies-captures.ts --apply                  (process unprocessed meetings)
 *   pnpm tsx scripts/backfill-fireflies-captures.ts --apply --since=2025-01-01
 *
 * Requires:
 *   - FIREFLIES_API_KEY
 *   - GCP_CREDENTIALS_BASE64 (or GOOGLE_CREDENTIALS_BASE64)
 *
 * Rate-limited at ~2 requests/sec against Fireflies (500ms sleep
 * between fetches). Logs progress every 10 meetings.
 */
/* eslint-disable no-console */

// tsx does not auto-load .env. Load it before any import that reads env vars
// (BigQuery creds, FIREFLIES_API_KEY, FIREFLIES_DEFAULT_TENANT_ID, etc.).
// NOTE: dotenv is not yet in package.json — run `pnpm add -D dotenv` first.
import 'dotenv/config';

import { processFirefliesMeeting } from '../src/transports/webhooks/fireflies';
import { findBySource } from '../src/core/tools/capture-ops';
import { tenantStorage } from '../src/tenant/context';

const FIREFLIES_ENDPOINT = 'https://api.fireflies.ai/graphql';
const PAGE_SIZE = 50;
const REQUEST_GAP_MS = 500;

interface ArgFlags {
  apply: boolean;
  since: string | null;
}

function parseArgs(): ArgFlags {
  const apply = process.argv.includes('--apply');
  let since: string | null = null;
  for (const a of process.argv) {
    if (a.startsWith('--since=')) {
      since = a.slice('--since='.length);
    }
  }
  return { apply, since };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FirefliesListItem {
  id: string;
  title: string;
  date: string;
}

async function fetchPage(skip: number, since: string | null): Promise<FirefliesListItem[]> {
  const apiKey = process.env.FIREFLIES_API_KEY;
  if (!apiKey) throw new Error('FIREFLIES_API_KEY not set');
  // Fireflies supports filtering by fromDate in their schema. We pass
  // it only when --since is supplied so the default behaviour is "all".
  const filter = since ? `, fromDate: "${since}"` : '';
  const query = `
    query {
      transcripts(limit: ${PAGE_SIZE}, skip: ${skip}${filter}) {
        id
        title
        date
      }
    }
  `;
  const res = await fetch(FIREFLIES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Fireflies HTTP ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { data?: { transcripts?: FirefliesListItem[] }; errors?: Array<{ message: string }> };
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Fireflies GraphQL: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  return json.data?.transcripts ?? [];
}

async function main(): Promise<void> {
  const { apply, since } = parseArgs();

  console.log(`[fireflies-backfill] mode=${apply ? 'APPLY' : 'DRY_RUN'}${since ? `  since=${since}` : ''}`);

  let skip = 0;
  let totalSeen = 0;
  let totalSkipped = 0;
  let totalIngested = 0;
  let totalFailed = 0;

  while (true) {
    const page = await fetchPage(skip, since);
    if (page.length === 0) break;

    for (const item of page) {
      totalSeen++;

      // Dedup: if already in captures, skip without re-fetching the
      // transcript body.
      const existing = await findBySource('fireflies', item.id);
      if (existing) {
        totalSkipped++;
        continue;
      }

      if (!apply) {
        console.log(`[fireflies-backfill]   would ingest ${item.id}  "${item.title}"  (${item.date})`);
        continue;
      }

      try {
        const result = await processFirefliesMeeting(item.id);
        if (result.skipped) {
          totalSkipped++;
        } else {
          totalIngested++;
          console.log(`[fireflies-backfill]   ingested ${result.captureId} from ${item.id}  "${item.title}"`);
        }
      } catch (err) {
        totalFailed++;
        console.error(`[fireflies-backfill]   FAILED ${item.id}:`, err instanceof Error ? err.message : err);
      }

      await sleep(REQUEST_GAP_MS);

      if (totalSeen % 10 === 0) {
        console.log(`[fireflies-backfill] progress: seen=${totalSeen} ingested=${totalIngested} skipped=${totalSkipped} failed=${totalFailed}`);
      }
    }

    if (page.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }

  console.log('[fireflies-backfill] complete.');
  console.log(`[fireflies-backfill]   seen:     ${totalSeen}`);
  console.log(`[fireflies-backfill]   ingested: ${totalIngested}`);
  console.log(`[fireflies-backfill]   skipped:  ${totalSkipped}`);
  console.log(`[fireflies-backfill]   failed:   ${totalFailed}`);
  if (!apply && totalSeen > 0) {
    console.log('[fireflies-backfill] re-run with --apply to execute.');
  }
}

// Wrap main() in tenantStorage.run() so getCurrentTenant() works downstream
// (findBySource → capturesTable → resolveDataset → getCurrentTenant). Mirrors
// the pattern src/server.ts uses for the Fireflies webhook route.
tenantStorage
  .run(
    {
      tenantId: process.env.FIREFLIES_DEFAULT_TENANT_ID ?? 'bma',
      tier: 'enterprise',
    },
    () => main(),
  )
  .catch((err) => {
    console.error('[fireflies-backfill] fatal:', err instanceof Error ? err.stack : err);
    process.exit(1);
  });
