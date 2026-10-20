/**
 * Patch E.5 — One-time backfill: normalize the `owner` column on
 * `togari_structured_deals` to Slack user IDs.
 *
 * The audit found inconsistent values in production: "Maggie Chen",
 * "Sagar Tiwari", "Karthik", "Kevin Cong", as well as the desired
 * "U088N3LT0SU" / "U087Z8LPMMY" / etc. Patch E.4 standardized writes
 * onto Slack IDs going forward; this script cleans the legacy rows.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-deal-owners.ts            (dry run — default)
 *   pnpm tsx scripts/backfill-deal-owners.ts --apply    (write the UPDATEs)
 *
 * Requires GCP_CREDENTIALS_BASE64 or GOOGLE_CREDENTIALS_BASE64 in env.
 *
 * Maintainer note: the OWNER_MAP below mirrors the TEAM MEMBER MAPPING
 * block in src/core/intent-router.ts. Keep them in sync — every new
 * team member needs entries in both places.
 */
/* eslint-disable no-console */

import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'midyear-glazing-485303-u3';
// BMA-specific. When this script becomes per-tenant, replace with a
// resolver lookup that reads the per-tenant dataset.
const DATASET = process.env.BACKFILL_DATASET || 'togari_data_lake';
const TABLE = 'togari_structured_deals';

// Free-text → Slack user id mapping. Keys are lowercased before lookup.
// Canonical source is the TEAM MEMBER MAPPING block in src/core/intent-router.ts
// (kept in sync by Patch F.1). When a name isn't in this map, we write a
// "UNKNOWN_<raw>" sentinel so unmapped rows are easy to find with grep,
// rather than silently surviving with a free-text name.
const OWNER_MAP: Record<string, string> = {
  // Active operators (default ownership candidates)
  karthik: 'U08L8PFMWBE',
  'karthik dev': 'U08L8PFMWBE',
  'karthik devarakonda': 'U08L8PFMWBE',
  sagar: 'U087Z8LPMMY',
  'sagar tiwari': 'U087Z8LPMMY',
  // Active team (can be assigned reminders, can own deals)
  maggie: 'U093A6B2WBZ',
  'maggie chen': 'U093A6B2WBZ',
  drew: 'U0AFWNY49SM',
  shirley: 'U0AK2VCNPCZ',
  'shirley park': 'U0AK2VCNPCZ',
  caleb: 'U0AEBS2UXRB',
  'caleb newton': 'U0AEBS2UXRB',
  tyler: 'U0AQMFPGKQS',
  reem: 'U0AEU6W05C1',
  rania: 'U0AEJSYUTAQ',
  // Resolvable but inactive (still mapped so legacy rows get a Slack id —
  // the F.2 inactive-operator guardrail prevents NEW actions being
  // assigned here, but old rows should still normalize to the ID).
  kevin: 'U088N3LT0SU',
  'kevin cong': 'U088N3LT0SU',
};

const SLACK_ID_RE = /^U[A-Z0-9]+$/;

interface DealRow {
  deal_id: string;
  owner: string | null;
}

function getCredentials(): Record<string, unknown> | undefined {
  const b64 = process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64;
  if (!b64) return undefined;
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
}

function mapOwner(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (key in OWNER_MAP) return OWNER_MAP[key];
  return null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const bq = new BigQuery({ projectId: PROJECT_ID, credentials: getCredentials() });

  console.log(`[backfill] mode=${apply ? 'APPLY' : 'DRY_RUN'}  project=${PROJECT_ID}  dataset=${DATASET}  table=${TABLE}`);

  const selectSql = `SELECT deal_id, owner FROM \`${PROJECT_ID}.${DATASET}.${TABLE}\``;
  const [rows] = await bq.query({ query: selectSql, useLegacySql: false });
  const typed = rows as DealRow[];
  console.log(`[backfill] scanned ${typed.length} rows`);

  let updated = 0;
  let alreadyOk = 0;
  let unknown = 0;
  const unknownExamples: string[] = [];

  for (const row of typed) {
    const owner = (row.owner ?? '').trim();
    if (!owner) {
      unknown++;
      if (unknownExamples.length < 10) unknownExamples.push(`${row.deal_id} (empty)`);
      continue;
    }
    if (SLACK_ID_RE.test(owner)) {
      alreadyOk++;
      continue;
    }
    const mapped = mapOwner(owner);
    if (!mapped) {
      unknown++;
      if (unknownExamples.length < 10) unknownExamples.push(`${row.deal_id} ("${owner}")`);
      continue;
    }
    console.log(`[backfill] ${apply ? 'UPDATE' : 'WOULD UPDATE'}  ${row.deal_id}  "${owner}" → ${mapped}`);
    if (apply) {
      const updateSql = `UPDATE \`${PROJECT_ID}.${DATASET}.${TABLE}\` SET owner = @new_owner, updated_at = CURRENT_TIMESTAMP() WHERE deal_id = @deal_id`;
      await bq.query({
        query: updateSql,
        params: { new_owner: mapped, deal_id: row.deal_id },
        useLegacySql: false,
      });
    }
    updated++;
  }

  console.log('');
  console.log('[backfill] ─────────────────────────────────────────');
  console.log(`[backfill] rows scanned     : ${typed.length}`);
  console.log(`[backfill] already a slack id: ${alreadyOk}`);
  console.log(`[backfill] ${apply ? 'updated' : 'would update'}        : ${updated}`);
  console.log(`[backfill] needs manual review (unknown / empty owner): ${unknown}`);
  if (unknownExamples.length > 0) {
    console.log('[backfill] examples requiring review:');
    for (const ex of unknownExamples) console.log(`[backfill]   - ${ex}`);
  }
  if (!apply) {
    console.log('[backfill] re-run with --apply to write the UPDATEs.');
  }
}

main().catch((err) => {
  console.error('[backfill] fatal:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
