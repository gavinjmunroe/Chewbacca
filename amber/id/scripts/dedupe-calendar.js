/**
 * THE DUPLICATE ROWS THEMSELVES, NOT JUST THE VIEW OF THEM.
 *
 *   railway run node scripts/dedupe-calendar.js            # counts only
 *   railway run node scripts/dedupe-calendar.js --run      # deletes them
 *
 * WHAT MADE THEM. `events` is unique on (calendar_account_id, external_id)
 * and the index is PARTIAL -- it only applies when both are present. An
 * event that arrives without a provider id therefore has no idempotency key
 * at all, so every sync writes another copy. Connecting the same Google
 * account twice does the same thing by a different route: two
 * calendar_account_ids, so two rows that the index considers unrelated.
 *
 * The screens group these away now, which is right -- a reader should not
 * show somebody five copies of a standup whatever the table holds. This is
 * the other half: the rows are still there, they are still being bridged
 * into the ledger, and they will still be there next month.
 *
 * WHAT IT KEEPS. The OLDEST row of each group, because it is the one
 * everything else already points at -- its event_id is in org_interactions'
 * external_id, and deleting it would orphan that history. Newer copies carry
 * nothing the older one does not.
 *
 * IT DOES NOT TOUCH THE LEDGER. org_interactions rows that came from the
 * copies are left alone: they are deduplicated on read, and deleting
 * somebody's relationship history to tidy a calendar is not a trade this
 * script is allowed to make.
 */

import { query } from "../src/db/sql.js";

const RUN = process.argv.includes("--run");

/**
 * The group key is what makes two rows the same MEETING to a person: one
 * owner, one title, one starting minute. Deliberately not external_id --
 * the whole failure is that external_id is absent or differs on rows that
 * are the same meeting.
 */
const GROUPS = `
  SELECT owner_id,
         lower(btrim(coalesce(title, ''))) AS t,
         date_trunc('minute', starts_at)   AS m,
         count(*)::int                     AS copies,
         min(created_at)                   AS first_seen,
         (array_agg(event_id ORDER BY created_at ASC))[1] AS keep
    FROM events
   WHERE deleted_at IS NULL
   GROUP BY 1, 2, 3
  HAVING count(*) > 1
`;

async function main() {
  const { rows: groups } = await query(`${GROUPS} ORDER BY copies DESC LIMIT 50`);
  const { rows: totals } = await query(
    `SELECT count(*)::int AS groups, COALESCE(sum(copies) - count(*), 0)::int AS extra
       FROM (${GROUPS}) g`,
  );

  const { groups: n, extra } = totals[0] ?? { groups: 0, extra: 0 };

  if (n === 0) {
    console.log("\n  No duplicated events. Nothing to do.\n");
    return;
  }

  console.log(
    `\n  ${n} meeting${n === 1 ? "" : "s"} exist more than once, ` +
      `${extra} row${extra === 1 ? "" : "s"} to remove.\n`,
  );
  for (const g of groups.slice(0, 15)) {
    console.log(`    ${String(g.copies).padStart(3)}x  ${g.t || "(untitled)"}  ${g.m.toISOString()}`);
  }
  if (groups.length > 15) console.log(`    ... and ${groups.length - 15} more\n`);

  if (!RUN) {
    console.log("\n  Nothing was deleted. Add --run to remove the extra copies.\n");
    return;
  }

  /*
   * SOFT DELETE, not DELETE. events is referenced by event_participants and
   * by the bridge's own external ids, and a row that is gone is a row no
   * history can point at. deleted_at is what every read already filters on.
   */
  const { rowCount } = await query(
    `UPDATE events e
        SET deleted_at = now()
       FROM (${GROUPS}) d
      WHERE e.owner_id = d.owner_id
        AND lower(btrim(coalesce(e.title, ''))) = d.t
        AND date_trunc('minute', e.starts_at) = d.m
        AND e.event_id <> d.keep
        AND e.deleted_at IS NULL`,
  );

  console.log(`\n  ✓ ${rowCount} extra cop${rowCount === 1 ? "y" : "ies"} removed.`);
  console.log("    The oldest row of each meeting was kept, so nothing that points at one broke.\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n  ✗ dedupe-calendar failed: ${err?.message ?? err}\n`);
    process.exit(1);
  });
