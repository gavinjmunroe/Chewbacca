/**
 * DOES THE DATA ACTUALLY LAND? One script, one answer per claim.
 *
 * Every check is written as a claim that is either true or false against the
 * live database, printed PASS or FAIL with the number that decided it. No check
 * infers anything from an absence -- "I did not see it in the logs" is how the
 * credential tables nearly got dropped with 238 rows in them.
 *
 *   railway run node scripts/verify-capture.mjs
 *   railway run node scripts/verify-capture.mjs --hours 6
 */
import { query, closePool } from "../src/db/sql.js";

const HOURS = Number(process.argv[process.argv.indexOf("--hours") + 1]) || 24;
const one = async (sql, params = []) => (await query(sql, params)).rows[0];
const all = async (sql, params = []) => (await query(sql, params)).rows;

let failures = 0;
function check(claim, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${claim}${detail ? `  — ${detail}` : ""}`);
}
// AN EMPTY WINDOW IS NOT A BROKEN ONE.
//
// Half of these checks assert that something EXISTS -- notes were created,
// replies were written, people were tagged. Run over an hour in which nobody
// recorded anything, every one of them reports FAIL, and the script cries wolf
// about a pipeline that is simply idle. Presence checks are skipped when there
// was no activity to check; the standing ones (the dictionary, the rollups,
// the queue) still run, because those are true or false regardless.
function skip(claim, reason) {
  console.log(`SKIP  ${claim}  — ${reason}`);
}
const section = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 58 - t.length))}`);

console.log(`Checking the last ${HOURS}h.\n`);

// ── 1. The transcript ────────────────────────────────────────────────────────
section("Notes and replies");

const conv = await one(
  `SELECT count(*)::int AS n FROM conversations
    WHERE deleted_at IS NULL AND created_at > now() - ($1 || ' hours')::interval`, [HOURS]);
const idle = conv.n === 0;
if (idle) {
  skip("voice notes were created", `nothing recorded in the last ${HOURS}h — nothing to check`);
} else {
  check("voice notes were created", conv.n > 0, `${conv.n} conversations`);
}

const roles = await all(
  `SELECT role, count(*)::int AS n FROM conversation_messages
    WHERE deleted_at IS NULL AND created_at > now() - ($1 || ' hours')::interval
    GROUP BY role`, [HOURS]);
const byRole = Object.fromEntries(roles.map((r) => [r.role, r.n]));
if (idle) skip("Amber's replies are stored as Amber's", "no messages in the window");
else check("Amber's replies are stored as Amber's", (byRole.amber || 0) > 0,
  roles.map((r) => `${r.role}=${r.n}`).join(" "));

const misfiled = await one(
  `SELECT count(*)::int AS n FROM conversation_messages
    WHERE deleted_at IS NULL AND role = 'user' AND metadata ? 'model'
      AND created_at > now() - ($1 || ' hours')::interval`, [HOURS]);
check("no reply is filed as the user", misfiled.n === 0, `${misfiled.n} misfiled`);

// A thread with no reply AND no user message never got off the ground -- the
// row is created on the stream's `meta` event, before a word is persisted, so an
// abandoned or aborted recording leaves one behind. That is litter, not data
// loss. A thread that HAS the user's words but no reply is the real failure.
const orphan = await all(
  `SELECT c.conversation_id, c.created_at,
          (SELECT count(*)::int FROM conversation_messages m
            WHERE m.conversation_id = c.conversation_id AND m.role = 'user'
              AND m.deleted_at IS NULL) AS said
     FROM conversations c
    WHERE c.deleted_at IS NULL AND c.created_at > now() - ($1 || ' hours')::interval
      AND NOT EXISTS (SELECT 1 FROM conversation_messages m
                       WHERE m.conversation_id = c.conversation_id
                         AND m.role = 'amber' AND m.deleted_at IS NULL)`, [HOURS]);
