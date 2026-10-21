/**
 * SMOKE TEST — the contact rollup.
 *
 *     SMOKE_DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch \
 *       node scripts/contact-rollup-smoke.mjs
 *
 * contact_interaction_stats and contact_scores were designed in migrations 008
 * and 009 and never written to. The claims worth testing are not "does the
 * INSERT run" but the ones that would be silently wrong:
 *
 *   - a future event is not an interaction
 *   - a group observation counts for everyone who was there, not just the
 *     nominal subject
 *   - a DM reaches the contact through the linked account, and only the owner's
 *     own threads
 *   - a chat with Amber is not contact with a person
 *   - deleting the last piece of evidence removes the row rather than leaving a
 *     stale "last seen in March"
 *   - the job is idempotent, and every contact gets a score even with nothing
 *     to score
 */
process.env.IDENTITY_KEY_PEPPER ||= "smoke-only-pepper-not-a-real-secret-0123456789";

import { pool, query, closePool } from "./smoke-db.mjs";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";
import * as R from "../src/db/contact-rollup.js";

__injectPoolForSmokeTests(pool);

let pass = 0, fail = 0;
const ok = (c, m, d = "") => {
  if (c) { pass++; console.log("  ✓ " + m); }
  else { fail++; console.log("  ✗ " + m + (d ? "   " + d : "")); }
};

const K     = "aaaaaaaa-0000-4000-8000-000000000001"; // the owner
const OTHER = "aaaaaaaa-0000-4000-8000-000000000002"; // a different owner
const FRIEND= "aaaaaaaa-0000-4000-8000-000000000003"; // an Amber user the owner DMs

const C_DM    = "11111111-0000-4000-8000-0000000000d1"; // linked to FRIEND
const C_GROUP = "11111111-0000-4000-8000-0000000000b1";
const C_EVENT = "11111111-0000-4000-8000-0000000000e1";
const C_EMPTY = "11111111-0000-4000-8000-0000000000c1";
const C_OTHER = "22222222-0000-4000-8000-0000000000a1"; // belongs to OTHER

await query(`TRUNCATE contact_scores, contact_interaction_stats, contact_dimension_state,
  observation_dimensions, observation_participants, observation_raw_names, observations,
  dm_messages, dm_threads, events, conversation_messages, conversations,
  contacts, users RESTART IDENTITY CASCADE`);

await query(
  `INSERT INTO users (amber_id, phone, full_name) VALUES
     ($1,'+14150000001','Karthik'), ($2,'+14150000002','Someone Else'), ($3,'+14150000003','Friend')`,
  [K, OTHER, FRIEND]);

