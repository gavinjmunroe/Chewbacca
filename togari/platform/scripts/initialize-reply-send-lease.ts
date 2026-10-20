import { BigQueryClient } from "../src/bigquery/client";

const project = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const table = `\`${project}.togari_data_lake.poller_leases\``;
const bq = new BigQueryClient(
  project,
  null,
  process.env.GCP_CREDENTIALS_BASE64 ||
    process.env.GOOGLE_CREDENTIALS_BASE64 ||
    null,
);
const name = "reply-send:zeutara";

async function main() {
  if (process.argv.includes("--apply")) {
    await bq.executeWrite(
      `INSERT INTO ${table} (name, holder, until)
       SELECT @name, '', CURRENT_TIMESTAMP()
       FROM UNNEST([1]) AS seed
       WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE name = @name)`,
      { name },
    );
  }
  const { rows } = await bq.executeQuery(
    `SELECT COUNT(*) AS count FROM ${table} WHERE name = @name`,
    { name },
  );
  const count = Number(rows[0]?.count || 0);
  console.log(JSON.stringify({ lease: name, rows: count, ready: count === 1 }));
  if (count !== 1) process.exitCode = 1;
}

main().catch(() => {
  console.error("Send lease initialization failed");
  process.exitCode = 1;
});
