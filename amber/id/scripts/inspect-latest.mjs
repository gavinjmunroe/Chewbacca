import * as db from "../src/db/sql.js";
const run = ["query", "sql", "all", "rows"].map((k) => db[k]).find((f) => typeof f === "function");
const show = async (label, sql) => {
  const res = await run(sql);
  console.log(`\n--- ${label} ---`);
  for (const r of (res.rows ?? res)) console.log(JSON.stringify(r));
};
await show("latest observations", `
  SELECT observation_id, kind, modality, status, dimension_status,
         contact_id, event_id, left(body, 70) AS body, created_at
    FROM observations ORDER BY created_at DESC LIMIT 4`);
await show("their participants", `
  SELECT op.*, c.full_name FROM observation_participants op
    LEFT JOIN contacts c ON c.id = op.contact_id
   WHERE op.observation_id IN (
     SELECT observation_id FROM observations ORDER BY created_at DESC LIMIT 4)`);
await show("their unresolved names", `
  SELECT * FROM observation_raw_names
   WHERE observation_id IN (
     SELECT observation_id FROM observations ORDER BY created_at DESC LIMIT 4)`);
await db.closePool?.();
