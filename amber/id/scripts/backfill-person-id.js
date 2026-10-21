// Chunk 4c-i follow-up: backfill users.person_id for existing rows.
//
// person_id = personIdFromHandle(phone) — deterministic sha256(toE164(phone))
// truncated to 32 hex. For every non-deleted users row that has a phone and a
// null person_id, compute it and UPDATE. Idempotent (only touches null rows),
// never overwrites a non-null person_id, never throws out of the loop.
//
// Run AFTER applying db/migrations/20260726_add_users_person_id.sql:
//   railway run node scripts/backfill-person-id.js

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Materialize the service-account JSON so the Cloud SQL connector's ADC can
// find it (mirrors run-migration.js). Must run before importing sql.js.
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-backfill-person-id.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");
const { personIdFromHandle } = await import("../src/pdw/person-resolver.js");

async function main() {
  const { rows } = await query(
    `SELECT amber_id, phone FROM users
      WHERE phone IS NOT NULL AND person_id IS NULL AND deleted_at IS NULL`,
  );

  let candidates = rows.length;
  let updated = 0;
  let skipped = 0; // phone didn't normalize to a person_id
  let errors = 0;

  for (const row of rows) {
    const personId = personIdFromHandle(row.phone);
    if (!personId) {
      skipped++;
      console.warn(`[backfill-person-id] skip: phone for ${row.amber_id} did not normalize`);
      continue;
    }
    try {
      // Guard person_id IS NULL again so a concurrent writer's value is never
      // clobbered; the partial unique index also rejects any collision.
      const { rowCount } = await query(
        `UPDATE users SET person_id = $2, updated_at = now()
          WHERE amber_id = $1 AND person_id IS NULL`,
        [row.amber_id, personId],
      );
      updated += rowCount ?? 0;
    } catch (err) {
      errors++;
      console.error(`[backfill-person-id] ${row.amber_id}: ${err?.message || err}`);
    }
  }

  console.log(
    `[backfill-person-id] done — candidates=${candidates} updated=${updated} skipped(unparseable phone)=${skipped} errors=${errors}`,
  );
  process.exit(errors > 0 ? 1 : 0);
}

main();
