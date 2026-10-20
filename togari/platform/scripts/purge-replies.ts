/**
 * Clear a client's reply queue, so the loop restarts on a clean slate.
 *
 *   npx tsx scripts/purge-replies.ts --client=serif                      # dry run
 *   npx tsx scripts/purge-replies.ts --client=serif --apply
 *   npx tsx scripts/purge-replies.ts --client=serif --states=queued,failed --apply
 *   npx tsx scripts/purge-replies.ts --client=serif --newer-than=48 --keep   # spare the fresh ones
 *
 * Dry run by default, and --client is required: this deletes, and a purge that
 * quietly took every client with it would be unrecoverable.
 *
 * Default states are queued,failed — the backlog. 'done' is excluded unless
 * asked for, and that is not tidiness:
 *
 *   reply_items is the dedup ledger. Intake is a MERGE on row_id with no
 *   WHEN MATCHED branch, so a repeated POST of a row we already hold changes
 *   nothing — that is the ONLY thing stopping a Clay resend from drafting and
 *   carding a reply a second time, and Clay resends routinely. Delete a 'done'
 *   row and the next resend of it is indistinguishable from a new reply: it is
 *   drafted again, billed again, and posts a second card for a prospect who
 *   was already answered. Dropping 'queued' or 'failed' is safe by comparison,
 *   because neither ever produced a card.
 *
 * Deleting rows does not disturb Slack cards already in the channel. Send
 * reads the draft and the Clay ids out of the button value, never out of
 * BigQuery; the row is only deleted afterwards as bookkeeping.
 */

import { loadDotEnv } from "./load-env";

loadDotEnv();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=").trim() || undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const { BigQueryClient } = await import("../src/bigquery/client");
  const { resolveDataset } = await import("../src/services/dataset-resolver");

  const client = arg("client");
  if (!client) {
    process.stderr.write(
      "--client=<id> is required. Refusing to purge every client at once.\n",
    );
    process.exit(2);
  }

  const states = (arg("states") ?? "queued,failed")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (states.includes("done") && !has("i-mean-it")) {
    process.stderr.write(
      "Refusing to delete 'done' rows without --i-mean-it.\n" +
        "Those rows are what stops a Clay resend from drafting and carding an\n" +
        "already-answered reply a second time. See the header of this file.\n",
    );
    process.exit(2);
  }

  // Spare anything newer than N hours — a purge of stale backlog should not
  // take replies that arrived this morning and nobody has looked at yet.
  const keepHours = has("keep") ? Number(arg("newer-than") ?? 48) : 0;

  const project = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
  const bq = new BigQueryClient(
    project,
    null,
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64 || null,
  );
  const table = `\`${project}.${resolveDataset()}.reply_items\``;

  const where =
    `client_id = @client AND state IN UNNEST(@states)` +
    (keepHours > 0
      ? ` AND created_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${Math.floor(keepHours)} HOUR)`
      : "");
  const params = { client, states };

  const { rows } = await bq.executeQuery(
    `SELECT row_id, state, from_address, created_at,
            TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), created_at, HOUR) AS age_h,
            SUBSTR(REGEXP_REPLACE(body, r'\\s+', ' '), 1, 70) AS head
       FROM ${table} WHERE ${where} ORDER BY created_at`,
    params,
  );

  process.stdout.write(
    `client=${client}  states=${states.join(",")}` +
      (keepHours > 0 ? `  sparing anything newer than ${keepHours}h` : "") +
      `\n${rows.length} row(s) matched\n\n`,
  );
  for (const r of rows) {
    process.stdout.write(
      `  ${String(r.age_h).padStart(4)}h  ${String(r.state).padEnd(7)} ${r.from_address ?? "?"}\n` +
        `         ${r.head}\n`,
    );
  }

  if (rows.length === 0) return;

  if (!has("apply")) {
    process.stdout.write(
      `\nDry run — nothing deleted. Re-run with --apply.\n` +
        `These replies are not recoverable afterwards: the queue row is the only\n` +
        `copy Togari holds of what the prospect wrote.\n`,
    );
    return;
  }

  const res = await bq.executeDelete(`DELETE FROM ${table} WHERE ${where}`, params);
  process.stdout.write(
    `\n✓ deleted ${Number(res.numDmlAffectedRows ?? "0")} row(s)\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
