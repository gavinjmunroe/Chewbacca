import * as db from "../src/db/sql.js";
const run = ["query","sql","all","rows"].map((k)=>db[k]).find((f)=>typeof f==="function");
const show = async (label, sql) => {
  const res = await run(sql);
  console.log(`\n--- ${label} ---`);
  for (const r of (res.rows ?? res)) console.log(JSON.stringify(r));
};
await show("dimensions on the Red Hook observation", `
  SELECT o.dimension_status, o.dimension_attempts, d.code, od.weight, od.confidence
    FROM observations o
    LEFT JOIN observation_dimensions od ON od.observation_id = o.observation_id
    LEFT JOIN dimensions d ON d.dimension_id = od.dimension_id
   WHERE o.observation_id = 'f911e15c-5497-4ae9-a7f9-a8e6c5cc5f16'`);
await show("is the dimension queue moving", `
  SELECT dimension_status, count(*) FROM observations
   WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC`);
await show("Spencer's dimension state", `
  SELECT * FROM contact_dimension_state
   WHERE contact_id = '926e52c2-bd06-4bf0-9985-425107610c60'`);
await db.closePool?.();
