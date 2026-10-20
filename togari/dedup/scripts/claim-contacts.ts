/**
 * scripts/claim-contacts.ts
 *
 * Reassign the 2,135 legacy contacts (owner_id = 'env-default') to a real
 * Auth0 user. Use when a new BMA member needs the historical pool visible
 * under their account so Clay matches actually return results.
 *
 * Usage:
 *   npx tsx scripts/claim-contacts.ts <auth0_sub>
 *   npx tsx scripts/claim-contacts.ts <auth0_sub> --dry-run
 *
 * Example:
 *   npx tsx scripts/claim-contacts.ts auth0|6123abcd456
 *
 * What it does:
 *   1. Counts rows currently owned by 'env-default' in contacts + social_connections
 *   2. With --dry-run: prints the count and exits
 *   3. Without --dry-run: UPDATEs every env-default row to the supplied owner_id
 *   4. Prints before/after counts
 */

import { BigQuery } from "@google-cloud/bigquery";

const PROJECT = process.env.GCP_PROJECT_ID ?? "midyear-glazing-485303-u3";
const DATASET = "togari_dnc";
const LEGACY_OWNER = "env-default";

function bq(): BigQuery {
  const opts: ConstructorParameters<typeof BigQuery>[0] = {
    projectId: PROJECT,
  };
  const b64 = process.env.GCP_CREDENTIALS_BASE64;
  if (b64) opts.credentials = JSON.parse(Buffer.from(b64, "base64").toString());
  return new BigQuery(opts);
}

async function countOwned(
  client: BigQuery,
  table: string,
  ownerId: string,
): Promise<number> {
  const [rows] = await client.query({
    query: `SELECT COUNT(*) AS n FROM \`${PROJECT}.${DATASET}.${table}\` WHERE owner_id = @owner_id`,
    params: { owner_id: ownerId },
    useLegacySql: false,
  });
  return Number((rows[0] as { n: number }).n);
}

async function reassign(
  client: BigQuery,
  table: string,
  fromOwner: string,
  toOwner: string,
): Promise<number> {
  const [job] = await client.createQueryJob({
    query: `UPDATE \`${PROJECT}.${DATASET}.${table}\` SET owner_id = @to_owner WHERE owner_id = @from_owner`,
    params: { from_owner: fromOwner, to_owner: toOwner },
    useLegacySql: false,
  });
  const [meta] = await job.getMetadata();
  const stats = meta.statistics?.query;
  return Number(stats?.numDmlAffectedRows ?? 0);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const ownerArg = argv.find((a) => !a.startsWith("--"));

  if (!ownerArg) {
    process.stderr.write(
      "Usage: npx tsx scripts/claim-contacts.ts <auth0_sub> [--dry-run]\n",
    );
    process.exit(2);
  }

  const client = bq();
  const tables: Array<"contacts" | "social_connections"> = [
    "contacts",
    "social_connections",
  ];

  process.stdout.write(
    `\nProject: ${PROJECT}\nDataset: ${DATASET}\nLegacy owner: ${LEGACY_OWNER}\nNew owner:    ${ownerArg}\nMode:         ${dryRun ? "DRY RUN" : "LIVE"}\n\n`,
  );

  for (const t of tables) {
    const legacyBefore = await countOwned(client, t, LEGACY_OWNER);
    const targetBefore = await countOwned(client, t, ownerArg);
    process.stdout.write(
      `${t}: ${legacyBefore} rows owned by '${LEGACY_OWNER}', ${targetBefore} already owned by target\n`,
    );

    if (!dryRun && legacyBefore > 0) {
      const moved = await reassign(client, t, LEGACY_OWNER, ownerArg);
      process.stdout.write(`  -> reassigned ${moved} rows\n`);
    }
  }

  if (dryRun) {
    process.stdout.write(
      `\n[dry-run] no rows changed. Re-run without --dry-run to apply.\n`,
    );
  } else {
    process.stdout.write(`\nDone.\n`);
  }
}

main().catch((err) => {
  process.stderr.write(
    `Error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