await query(
  `INSERT INTO contacts (id, owner_id, full_name, linked_amber_id, phone_primary, emails,
                         company, title, city, birthday, linkedin_url) VALUES
     ($1,$2,'DM Friend',$3,'+14150000003','f@x.com','Acme','Eng','SF','1990-01-01','li/f'),
     ($4,$2,'Group Person',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
     ($5,$2,'Event Person',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
     ($6,$2,'Nobody',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
     ($7,$8,'Not Yours',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
  [C_DM, K, FRIEND, C_GROUP, C_EVENT, C_EMPTY, C_OTHER, OTHER]);

const obs = async (ownerId, contactId, body, observedAt, participants = []) => {
  const { rows } = await query(
    `INSERT INTO observations (owner_id, contact_id, kind, body, observed_at, source,
                               confidence, status)
     VALUES ($1,$2,'fact',$3,$4,'told_directly',0.9,'resolved')
     RETURNING observation_id`,
    [ownerId, contactId, body, observedAt]);
  const id = rows[0].observation_id;
  for (const p of participants) {
    await query(
      `INSERT INTO observation_participants (observation_id, owner_id, contact_id, role)
       VALUES ($1,$2,$3,'participant')`, [id, ownerId, p]);
  }
  return id;
};

const days = (n) => new Date(Date.now() - n * 86400000).toISOString();
const statsFor = async (cid) => (await query(
  `SELECT * FROM contact_interaction_stats WHERE owner_id=$1 AND contact_id=$2`, [K, cid])).rows[0];
const scoreFor = async (cid) => (await query(
  `SELECT * FROM contact_scores WHERE owner_id=$1 AND contact_id=$2`, [K, cid])).rows[0];

// ── what counts, and what does not ───────────────────────────────────────────
console.log("\n── what counts as an interaction ──");

// A dinner ten days ago with the group person present, subject = event person.
const dinner = await obs(K, C_EVENT, "dinner at the thai place", days(10), [C_GROUP]);
// A fact about the group person alone, 100 days ago.
await obs(K, C_GROUP, "she started a new job", days(100));
// A future event -- on the calendar, has not happened.
await query(
  `INSERT INTO events (owner_id, contact_id, kind, title, starts_at)
   VALUES ($1,$2,'dinner','next month', now() + interval '30 days')`, [K, C_EVENT]);
// A past event, 5 days ago.
await query(
  `INSERT INTO events (owner_id, contact_id, kind, title, starts_at)
   VALUES ($1,$2,'coffee','last week', now() - interval '5 days')`, [K, C_EVENT]);
// A DM thread with FRIEND, three messages, both directions.
const pair = [K, FRIEND].sort();
const { rows: tr } = await query(
  `INSERT INTO dm_threads (a_amber_id, b_amber_id) VALUES ($1,$2) RETURNING id`, pair);
const threadId = tr[0].id;
for (const [sender, when] of [[K, days(2)], [FRIEND, days(2)], [K, days(200)]]) {
  await query(
    `INSERT INTO dm_messages (thread_id, sender_amber_id, kind, body, created_at)
     VALUES ($1,$2,'text','hi',$3)`, [threadId, sender, when]);
}
// A chat with Amber that mentions nobody -- must not become an interaction.
const { rows: cv } = await query(
  `INSERT INTO conversations (owner_id, kind, title) VALUES ($1,'chat','about maggie')
   RETURNING conversation_id`, [K]);
await query(
  `INSERT INTO conversation_messages (conversation_id, owner_id, role, content)
   VALUES ($1,$2,'user','tell me about the event person')`, [cv[0].conversation_id, K]);

const n1 = await R.refreshInteractionStats(K);
ok(n1 === 3, "three of the four contacts have interactions; the empty one has none", `got ${n1}`);
ok((await statsFor(C_EMPTY)) === undefined, "a contact with no evidence gets no row");

const evStats = await statsFor(C_EVENT);
ok(evStats.count_all === 2,
   "the past event and the dinner count; the future event does not",
   JSON.stringify(evStats && { all: evStats.count_all, d30: evStats.count_30d }));
ok(new Date(evStats.last_interaction_at) < new Date(),
   "last_interaction_at is in the past, not the calendar entry a month out",
   String(evStats.last_interaction_at));

const grStats = await statsFor(C_GROUP);
ok(grStats.count_all === 2,
   "the group person got the dinner too, via observation_participants, plus their own fact",
   `count_all=${grStats.count_all}`);
ok(grStats.count_30d === 1 && grStats.count_90d === 1,
   "and the 100-day-old fact is outside both windows",
   JSON.stringify({ d30: grStats.count_30d, d90: grStats.count_90d }));

const dmStats = await statsFor(C_DM);
ok(dmStats.count_all === 3, "all three DMs count, both directions", `count_all=${dmStats.count_all}`);
ok(dmStats.count_90d === 2, "the 200-day-old one is outside the 90-day window",
   `count_90d=${dmStats.count_90d}`);

// The Amber chat produced no observation, so it contributed nothing anywhere.
const total = (await query(
  `SELECT sum(count_all)::int t FROM contact_interaction_stats WHERE owner_id=$1`, [K])).rows[0].t;
ok(total === 7, "a chat with Amber is not contact with a person", `total=${total}`);

// ── owner isolation ──────────────────────────────────────────────────────────
console.log("\n── one account cannot see another ──");
await obs(OTHER, C_OTHER, "not yours", days(1));
await R.refreshInteractionStats(OTHER);
const leaked = (await query(
  `SELECT count(*)::int n FROM contact_interaction_stats WHERE owner_id=$1 AND contact_id=$2`,
  [K, C_OTHER])).rows[0].n;
ok(leaked === 0, "the other owner's contact is not in this owner's stats");

// A DM thread between two OTHER people must not reach this owner's contacts.
const pair2 = [OTHER, FRIEND].sort();
const { rows: tr2 } = await query(
  `INSERT INTO dm_threads (a_amber_id, b_amber_id) VALUES ($1,$2) RETURNING id`, pair2);
await query(
  `INSERT INTO dm_messages (thread_id, sender_amber_id, kind, body, created_at)
   VALUES ($1,$2,'text','hi', now())`, [tr2[0].id, OTHER]);
await R.refreshInteractionStats(K);
const dmAfter = await statsFor(C_DM);
ok(dmAfter.count_all === 3,
   "a thread the owner is not in does not touch their contact's count",
   `count_all=${dmAfter.count_all}`);

// ── the scores ───────────────────────────────────────────────────────────────
console.log("\n── contact_scores ──");
const n2 = await R.refreshContactScores(K);
ok(n2 === 4, "every contact gets a row, including the one with nothing", `got ${n2}`);

const sEmpty = await scoreFor(C_EMPTY);
ok(sEmpty.warmth === 0, "no interaction means warmth 0, not warmth 1", `warmth=${sEmpty.warmth}`);
ok(sEmpty.last_interaction_at === null, "and no last_interaction_at");

const sDm = await scoreFor(C_DM);
const sGroup = await scoreFor(C_GROUP);
ok(sDm.base_score > sEmpty.base_score,
   "a contact with any history outranks one with none",
   JSON.stringify({ dm: sDm.base_score, empty: sEmpty.base_score }));

// THIS ASSERTION USED TO SAY "two days ago is warmer than ten days ago" and it
// now fails, correctly. Recency is no longer the whole of warmth: the DM contact
// was seen 2 days ago but 3 times in 200 days, and the group contact 10 days ago
// but twice in 100 -- a denser relationship. Under the old curve recency was
// everything and the more recent one always won, which is what made a 45-day
// half-life look survivable. So the two claims are tested SEPARATELY, each with
// the other variable held still, because that is what the model actually says.
console.log("\n── recency and cadence, one at a time ──");
const cmp = async (label, aArgs, bArgs) => {
  const [A, B] = ["11111111-0000-4000-8000-00000000aa01", "11111111-0000-4000-8000-00000000bb01"];
  await query(`DELETE FROM contact_scores WHERE contact_id = ANY($1)`, [[A, B]]);
  await query(`DELETE FROM contact_interaction_stats WHERE contact_id = ANY($1)`, [[A, B]]);
  await query(`DELETE FROM contacts WHERE id = ANY($1)`, [[A, B]]);
  await query(`INSERT INTO contacts (id, owner_id, full_name) VALUES ($1,$2,'A'),($3,$2,'B')`,
              [A, K, B]);
  for (const [id, { count, lastDays, firstDays }] of [[A, aArgs], [B, bArgs]]) {
    for (let i = 0; i < count; i++) {
      const at = i === 0 ? lastDays : firstDays - ((firstDays - lastDays) * i) / count;
      await obs(K, id, `interaction ${i}`, days(at));
    }
  }
  await R.refreshOwner(K);
  const wa = (await scoreFor(A)).warmth;
  const wb = (await scoreFor(B)).warmth;
  return { wa, wb, label };
};

const recencyOnly = await cmp("recency",
  { count: 4, lastDays: 3,  firstDays: 300 },
  { count: 4, lastDays: 90, firstDays: 300 });
ok(recencyOnly.wa > recencyOnly.wb,
   "same cadence, seen 3 days ago beats seen 90 days ago",
   JSON.stringify([recencyOnly.wa, recencyOnly.wb]));

const cadenceOnly = await cmp("cadence",
  { count: 20, lastDays: 5, firstDays: 300 },
  { count: 2,  lastDays: 5, firstDays: 300 });
ok(cadenceOnly.wa > cadenceOnly.wb,
   "same recency, seen twenty times beats seen twice",
   JSON.stringify([cadenceOnly.wa, cadenceOnly.wb]));

// The ordering Karthik actually asked for: dormant is not the same as stranger.
const dormant = await cmp("dormant",
  { count: 6, lastDays: 2000, firstDays: 3000 },
  { count: 6, lastDays: 10,   firstDays: 1000 });
ok(dormant.wa > 0,
   "a friend you have not spoken to in five years still has warmth, not zero",
   String(dormant.wa));
ok(dormant.wa < dormant.wb,
   "but less than someone you saw last week",
   JSON.stringify([dormant.wa, dormant.wb]));
const neverTouched = await scoreFor(C_EMPTY);
ok(neverTouched && neverTouched.warmth < dormant.wa,
   "and a contact you have NEVER interacted with is below both — the floor means "
   + "'we used to be in contact', which they cannot claim",
   JSON.stringify([neverTouched?.warmth, dormant.wa]));

ok(Math.abs(sDm.completeness - 1) < 0.001,
   "a fully-filled contact scores completeness 1", `${sDm.completeness}`);
ok(sEmpty.completeness > 0 && sEmpty.completeness < 0.2,
   "a name-only contact scores 1/8, not 0 -- it is the cold-start tiebreak",
   `${sEmpty.completeness}`);
ok(sEmpty.base_score > 0,
   "so a fresh import is ordered by completeness rather than being all zeroes",
   `${sEmpty.base_score}`);

ok(sGroup.observation_count === 2,
   "observation_count counts facts, not events and DMs",
   `${sGroup.observation_count}`);
ok(sDm.observation_count === 0,
   "the DM contact has three interactions and zero facts, and the two are different questions",
   `${sDm.observation_count}`);

const bounded = (await query(
  `SELECT count(*)::int n FROM contact_scores
    WHERE owner_id=$1 AND (base_score < 0 OR base_score > 1 OR warmth < 0 OR warmth > 1)`,
  [K])).rows[0].n;
ok(bounded === 0, "every score is inside 0..1");

// ── idempotence ──────────────────────────────────────────────────────────────
console.log("\n── running it again changes nothing ──");
const before = (await query(
  `SELECT contact_id, base_score, warmth, observation_count, completeness
     FROM contact_scores WHERE owner_id=$1 ORDER BY contact_id`, [K])).rows;
await R.refreshOwner(K);
const after = (await query(
  `SELECT contact_id, base_score, warmth, observation_count, completeness
     FROM contact_scores WHERE owner_id=$1 ORDER BY contact_id`, [K])).rows;
const drift = before.filter((b, i) =>
  b.contact_id !== after[i].contact_id ||
  Math.abs(b.base_score - after[i].base_score) > 0.001 ||
  b.observation_count !== after[i].observation_count);
ok(drift.length === 0, "a second pass produces the same numbers", JSON.stringify(drift.slice(0, 2)));

// ── evidence going away ──────────────────────────────────────────────────────
console.log("\n── stale rows are removed, not left behind ──");
await query(`UPDATE observations SET deleted_at = now() WHERE owner_id=$1 AND contact_id=$2`,
            [K, C_GROUP]);
await query(`DELETE FROM observation_participants WHERE owner_id=$1 AND contact_id=$2`,
            [K, C_GROUP]);
await R.refreshOwner(K);
ok((await statsFor(C_GROUP)) === undefined,
   "a contact whose last evidence was deleted loses its stats row");
const sGroupAfter = await scoreFor(C_GROUP);
ok(sGroupAfter && sGroupAfter.warmth === 0 && sGroupAfter.last_interaction_at === null,
   "but keeps a score row, reset to cold -- they are still in the address book",
   JSON.stringify(sGroupAfter && { w: sGroupAfter.warmth, l: sGroupAfter.last_interaction_at }));

await query(`UPDATE contacts SET deleted_at = now() WHERE owner_id=$1 AND id=$2`, [K, C_EMPTY]);
await R.refreshOwner(K);
ok((await scoreFor(C_EMPTY)) === undefined,
   "a soft-deleted contact drops out of contact_scores -- the FK only fires on a hard delete");

// ── the tuning table is real ─────────────────────────────────────────────────
console.log("\n── the coefficients are data, not code ──");
const warmBefore = (await scoreFor(C_DM)).warmth;
await query(`INSERT INTO scoring_params (key, value, note)
             VALUES ('warmth_half_life_days', 1, 'smoke override')
             ON CONFLICT (key) DO UPDATE SET value = 1`);
await R.refreshContactScores(K);
const warmAfter = (await scoreFor(C_DM)).warmth;
ok(warmAfter < warmBefore,
   "shortening the half-life in scoring_params cools everyone, with no deploy",
   JSON.stringify({ before: warmBefore, after: warmAfter }));
await query(`UPDATE scoring_params SET value = 45 WHERE key = 'warmth_half_life_days'`);

// A missing row must not break the job -- the module carries the same defaults.
await query(`DELETE FROM scoring_params WHERE key = 'warmth_half_life_days'`);
let survived = true;
try { await R.refreshContactScores(K); } catch { survived = false; }
ok(survived, "and deleting the row falls back to the module default rather than failing");
const stillBounded = (await query(
  `SELECT count(*)::int n FROM contact_scores WHERE owner_id=$1 AND base_score IS NULL`,
  [K])).rows[0].n;
ok(stillBounded === 0, "with no NULL scores from the missing parameter");
await query(`INSERT INTO scoring_params (key, value, note)
             VALUES ('warmth_half_life_days', 45, 'restored') ON CONFLICT (key) DO NOTHING`);

// ── the sweep order ──────────────────────────────────────────────────────────
console.log("\n── the fleet pass picks the stalest first ──");
const owners = await R.ownersNeedingRefresh(10);
ok(owners.length >= 2, "both owners are listed", `${owners.length}`);
ok(owners[0].ownerId === OTHER,
   "the owner who has never been scored sorts before the one just rolled up",
   JSON.stringify(owners.map((o) => o.ownerId.slice(-4))));

const summary = await R.rollupSummary(K);
ok(summary.score_rows === summary.contacts,
   "every live contact has a score row", JSON.stringify(summary));

// ── at a size where the shape of the query matters ───────────────────────────
console.log("\n── 2,000 contacts in one pass ──");
// The delete sweep is an anti-join against the whole interaction stream. Written
// the obvious way it is correlated -- the stream re-evaluated once per row -- and
// that is invisible at four contacts and quadratic at four thousand.
await query(
  `INSERT INTO contacts (id, owner_id, full_name)
   SELECT gen_random_uuid(), $1, 'Bulk ' || g FROM generate_series(1, 2000) g`, [OTHER]);
await query(
  `INSERT INTO observations (owner_id, contact_id, kind, body, observed_at, source,
                             confidence, status)
   SELECT $1, c.id, 'fact', 'bulk fact', now() - (random() * 200 || ' days')::interval,
          'told_directly', 0.9, 'resolved'
     FROM contacts c WHERE c.owner_id = $1 AND c.full_name LIKE 'Bulk %'`, [OTHER]);

const t0 = Date.now();
const bulk = await R.refreshOwner(OTHER);
const elapsed = Date.now() - t0;
ok(bulk.scores === 2001,
   "every contact scored, including the one from the isolation test",
   `${bulk.scores} rows in ${elapsed}ms`);
ok(elapsed < 15000, "and it is one pass, not a scan per contact", `${elapsed}ms`);

const mineUntouched = await scoreFor(C_DM);
ok(mineUntouched && mineUntouched.observation_count === 0,
   "rolling up another account changed nothing in this one");

const bulkSample = (await query(
  `SELECT count(*)::int n FROM contact_scores
    WHERE owner_id=$1 AND observation_count = 1 AND warmth > 0`, [OTHER])).rows[0].n;
// 2001, not 2000: C_OTHER from the isolation test also has exactly one fact.
ok(bulkSample === 2001, "all of them got their fact and a warmth", `${bulkSample}`);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await closePool();
process.exit(fail ? 1 : 0);
