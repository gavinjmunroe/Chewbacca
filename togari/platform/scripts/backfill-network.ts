/**
 * Load connection research already paid for into the shared network
 * (togari_core.network_*, migration 0049).
 *
 *   npx tsx scripts/backfill-network.ts                    (dry run: counts only)
 *   npx tsx scripts/backfill-network.ts --apply
 *   npx tsx scripts/backfill-network.ts --apply --client=serif --limit=50
 *
 * Reads every connection_items row that has a result, oldest first, and
 * records it exactly as POST /connections/result now does live. A row served
 * from the network (research_mode 'reuse') is skipped: nothing was researched
 * for it. A top-up is recorded as one, without its subject marked researched. Safe to re-run:
 * every write is a MERGE on a derived key, so a row recorded twice changes
 * nothing but last_seen_at. Use it after applying the migration, and to replay
 * any result whose live write logged network.record_failed.
 *
 * Needs the same .env as the server: GCP credentials and each client's
 * target-sheet URL (used to tag orgs with the sheet's segment and domain; a
 * client whose sheet can't be read is still recorded, without the tags).
 */

import { loadDotEnv } from "./load-env";

loadDotEnv();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=").trim() || undefined;
}

async function main(): Promise<void> {
  const { BigQueryClient } = await import("../src/bigquery/client");
  const { getConnectionItem, researchModeColumns } = await import("../src/connections/store");
  const { parseReused } = await import("../src/connections/queue");
  const { ConnectionResultPayload } = await import("../src/connections/types");
  const { connectionSourcesFor } = await import("../src/connections/task-message");
  const { loadTargets } = await import("../src/connections/targets");
  const { recordNetwork } = await import("../src/network/store");

  const apply = process.argv.includes("--apply");
  const clientId = arg("client");
  const limit = Number(arg("limit") ?? "0");
  const project = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

  const bq = new BigQueryClient(
    project,
    null,
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64 || null,
  );
  const withMode = await researchModeColumns();
  const { rows } = await bq.executeQuery(
    `SELECT row_id, client_id, result_json, updated_at
            ${withMode ? ", research_mode, reused_result_json" : ""}
       FROM \`${project}.togari_data_lake.connection_items\`
      WHERE result_json IS NOT NULL
        ${withMode ? "AND IFNULL(research_mode, 'full') != 'reuse'" : ""}
        AND (@clientId IS NULL OR client_id = @clientId)
      ORDER BY updated_at
      ${limit > 0 ? `LIMIT ${Math.floor(limit)}` : ""}`,
    { clientId: clientId ?? null },
  );
  console.log(`\n${rows.length} researched people${clientId ? ` for ${clientId}` : ""}.`);
  if (!apply) {
    console.log("Dry run. Re-run with --apply to write them to the network.\n");
    return;
  }

  const targetsByClient = new Map<string, Awaited<ReturnType<typeof loadTargets>> | null>();
  let ok = 0;
  let failed = 0;
  for (const r of rows) {
    const rowId = String(r.row_id);
    const item = await getConnectionItem(rowId);
    const parsed = ConnectionResultPayload.safeParse(JSON.parse(String(r.result_json)));
    if (!item || !parsed.success) {
      console.warn(`  skipped ${rowId}: ${item ? "result_json does not parse" : "row not found"}`);
      failed++;
      continue;
    }
    const cid = item.client_id ?? "";
    if (!targetsByClient.has(cid)) {
      try {
        targetsByClient.set(cid, await loadTargets(connectionSourcesFor(cid).targetsUrl));
      } catch (err) {
        console.warn(`  no target sheet for ${cid || "(no client)"}: ${(err as Error).message}`);
        targetsByClient.set(cid, null);
      }
    }
    // BigQuery returns TIMESTAMP as { value: "..." }.
    const ts = r.updated_at as { value?: string } | string | null;
    const at = typeof ts === "object" && ts !== null ? ts.value : ts;
    const opts =
      r.research_mode === "topup"
        ? {
            subjectResearched: false,
            priorColleagueIds: parseReused(r.reused_result_json ? String(r.reused_result_json) : null)
              ?.colleague_ids,
          }
        : {};
    const recorded = await recordNetwork(
      item,
      parsed.data,
      targetsByClient.get(cid) ?? null,
      new Date(String(at)),
      opts,
    );
    if (recorded) ok++;
    else failed++;
  }
  console.log(`\nRecorded ${ok}, failed ${failed}.\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
