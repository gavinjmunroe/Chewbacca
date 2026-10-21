/**
 * Give every experience that already has people the event it never got.
 *
 * ensureEventForObservation now runs whenever an observation gains a person, but
 * that only helps from here on. Every experience captured before it -- and every
 * one whose names were resolved asynchronously, which is all of them from voice
 * -- is sitting with participants, no event_id, and therefore no contribution to
 * anyone's cadence or warmth.
 *
 * Read-only unless --apply. Idempotent: the helper creates an event only when
 * event_id is null and at least one person is attached, so a second run is a
 * no-op and a partial run resumes cleanly.
 *
 *   railway run node scripts/backfill-experience-events.mjs
 *   railway run node scripts/backfill-experience-events.mjs --apply
 */
import { query, withTransaction, closePool } from "../src/db/sql.js";
import { ensureEventForObservation } from "../src/db/observations-store.js";

const APPLY = process.argv.includes("--apply");

const { rows } = await query(
  `SELECT o.observation_id, o.owner_id, left(o.body, 60) AS body,
          (SELECT count(*) FROM observation_participants p
            WHERE p.observation_id = o.observation_id) AS participants,
          o.contact_id
     FROM observations o
    WHERE o.kind = 'experience'
      AND o.deleted_at IS NULL
      AND o.event_id IS NULL
    ORDER BY o.created_at`,
);

const eligible = rows.filter((r) => Number(r.participants) > 0 || r.contact_id);
const skipped = rows.length - eligible.length;

console.log(`experiences with no event: ${rows.length}`);
console.log(`  eligible (somebody attached): ${eligible.length}`);
console.log(`  skipped (nobody attached, correctly): ${skipped}`);
console.log(APPLY ? "\nAPPLY\n" : "\nDRY RUN -- pass --apply to write\n");

let made = 0, none = 0, failed = 0;
for (const r of eligible) {
  if (!APPLY) {
    console.log(`  would create: ${r.observation_id}  people=${r.participants}  ${r.body}`);
    continue;
  }
  try {
    const eventId = await withTransaction((client) =>
      ensureEventForObservation(client, {
        ownerId: r.owner_id,
        observationId: r.observation_id,
      }),
    );
    if (eventId) { made += 1; console.log(`  created ${eventId}  <- ${r.observation_id}  ${r.body}`); }
    else { none += 1; }
  } catch (err) {
    failed += 1;
    console.error(`  FAILED ${r.observation_id}: ${err?.message || err}`);
  }
}

if (APPLY) console.log(`\nevents created: ${made}   no-op: ${none}   failed: ${failed}`);
await closePool();
