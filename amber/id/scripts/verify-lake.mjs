// Counts Cloud SQL through the app's own pool so the numbers come from the same
// path production uses -- not a second connection string that could drift.
import * as db from "../src/db/sql.js";

const run = ["query", "sql", "all", "rows"].map((k) => db[k]).find((f) => typeof f === "function");
if (!run) {
  console.log("no query export found. src/db/sql.js exports:", Object.keys(db).join(", "));
  process.exit(1);
}

const SQL = `
SELECT 'contacts_all'        k, count(*) FROM contacts
UNION ALL SELECT 'contacts_live',      count(*) FROM contacts WHERE deleted_at IS NULL
UNION ALL SELECT 'contact_scores',     count(*) FROM contact_scores
UNION ALL SELECT 'observations_live',  count(*) FROM observations WHERE deleted_at IS NULL
UNION ALL SELECT 'facts_fanout',       count(*)
     FROM observations o
     LEFT JOIN observation_dimensions od
       ON od.observation_id = o.observation_id AND od.suppressed = false
    WHERE o.deleted_at IS NULL AND o.status <> 'pending'
UNION ALL SELECT 'connections',        count(*) FROM connections
UNION ALL SELECT 'circle_members',     count(*) FROM circle_members
UNION ALL SELECT 'events',             count(*) FROM events
UNION ALL SELECT 'event_participants', count(*) FROM event_participants
UNION ALL SELECT 'places',             count(*) FROM places
UNION ALL SELECT 'dm_messages',        count(*) FROM dm_messages
ORDER BY 1`;

const res = await run(SQL);
for (const r of (res.rows ?? res)) console.log(String(r.k).padEnd(20), r.count);
await db.closePool?.();
