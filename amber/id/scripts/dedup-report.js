// Throwaway READ-ONLY dedup report: for an owner, find contacts that share a
// normalized full_name but live in more than one row — i.e. potential duplicates
// the deterministic phone/email match couldn't bridge (e.g. a Gmail-only contact
// and a phone-only Apple contact with no shared key). No writes.
//
// Usage: railway run node scripts/dedup-report.js <phone-or-amber_id>

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-dedup.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");
const { resolveAmberIdByPhone } = await import("../src/db/store.js");
const { normalizePhone } = await import("../src/lib/auth-session.js");

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/dedup-report.js <phone-or-amber_id>");
  process.exit(1);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ownerId = UUID.test(arg) ? arg : await resolveAmberIdByPhone(normalizePhone(arg));
if (!ownerId) {
  console.error("could not resolve owner from:", arg);
  process.exit(1);
}

try {
  const total = await query(
    `SELECT count(*)::int AS n FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL`,
    [ownerId],
  );
  const bySource = await query(
    `SELECT coalesce(source,'(none)') AS source, count(*)::int AS n
       FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL
      GROUP BY 1 ORDER BY 2 DESC`,
    [ownerId],
  );
  const dupes = await query(
    `SELECT lower(btrim(full_name)) AS name_key,
            count(*)::int AS n,
            array_agg(id ORDER BY id) AS ids,
            array_agg(coalesce(source,'?') ORDER BY id) AS sources
       FROM contacts
      WHERE owner_id = $1 AND deleted_at IS NULL
        AND full_name IS NOT NULL AND btrim(full_name) <> ''
      GROUP BY 1
     HAVING count(*) > 1
      ORDER BY n DESC, name_key ASC
      LIMIT 60`,
    [ownerId],
  );

  console.log(`owner ${ownerId}`);
  console.log(`total contacts: ${total.rows[0].n}`);
  console.log("by source:", bySource.rows.map((r) => `${r.source}=${r.n}`).join("  "));
  const dupRows = dupes.rows;
  const dupContacts = dupRows.reduce((a, r) => a + r.n, 0);
  console.log(
    `\nsame-name groups with >1 row: ${dupRows.length}  (covering ${dupContacts} contact rows)`,
  );
  for (const r of dupRows.slice(0, 40)) {
    console.log(`   ${r.n}×  "${r.name_key}"  ids=[${r.ids.join(",")}] sources=[${r.sources.join(",")}]`);
  }
  console.log("\n(note: some same-name groups are genuinely different people — this is a signal, not a verdict.)");
  process.exit(0);
} catch (err) {
  console.error("dedup report failed:", err?.message || err);
  process.exit(1);
}
