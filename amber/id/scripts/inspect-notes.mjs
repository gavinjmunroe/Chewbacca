/**
 * Does a voice note actually land, all the way down? For one owner:
 *   conversation -> messages -> observations -> participants -> dimensions
 * and whether the observations point back at the note (source_conversation_id),
 * which is what the "filed to" chips and the tagged-people sheet read.
 */
import * as db from "../src/db/sql.js";
const run = ["query", "sql", "all", "rows"].map((k) => db[k]).find((f) => typeof f === "function");
const OWNER = process.argv[2] || "35a94acc-5d39-488b-9b01-a239c8255076";

const rows = async (sql, params = [OWNER]) => {
  const r = await run(sql, params);
  return r.rows ?? r;
};
const show = async (label, sql, params = [OWNER]) => {
  console.log(`\n--- ${label} ---`);
  try {
    const out = await rows(sql, params);
    if (out.length === 0) console.log("  (none)");
    for (const r of out) console.log(" ", JSON.stringify(r));
  } catch (e) {
    console.log("  QUERY FAILED:", e.message);
  }
};

// Introspect rather than guess: the last run died on c.id.
const cols = await rows(
  `SELECT column_name FROM information_schema.columns
    WHERE table_name = 'conversations' ORDER BY ordinal_position`, []);
const names = cols.map((c) => c.column_name);
console.log("conversations columns:", names.join(", "));
const PK = ["conversation_id", "id"].find((c) => names.includes(c)) ?? names[0];
console.log("using primary key:", PK);

await show("conversations", `
  SELECT count(*) AS total,
         count(*) FILTER (WHERE deleted_at IS NULL) AS live,
         min(created_at) AS oldest, max(created_at) AS newest
    FROM conversations WHERE owner_id = $1`);

await show("each conversation, with message and observation counts", `
  SELECT c.${PK} AS conversation, c.created_at, c.deleted_at,
         (SELECT count(*) FROM conversation_messages m
           WHERE m.conversation_id = c.${PK} AND m.deleted_at IS NULL) AS messages,
         (SELECT count(*) FROM observations o
           WHERE o.source_conversation_id = c.${PK} AND o.deleted_at IS NULL) AS observations
    FROM conversations c
   WHERE c.owner_id = $1
   ORDER BY c.created_at DESC LIMIT 12`);

await show("observations written in the last 3 hours", `
  SELECT kind, status, dimension_status,
         source_conversation_id IS NOT NULL AS linked_to_note,
         contact_id IS NOT NULL AS has_subject,
         left(body, 46) AS body
    FROM observations
   WHERE owner_id = $1 AND deleted_at IS NULL
     AND created_at > now() - interval '3 hours'
   ORDER BY created_at DESC LIMIT 25`);

await show("the whole chain, all time", `
  SELECT
    (SELECT count(*) FROM observations WHERE owner_id = $1 AND deleted_at IS NULL) AS observations,
    (SELECT count(*) FROM observations WHERE owner_id = $1 AND deleted_at IS NULL
       AND source_conversation_id IS NOT NULL) AS linked_to_a_note,
    (SELECT count(*) FROM observation_participants WHERE owner_id = $1) AS participants,
    (SELECT count(*) FROM observation_dimensions od
       JOIN observations o USING (observation_id) WHERE o.owner_id = $1) AS dimensions,
    (SELECT count(*) FROM events WHERE owner_id = $1 AND deleted_at IS NULL) AS events,
    (SELECT count(*) FROM contact_dimension_state WHERE owner_id = $1) AS contact_dimension_rows,
    (SELECT count(*) FROM contact_scores WHERE owner_id = $1) AS contact_scores`);

await db.closePool?.();
