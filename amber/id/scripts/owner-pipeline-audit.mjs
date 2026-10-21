/**
 * IS EVERY USER'S DATA ACTUALLY MOVING THROUGH THE PIPELINE, OR ONLY MINE?
 *
 * Run against production:
 *
 *   railway run node scripts/owner-pipeline-audit.mjs
 *   railway run node scripts/owner-pipeline-audit.mjs --owner <uuid>
 *
 * WHY THIS EXISTS. The question was "are Caleb's contacts getting tagged for the
 * dimensions of health, scored by PeopleRank, and stored everywhere the same way
 * mine are" -- and the honest answer was that nobody could say, because there
 * was no way to look. Two users on one deployment behaving completely
 * differently is either a data problem or a code path only one of them reaches,
 * and those have opposite fixes. Guessing between them has already cost a day.
 *
 * So this prints one row per owner across every stage, side by side. A stage
 * that is working shows numbers that track the stage before it. A stage that is
 * dead shows a zero next to a non-zero, and the gap names the break.
 *
 * IT READS ONLY. Every statement here is a SELECT. Safe to run against
 * production, and safe to run repeatedly.
 *
 * WHAT TO LOOK FOR, in the order the data moves:
 *
 *   contacts        the address book. If this is far below what the phone says
 *                   was synced, the sync is the problem, not the pipeline.
 *   observations     everything ever said, by kind. `pending` here means a name
 *                   was never resolved to a contact.
 *   dim_pending      observations whose dimension_status is still 'pending'.
 *                    The rollup worker classifies 25 per tick; a number that
 *                    never falls is a stuck queue.
 *   dim_rows         rows in observation_dimensions. THIS IS THE ONE THAT
 *                    EXPLAINS `dimension_owners=0`. ownersNeedingRollup requires
 *                    `EXISTS (observation_dimensions … suppressed = false)`, so
 *                    an owner with zero unsuppressed dimension rows is
 *                    structurally invisible to the dimension rollup no matter
 *                    how many facts they have. classified=5 in the log means the
 *                    classifier RAN; dim_rows is whether it WROTE.
 *   dim_state        rows in contact_dimension_state, and how stale the oldest
 *                    is. This is the six-dimensions surface the app reads.
 *   scores / stats   contact_scores and contact_interaction_stats -- the
 *                    PeopleRank in and out. `refreshed=5` on every single tick
 *                    for an hour means refreshOwner is being called and the
 *                    staleness predicate is never clearing; if computed_at here
 *                    is old while refreshed keeps reporting work, that is the
 *                    loop spinning.
 */
import { query, closePool } from "../src/db/sql.js";

const argv = process.argv.slice(2);
const only = (() => {
  const i = argv.indexOf("--owner");
  return i >= 0 ? argv[i + 1] : null;
})();

const q = async (sql, params = []) => {
  try {
    const { rows } = await query(sql, params);
    return rows;
  } catch (err) {
    console.error(`  ! query failed: ${(err?.message || err).toString().slice(0, 160)}`);
    return null;
  }
};

function table(rows, cols) {
  if (!rows || rows.length === 0) return "  (none)";
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)),
  );
  const line = (vals) => "  " + vals.map((v, i) => String(v ?? "").padEnd(widths[i])).join("  ");
  return [line(cols), line(widths.map((w) => "-".repeat(w))), ...rows.map((r) => line(cols.map((c) => r[c])))].join("\n");
}

