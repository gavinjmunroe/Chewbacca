/**
 * Read-only inspection ahead of the one-time context cleanup (duplicate +
 * misattached rows under spinach_records_425af0 / freedom_c5624c).
 *
 * Usage:  set -a; source .env; set +a; npx tsx scripts/inspect-misattached-context.ts
 */
/* eslint-disable no-console */

import { BigQueryClient } from "../src/bigquery/client";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DATASET = "togari_data_lake";
const t = (name: string) => `\`${PROJECT_ID}.${DATASET}.${name}\``;

const bq = new BigQueryClient(
  PROJECT_ID,
  null,
  process.env.GCP_CREDENTIALS_BASE64 ||
    process.env.GOOGLE_CREDENTIALS_BASE64 ||
    null,
);

async function main() {
  const { rows: clients } = await bq.executeQuery(
    `SELECT client_id, client_brand, name, primary_domain, primary_email, source
       FROM ${t("clients")}
      WHERE LOWER(name) LIKE '%amber%' OR LOWER(name) LIKE '%blue modern%'
         OR client_id IN ('spinach_records_425af0','freedom_c5624c','blue_modern_advisory_c5d8f0')`,
  );
  console.log("=== relevant clients ===");
  console.log(JSON.stringify(clients, null, 2));

  const { rows: ctx } = await bq.executeQuery(
    `SELECT context_id, client_id, client_brand, source, source_ref, title,
            occurred_at, created_at, LENGTH(content) AS content_len
       FROM ${t("client_context")}
      WHERE client_id IN ('spinach_records_425af0','freedom_c5624c')
      ORDER BY client_id, source, source_ref, created_at`,
  );
  console.log("\n=== context rows under spinach/freedom ===");
  for (const r of ctx) {
    console.log(
      [
        r.client_id,
        r.context_id,
        r.source,
        r.source_ref,
        JSON.stringify(r.title),
        `occurred=${JSON.stringify(r.occurred_at)}`,
        `created=${JSON.stringify(r.created_at)}`,
        `len=${r.content_len}`,
      ].join(" | "),
    );
  }

  const { rows: attendees } = await bq.executeQuery(
    `SELECT context_id, title, SUBSTR(content, 0, 400) AS head
       FROM ${t("client_context")}
      WHERE client_id = 'spinach_records_425af0'
      ORDER BY created_at`,
  );
  console.log("\n=== spinach rows: content heads (attendees) ===");
  for (const r of attendees) {
    console.log(`--- ${r.context_id} ${JSON.stringify(r.title)}`);
    console.log(String(r.head).replace(/\n/g, " ⏎ ").slice(0, 350));
  }

  const { rows: tasks } = await bq.executeQuery(
    `SELECT task_id, client_id, description, status, owner, due_date, source, created_at
       FROM ${t("client_tasks")}
      WHERE client_id IN ('spinach_records_425af0','freedom_c5624c')
      ORDER BY client_id, created_at`,
  );
  console.log("\n=== tasks under spinach/freedom ===");
  for (const r of tasks) {
    console.log(
      [
        r.client_id,
        r.task_id,
        r.status,
        JSON.stringify(r.description).slice(0, 120),
        `src=${r.source}`,
        `created=${JSON.stringify(r.created_at)}`,
      ].join(" | "),
    );
  }

  const { rows: dupes } = await bq.executeQuery(
    `SELECT client_brand, source, source_ref, COUNT(*) AS n,
            ARRAY_AGG(DISTINCT IFNULL(client_id,'(null)') LIMIT 10) AS client_ids,
            ANY_VALUE(title) AS title
       FROM ${t("client_context")}
      WHERE source_ref IS NOT NULL
      GROUP BY client_brand, source, source_ref
     HAVING n > 1
      ORDER BY n DESC`,
  );
  console.log("\n=== ALL duplicate (source, source_ref) groups brand-wide ===");
  console.log(JSON.stringify(dupes, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