const lostReplies = orphan.filter((r) => r.said > 0);
check("every note that said something got a reply", lostReplies.length === 0,
  `${lostReplies.length} with words and no reply` +
  (orphan.length > lostReplies.length
    ? `; ${orphan.length - lostReplies.length} empty shell(s) from an abandoned recording`
    : ""));
for (const r of lostReplies) {
  console.log(`      ${new Date(r.created_at).toISOString()}  thread ${r.conversation_id}`);
  // EVERY message, with what its metadata carries. A reply that was written
  // before the role fix and has no `model` in its metadata would still be
  // sitting here as a 'user' row, invisible to the misfiled check above -- this
  // is how we tell "the reply was lost" from "the reply is mislabelled".
  const msgs = await all(
    `SELECT role, left(content, 60) AS t, (metadata ? 'model') AS has_model,
            (metadata ? 'source') AS has_source
       FROM conversation_messages
      WHERE conversation_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
    [r.conversation_id]);
  for (const m of msgs) {
    const tags = [m.has_model ? "model" : null, m.has_source ? "source" : null]
      .filter(Boolean).join(",") || "no metadata";
    console.log(`        ${m.role.padEnd(6)} [${tags}]  "${m.t}…"`);
  }
}

// ── 2. What was learned ──────────────────────────────────────────────────────
section("Observations and people");

// A CIRCLE IS A SOURCE TOO. This check used to demand source_conversation_id on
// every row, which fails every observation learned in a circle -- those carry
// source_circle_id instead, by design (see provenance() in observations-compat).
// The claim is "it knows where it came from", not "it came from a note".
const obs = await one(
  `SELECT count(*)::int AS n,
          count(*) FILTER (WHERE source_conversation_id IS NOT NULL)::int AS from_note,
          count(*) FILTER (WHERE source_circle_id IS NOT NULL)::int AS from_circle,
          count(*) FILTER (WHERE source_conversation_id IS NULL
                             AND source_circle_id IS NULL)::int AS orphaned
     FROM observations
    WHERE deleted_at IS NULL AND created_at > now() - ($1 || ' hours')::interval`, [HOURS]);
if (idle) skip("notes produced observations", "no notes in the window");
else check("notes produced observations", obs.n > 0, `${obs.n} observations`);
check("every observation knows where it came from", obs.orphaned === 0,
  `${obs.from_note} from notes, ${obs.from_circle} from circles, ${obs.orphaned} from nowhere`);
if (obs.orphaned > 0) {
  // WHICH WRITE PATH. `source` says who inserted it and `kind` says what it is;
  // between them they name the caller without having to read every one.
  const lost = await all(
    `SELECT kind, source, contact_id IS NOT NULL AS has_contact,
            left(body, 60) AS body, created_at
       FROM observations
      WHERE deleted_at IS NULL AND created_at > now() - ($1 || ' hours')::interval
        AND source_conversation_id IS NULL AND source_circle_id IS NULL
      ORDER BY created_at`, [HOURS]);
  for (const r of lost) {
    console.log(`      ${new Date(r.created_at).toISOString()}  ${r.kind}/${r.source}` +
      `${r.has_contact ? "" : " (no contact)"}  "${r.body}…"`);
  }
  console.log(`      NOTE: provenance() was an allowlist of voice_note|chat|conversation until`);
  console.log(`      2026-09-08T00:30Z, so every soundboard row written before then has no source.`);
  console.log(`      Anything above that timestamp is history; anything after it is a live bug.`);
}

const parts = await one(
  `SELECT count(*)::int AS n,
          count(*) FILTER (WHERE role = 'subject')::int AS subjects
     FROM observation_participants p
     JOIN observations o USING (observation_id)
    WHERE o.deleted_at IS NULL AND o.created_at > now() - ($1 || ' hours')::interval`, [HOURS]);
if (idle) skip("people were tagged onto them", "no observations in the window");
else check("people were tagged onto them", parts.n > 0, `${parts.n} participant rows`);

// The "Sagar twice" class: the same contact on one note under two roles.
const dupes = await all(
  `SELECT o.source_conversation_id AS conv, p.contact_id, count(DISTINCT p.role)::int AS roles
     FROM observations o JOIN observation_participants p USING (observation_id)
    WHERE o.deleted_at IS NULL AND o.source_conversation_id IS NOT NULL
      AND o.created_at > now() - ($1 || ' hours')::interval
    GROUP BY 1,2 HAVING count(DISTINCT p.role) > 1`, [HOURS]);
// NOT A FAILURE. Being the subject of one observation and a participant of
// another on the same note is normal and correct -- it is only a bug if it
// reaches the UI twice, and getFiledPeopleForConversation collapses it now.
// Printed so the number is visible, scored as information.
console.log(`INFO  one person, two roles, same note: ${dupes.length} pair(s) — collapsed by the chip query`);

// TWO VERY DIFFERENT THINGS WERE BEING COUNTED AS ONE.
//
// observation_raw_names.resolved_to is a LEDGER of which spoken name became
// which card. A null there can mean either:
//
//   the ledger is behind  -- the observation does have people on it, we just
//                            never wrote down which name produced which one
//   nobody was attached   -- the name genuinely reached no card, which is the
//                            "it didn't tag Maggie" failure
//
// Only the second is a tagging bug, and only the second belongs in a PASS/FAIL.
const rawNames = await all(
  `SELECT n.raw_name,
          count(*)::int AS n,
          count(*) FILTER (
            WHERE NOT EXISTS (SELECT 1 FROM observation_participants p
                               WHERE p.observation_id = o.observation_id)
          )::int AS nobody
     FROM observations o JOIN observation_raw_names n USING (observation_id)
    WHERE o.deleted_at IS NULL AND n.resolved_to IS NULL
      AND o.created_at > now() - ($1 || ' hours')::interval
    GROUP BY 1 ORDER BY 3 DESC, 2 DESC`, [HOURS]);
const untagged = rawNames.filter((r) => r.nobody > 0);
const ledgerOnly = rawNames.filter((r) => r.nobody === 0);
check("every spoken name reached a card", untagged.length === 0,
  untagged.map((r) => `${r.raw_name}×${r.nobody}`).join(", ") || "none unmatched");
if (untagged.length > 0) {
  const detail = await all(
    `SELECT n.raw_name, o.kind, o.source, o.created_at, left(o.body, 60) AS body
       FROM observations o JOIN observation_raw_names n USING (observation_id)
      WHERE o.deleted_at IS NULL AND n.resolved_to IS NULL
        AND o.created_at > now() - ($1 || ' hours')::interval
        AND NOT EXISTS (SELECT 1 FROM observation_participants p
                         WHERE p.observation_id = o.observation_id)
      ORDER BY o.created_at`, [HOURS]);
  for (const r of detail) {
    console.log(`      ${new Date(r.created_at).toISOString()}  ${r.raw_name} — ${r.kind}/${r.source}  "${r.body}…"`);
  }
}
if (ledgerOnly.length) {
  console.log(`INFO  tagged, but the name→card ledger was not written: ` +
    ledgerOnly.map((r) => `${r.raw_name}×${r.n}`).join(", "));
}

// ── 3. Open questions ────────────────────────────────────────────────────────
section("Resolution queue");

// A resolved pending is DELETED, not flagged -- so anything still in this table
// is still being asked. Old rows are the interesting ones: a question from days
// ago that was never answered is a question that is never going away on its own.
const pend = await all(
  `SELECT awaiting, count(*)::int AS n,
          count(*) FILTER (WHERE updated_at < now() - interval '1 hour')::int AS old
     FROM pending_fact_context GROUP BY 1`);
const openNow = pend.reduce((n, r) => n + r.n, 0);
const openOld = pend.reduce((n, r) => n + r.old, 0);
check("no question has been left hanging for over an hour", openOld === 0,
  `${openNow} open, ${openOld} older than an hour` +
  (pend.length ? ` (${pend.map((r) => `${r.awaiting}=${r.n}`).join(" ")})` : ""));

// ── 4. The dictionary ────────────────────────────────────────────────────────
section("Voice dictionary");

const vocab = await one(
  `SELECT count(*)::int AS n,
          count(*) FILTER (WHERE heard <> corrected_to)::int AS repairs,
          count(*) FILTER (WHERE contact_id IS NOT NULL)::int AS tagged
     FROM voice_vocabulary`);
check("spellings are being learned", vocab.repairs > 0,
  `${vocab.repairs} repairs, ${vocab.tagged} tied to a contact, ${vocab.n} entries total`);

const mem = await one(
  `SELECT count(*)::int AS n,
          count(*) FILTER (WHERE stable_streak >= 2)::int AS trusted
     FROM contact_name_memory`);
check("name memory has trusted pointers", mem.trusted > 0, `${mem.trusted}/${mem.n} at streak >= 2`);

// THE SAME RULE THE LEARNER USES, or this check demands work we deliberately
// refuse to do. It used to fail on victor→Victor Udobong and maggie→Maggie Chen,
// which are not repairs at all: the transcriber wrote what was said. A repair is
// a form that matches NEITHER the full name NOR the first name.
const untaught = await all(
  `SELECT m.name_key, c.full_name
     FROM contact_name_memory m
     JOIN contacts c ON c.id = m.contact_id AND c.owner_id = m.owner_id
    WHERE m.stable_streak >= 2 AND c.deleted_at IS NULL
      AND lower(c.full_name) <> lower(m.name_key)
      AND lower(split_part(c.full_name, ' ', 1)) <> lower(m.name_key)
      AND NOT EXISTS (SELECT 1 FROM voice_vocabulary v
                       WHERE v.owner_id = m.owner_id AND lower(v.heard) = lower(m.name_key))
    LIMIT 10`);
check("every misheard name that has stuck is in the dictionary", untaught.length === 0,
  untaught.map((r) => `${r.name_key}→${r.full_name}`).join(", ") || "none outstanding");

// ── 5. Derived scores ────────────────────────────────────────────────────────
section("Rollups");

const rollup = await one(
  `SELECT
     (SELECT count(*)::int FROM contact_scores) AS scores,
     (SELECT count(*)::int FROM contact_dimension_state) AS dims,
     (SELECT count(*)::int FROM events) AS events`);
check("scores exist", rollup.scores > 0, `${rollup.scores} contact_scores`);
check("dimensions exist", rollup.dims > 0, `${rollup.dims} dimension rows`);
check("experiences became events", rollup.events > 0, `${rollup.events} events`);

// NOT "HAS NO DIMENSIONS" -- "HAS NOT BEEN LOOKED AT". Plenty of observations
// are correctly classified as carrying none of the six dimensions ("Sagar is
// handling BMA this week" is logistics, not health), and dimension_status is
// 'done' with zero rows. Counting missing rows as a backlog reported 51 items
// the worker had already finished with, while it sat there logging classified=0
// because there was genuinely nothing pending. The queue's own column is the
// only honest measure.
const stale = await one(
  `SELECT
     count(*) FILTER (WHERE dimension_status = 'pending'
                        AND created_at < now() - interval '5 minutes')::int AS waiting,
     count(*) FILTER (WHERE dimension_status = 'none')::int AS none_,
     count(*) FILTER (WHERE dimension_status IN ('lexicon','llm','human'))::int AS classified
     FROM observations WHERE deleted_at IS NULL`);
check("the dimension queue is drained", stale.waiting === 0,
  `${stale.waiting} pending over 5 min; ${stale.classified} classified, ${stale.none_} carry none by design`);

console.log(
  `\n${failures === 0
    ? idle
      ? `Nothing was recorded in the last ${HOURS}h; everything that could be checked passed.`
      : "All checks passed."
    : `${failures} check(s) failed — see FAIL above.`}`,
);
await closePool();
process.exit(failures === 0 ? 0 : 1);