async function main() {
  const scope = only ? "AND u.amber_id = $1::uuid" : "";
  const params = only ? [only] : [];

  console.log("\n═══ OWNERS ═══");
  const owners = await q(
    `SELECT u.amber_id AS owner_id,
            COALESCE(u.display_name, u.username, u.phone, '(unnamed)') AS who,
            (SELECT count(*)::int FROM contacts c
              WHERE c.owner_id = u.amber_id AND c.deleted_at IS NULL) AS contacts
       FROM users u
      WHERE TRUE ${scope}
      ORDER BY contacts DESC
      LIMIT 25`,
    params,
  );
  if (!owners || owners.length === 0) {
    console.log("  no owners found — check the users table shape");
    return;
  }
  console.log(table(owners, ["owner_id", "who", "contacts"]));

  const ids = owners.map((o) => o.owner_id);

  console.log("\n═══ STAGE 1: OBSERVATIONS (what was ever said) ═══");
  console.log(
    table(
      await q(
        `SELECT owner_id, kind, status, count(*)::int AS n
           FROM observations
          WHERE owner_id = ANY($1::uuid[]) AND deleted_at IS NULL
          GROUP BY owner_id, kind, status
          ORDER BY owner_id, kind, status`,
        [ids],
      ),
      ["owner_id", "kind", "status", "n"],
    ),
  );

  console.log("\n═══ STAGE 2: DIMENSION CLASSIFICATION ═══");
  console.log("  dimension_status on observations — 'pending' is the queue depth:");
  console.log(
    table(
      await q(
        `SELECT owner_id, COALESCE(dimension_status, '(null)') AS dimension_status,
                count(*)::int AS n, max(dimension_attempts) AS max_attempts
           FROM observations
          WHERE owner_id = ANY($1::uuid[]) AND deleted_at IS NULL
          GROUP BY owner_id, dimension_status
          ORDER BY owner_id, n DESC`,
        [ids],
      ),
      ["owner_id", "dimension_status", "n", "max_attempts"],
    ),
  );

  console.log("\n  observation_dimensions rows — THE ONE THAT EXPLAINS dimension_owners=0.");
  console.log("  An owner with 0 unsuppressed rows cannot be seen by the dimension rollup at all:");
  console.log(
    table(
      await q(
        `SELECT o.owner_id,
                count(*)::int AS dim_rows,
                count(*) FILTER (WHERE od.suppressed = false)::int AS unsuppressed,
                count(DISTINCT od.observation_id)::int AS observations_tagged,
                count(DISTINCT od.dimension_id)::int AS distinct_dimensions
           FROM observation_dimensions od
           JOIN observations o USING (observation_id)
          WHERE o.owner_id = ANY($1::uuid[]) AND o.deleted_at IS NULL
          GROUP BY o.owner_id
          ORDER BY dim_rows DESC`,
        [ids],
      ),
      ["owner_id", "dim_rows", "unsuppressed", "observations_tagged", "distinct_dimensions"],
    ),
  );

  console.log("\n═══ STAGE 3: DIMENSION STATE (the six dimensions the app shows) ═══");
  console.log(
    table(
      await q(
        `SELECT owner_id, count(*)::int AS state_rows,
                count(DISTINCT contact_id)::int AS contacts_with_state,
                min(computed_at)::text AS oldest_computed,
                max(computed_at)::text AS newest_computed
           FROM contact_dimension_state
          WHERE owner_id = ANY($1::uuid[])
          GROUP BY owner_id
          ORDER BY state_rows DESC`,
        [ids],
      ),
      ["owner_id", "state_rows", "contacts_with_state", "oldest_computed", "newest_computed"],
    ),
  );

  console.log("\n═══ STAGE 4: PEOPLERANK IN AND OUT ═══");
  console.log("  contact_interaction_stats (the input):");
  console.log(
    table(
      await q(
        `SELECT owner_id, count(*)::int AS rows,
                max(computed_at)::text AS newest_computed
           FROM contact_interaction_stats
          WHERE owner_id = ANY($1::uuid[])
          GROUP BY owner_id ORDER BY rows DESC`,
        [ids],
      ),
      ["owner_id", "rows", "newest_computed"],
    ),
  );
  console.log("\n  contact_scores (the output):");
  console.log(
    table(
      await q(
        `SELECT owner_id, count(*)::int AS rows,
                round(avg(score)::numeric, 3) AS avg_score,
                max(computed_at)::text AS newest_computed
           FROM contact_scores
          WHERE owner_id = ANY($1::uuid[])
          GROUP BY owner_id ORDER BY rows DESC`,
        [ids],
      ),
      ["owner_id", "rows", "avg_score", "newest_computed"],
    ),
  );

  console.log("\n═══ THE TWO PREDICATES THE ROLLUP WORKER USES ═══");
  console.log("  These are the exact queries behind `dimension_owners=N` and `refreshed=N`.");
  console.log("  If one returns nothing while the other returns the same rows forever, that is the bug.\n");
  console.log("  ownersNeedingRollup (drives dimension_owners):");
  console.log(
    table(
      await q(
        `SELECT q.owner_id, q.newest::text AS newest_observation,
                (SELECT min(s.computed_at) FROM contact_dimension_state s
                  WHERE s.owner_id = q.owner_id)::text AS oldest_state
           FROM (
             SELECT o.owner_id,
                    max(GREATEST(o.created_at,
                        (SELECT max(od.created_at) FROM observation_dimensions od
                          WHERE od.observation_id = o.observation_id AND od.suppressed = false)
                    )) AS newest
               FROM observations o
              WHERE o.deleted_at IS NULL AND o.contact_id IS NOT NULL
                AND o.status <> 'pending'
                AND EXISTS (SELECT 1 FROM observation_dimensions od
                             WHERE od.observation_id = o.observation_id AND od.suppressed = false)
              GROUP BY o.owner_id
           ) q
          WHERE q.newest > COALESCE(
                  (SELECT min(s.computed_at) FROM contact_dimension_state s
                    WHERE s.owner_id = q.owner_id), 'epoch'::timestamptz)
          ORDER BY q.newest DESC LIMIT 50`,
      ),
      ["owner_id", "newest_observation", "oldest_state"],
    ),
  );

  console.log("\n  How many observations could EVER qualify (the EXISTS clause alone):");
  console.log(
    table(
      await q(
        `SELECT o.owner_id,
                count(*)::int AS eligible_observations
           FROM observations o
          WHERE o.deleted_at IS NULL AND o.contact_id IS NOT NULL
            AND o.status <> 'pending'
            AND EXISTS (SELECT 1 FROM observation_dimensions od
                         WHERE od.observation_id = o.observation_id AND od.suppressed = false)
          GROUP BY o.owner_id ORDER BY eligible_observations DESC LIMIT 25`,
      ),
      ["owner_id", "eligible_observations"],
    ),
  );

  console.log("\n═══ CONTACT SOURCES (did the Apple sync finish?) ═══");
  console.log(
    table(
      await q(
        `SELECT c.owner_id, s.source, count(DISTINCT s.contact_id)::int AS n,
                max(c.created_at)::text AS newest_contact
           FROM contact_sources s
           JOIN contacts c ON c.id = s.contact_id AND c.deleted_at IS NULL
          WHERE c.owner_id = ANY($1::uuid[])
          GROUP BY c.owner_id, s.source
          ORDER BY c.owner_id, n DESC`,
        [ids],
      ),
      ["owner_id", "source", "n", "newest_contact"],
    ),
  );

  console.log("\nDone. Every statement above was a SELECT.\n");
}

main()
  .catch((err) => {
    console.error(`audit failed: ${err?.message || err}`);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));
