/**
 * Teach the dictionary everything name-memory already knows.
 *
 * upsertContactNameMemory now writes a spelling into the voice dictionary once a
 * spoken name has landed on the same contact twice. That only fires the NEXT
 * time each name is confirmed -- so 45 pointers that were already trusted before
 * the change sat there teaching nothing, including the one that started this
 * ("AJ" has been Ajay Sathappan for weeks).
 *
 * This walks the existing trusted pointers once and applies the same rule the
 * live path uses, so nothing here can teach something the live path would not:
 *
 *   - streak >= 2 only. An unconfirmed guess is not a spelling.
 *   - the heard form must differ from BOTH the full name and the first name.
 *     "victor" -> Victor Udobong is not a repair; the transcriber got it right,
 *     and rewriting it would make the transcript read like a database record.
 *   - one token in, one token out: "aj" -> "Ajay", not "Ajay Sathappan".
 *
 *   railway run node scripts/backfill-vocab-from-memory.mjs           # dry run
 *   railway run node scripts/backfill-vocab-from-memory.mjs --apply
 */
import { query, closePool } from "../src/db/sql.js";
import { recordVoiceCorrection } from "../src/lib/voice-vocab.js";

const APPLY = process.argv.includes("--apply");

const { rows } = await query(
  `SELECT m.owner_id, m.name_key, m.contact_id, m.stable_streak, c.full_name
     FROM contact_name_memory m
     JOIN contacts c ON c.id = m.contact_id AND c.owner_id = m.owner_id
    WHERE m.stable_streak >= 2 AND c.deleted_at IS NULL
    ORDER BY m.stable_streak DESC`,
);

let taught = 0;
const skipped = [];

for (const r of rows) {
  const heard = String(r.name_key || "").toLowerCase().trim();
  const fullName = String(r.full_name || "").trim();
  if (!heard || !fullName) continue;
  const full = fullName.toLowerCase();
  const first = full.split(/\s+/)[0];
  if (heard === full || heard === first) {
    skipped.push(`${heard} (already spelled right)`);
    continue;
  }
  const intended = heard.includes(" ") ? fullName : fullName.split(/\s+/)[0];
  console.log(`${APPLY ? "teach" : "would teach"}  "${r.name_key}" -> "${intended}"  (streak ${r.stable_streak})`);
  if (APPLY) {
    const ok = await recordVoiceCorrection(r.owner_id, r.name_key, intended, r.contact_id);
    if (ok) taught += 1;
  } else {
    taught += 1;
  }
}

console.log(`\n${APPLY ? "Taught" : "Would teach"} ${taught} spelling(s) from ${rows.length} trusted pointer(s).`);
console.log(`Left alone: ${skipped.length} already transcribed correctly.`);
if (!APPLY) console.log("\nDry run. Re-run with --apply to write them.");
await closePool();
