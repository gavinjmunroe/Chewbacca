/**
 * ROWS LEFT BEHIND BY A MERGE THAT DID NOT KNOW ABOUT THEIR TABLE.
 *
 * collapseContactGroup used to move rows from a list written by hand. A table
 * added after that list was written was simply not moved, and because the
 * absorbed card is SOFT-deleted, the foreign key's ON DELETE CASCADE never
 * fired and nothing ever complained. The rows just sat there pointing at a card
 * no screen renders. event_participants shipped on 2026-09-03 and landed in
 * exactly that gap: people quietly dropped off meetings they had attended.
 *
 * The merge engine discovers its tables from pg_constraint now, so no new rows
 * are stranded. This repairs the ones already stranded.
 *
 * WHAT IT WILL AND WILL NOT DO. It repairs only what contact_merges can prove:
 * an absorbed id, a survivor id, and a merge that was not undone. Merges from
 * before that table existed are not guessed at -- the survivor could be inferred
 * by walking identity keys back from a dead card, but an inference has no
 * snapshot behind it and a wrong one moves somebody's meeting history onto a
 * stranger. So: provable repairs, and a count of what it could not reach.
 *
 * It reports by default and writes only with --confirm.
 *
 *   railway run node scripts/repair-orphaned-merge-refs.mjs
 *   railway run node scripts/repair-orphaned-merge-refs.mjs --confirm
 */

import { query, closePool } from "../src/db/sql.js";
import { referencingColumns } from "../src/db/contact-refs.js";

const APPLY = process.argv.includes("--confirm");

// Reads are free; the write path needs credentials the same way every other
// script here does, and `railway run` is what injects them.
if (
  APPLY &&
  !process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON &&
  !process.env.GOOGLE_APPLICATION_CREDENTIALS
) {
  console.error(
    "\n  No GCP credentials in the environment. Run this through `railway run`,\n" +
      "  which injects them alongside the AMBER_SQL_* variables.\n",
  );
  process.exit(2);
}

/**
 * Follow a card to whatever it was merged into, through however many merges.
 * Chains happen: A absorbed into B on Monday, B absorbed into C on Tuesday, and
 * a row still pointing at A belongs on C. Bounded, because a cycle in this data
 * would otherwise spin forever, and a cycle is a bug worth seeing rather than
 * surviving.
 */
async function survivorFor(ownerId, contactId, seen = new Set()) {
  let current = contactId;
  for (let hop = 0; hop < 8; hop += 1) {
    if (seen.has(current)) return null; // a cycle -- refuse rather than guess
    seen.add(current);
    const { rows } = await query(
      `SELECT survivor_id FROM contact_merges
        WHERE owner_id = $1::uuid AND $2::uuid = ANY(absorbed_ids) AND undone_at IS NULL
        ORDER BY merged_at DESC LIMIT 1`,
      [ownerId, current],
    );
    if (!rows.length) return null;
    const next = String(rows[0].survivor_id);
    const { rows: live } = await query(
      `SELECT deleted_at FROM contacts WHERE owner_id = $1::uuid AND id = $2::uuid`,
      [ownerId, next],
    );
    if (!live.length) return null;
    if (!live[0].deleted_at) return next; // a live survivor: done
    current = next; // itself absorbed later -- keep walking
  }
  return null;
}

async function main() {
  console.log(`\n  orphaned merge references — ${APPLY ? "REPAIRING" : "report only"}\n`);

  const refs = await referencingColumns();
  let totalOrphans = 0;
  let repaired = 0;
  let dropped = 0;
  let unprovable = 0;

  for (const { table, column } of refs) {
    // Rows pointing at a card that a merge soft-deleted. Restricted to owners
    // that have merge records, so this cannot touch a soft-delete that was an
    // ordinary deletion rather than a merge.
    const { rows } = await query(
      `SELECT r.ctid, r.owner_id, r.${column} AS contact_id
         FROM ${table} r
         JOIN contacts c ON c.owner_id = r.owner_id AND c.id = r.${column}
        WHERE c.deleted_at IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM contact_merges m
             WHERE m.owner_id = r.owner_id
               AND r.${column} = ANY(m.absorbed_ids)
               AND m.undone_at IS NULL
          )`,
    );
    if (!rows.length) continue;

    totalOrphans += rows.length;
    let tableRepaired = 0;
    let tableDropped = 0;
    let tableUnprovable = 0;

    for (const row of rows) {
      const owner = String(row.owner_id);
      const survivor = await survivorFor(owner, String(row.contact_id));
      if (!survivor) {
        tableUnprovable += 1;
        continue;
      }
      if (!APPLY) {
        tableRepaired += 1;
        continue;
      }
      try {
        const r = await query(
          `UPDATE ${table} SET ${column} = $2::uuid WHERE owner_id = $1::uuid AND ctid = $3::tid`,
          [owner, survivor, row.ctid],
        );
        tableRepaired += r.rowCount ?? 0;
      } catch (e) {
        if (e?.code !== "23505" && e?.code !== "23514") throw e;
        // The survivor already carries this row -- the absorbed card's copy is
        // redundant, which is what the merge would have concluded at the time.
        const d = await query(
          `DELETE FROM ${table} WHERE owner_id = $1::uuid AND ctid = $2::tid`,
          [owner, row.ctid],
        );
        tableDropped += d.rowCount ?? 0;
      }
    }

    repaired += tableRepaired;
    dropped += tableDropped;
    unprovable += tableUnprovable;
    console.log(
      `  ${table}.${column}: ${rows.length} orphaned` +
        `  →  ${tableRepaired} ${APPLY ? "repointed" : "repairable"}` +
        `${tableDropped ? `, ${tableDropped} redundant` : ""}` +
        `${tableUnprovable ? `, ${tableUnprovable} unprovable` : ""}`,
    );
  }

  if (totalOrphans === 0) {
    console.log("  Nothing orphaned. Every row pointing at a merged-away card has a home.\n");
    return;
  }

  console.log(
    `\n  ${totalOrphans} orphaned row(s): ` +
      `${repaired} ${APPLY ? "repointed" : "repairable"}, ` +
      `${dropped} redundant, ${unprovable} unprovable.\n`,
  );
  if (unprovable) {
    console.log(
      "  Unprovable rows were absorbed by a merge with no usable record -- most\n" +
        "  likely one that predates contact_merges. They are left alone on purpose.\n",
    );
  }
  if (!APPLY) console.log("  Nothing was written. Re-run with --confirm to repair.\n");
}

let failed = 0;
try {
  await main();
} catch (e) {
  failed = 1;
  console.error("\n  FAILED:", e?.stack || e);
} finally {
  await closePool();
}
process.exit(failed);
