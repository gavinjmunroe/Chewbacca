import { BigQueryClient } from "../src/bigquery/client";
import { resolveDataset } from "../src/services/dataset-resolver";

const project = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const dataset = resolveDataset();
const tableName = `\`${project}.${dataset}.reply_card_actions\``;
const bq = new BigQueryClient(
  project,
  null,
  process.env.GCP_CREDENTIALS_BASE64 ||
    process.env.GOOGLE_CREDENTIALS_BASE64 ||
    null,
);

async function main() {
  if (process.argv.includes("--apply")) {
    await bq.getClient().query({
      query: `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS reply_thread_id STRING`,
      useLegacySql: false,
    });
  }
  const [metadata] = await bq
    .getClient()
    .dataset(dataset)
    .table("reply_card_actions")
    .getMetadata();
  const ready =
    metadata.schema?.fields?.some(
      (field: { name?: string; type?: string }) =>
        field.name === "reply_thread_id" && field.type === "STRING",
    ) || false;
  const { rows } = ready
    ? await bq.executeQuery(
        `SELECT COUNT(*) AS count FROM ${tableName}
      WHERE client_id = @clientId AND action IN ('skipped', 'done') AND reply_thread_id IS NULL`,
        { clientId: "zeutara" },
      )
    : { rows: [] };
  console.log(
    JSON.stringify({
      ready,
      legacyDecisions: ready ? Number(rows[0]?.count || 0) : null,
    }),
  );
  if (!ready) process.exitCode = 1;
}
main().catch(() => {
  console.error("Card action thread migration failed");
  process.exitCode = 1;
});
