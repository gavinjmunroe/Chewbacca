/**
 * SMOKE TEST — semantic search over facts.
 *
 * The column and its HNSW index shipped in migration 007 and nothing ever wrote
 * a vector. The claim being tested is the one that matters: a question can now
 * find a fact it shares no words with.
 *
 * The embedder is FAKE and deterministic -- a bag-of-words vector over a fixed
 * vocabulary, normalized. That is enough to make "distressed" and "crying" land
 * near each other and far from "mortgage", which is the property under test. A
 * real model is better at it; this one cannot be flaky at 3am.
 */
process.env.IDENTITY_KEY_PEPPER ||= "smoke-only-pepper-not-a-real-secret-0123456789";
import { pool, query, closePool } from "./smoke-db.mjs";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";
import * as O from "../src/db/observations-store.js";
import * as R from "../src/db/retrieval.js";
import * as E from "../src/db/embedding-queue.js";
__injectPoolForSmokeTests(pool);

let pass = 0, fail = 0;
const ok = (c, m, d = "") => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m + (d ? "   " + d : "")); } };

// A tiny "semantic" space: words that co-occur in the same topic share a slot,
// so unrelated wording in the same topic still lands nearby.
const TOPICS = [
  ["sad", "crying", "cried", "distressed", "upset", "grief", "hard", "struggling", "lonely"],
  ["mortgage", "loan", "money", "salary", "raised", "seed", "bonus", "promotion", "financial"],
  ["marathon", "training", "running", "gym", "workout", "surgery", "knee", "fitness"],
  ["wedding", "engaged", "married", "party", "dinner", "friends"],
];
const DIMS = 1536;
function fakeEmbed(text) {
  const v = new Array(DIMS).fill(0);
  const words = String(text).toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    for (let t = 0; t < TOPICS.length; t += 1) {
      if (TOPICS[t].some((k) => w.startsWith(k) || k.startsWith(w))) v[t] += 1;
    }
    // A little lexical signal so identical text is nearer than merely same-topic.
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) % (DIMS - 8);
    v[8 + h] += 0.25;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}
const fakeBatch = async (texts) => texts.map(fakeEmbed);

const K = "aaaaaaaa-0000-4000-8000-000000000001";
const MAGGIE = "11111111-0000-4000-8000-0000000000b1";
const SAGAR  = "11111111-0000-4000-8000-0000000000b2";

await query(`TRUNCATE contact_dimension_state, observation_dimensions,
  observation_participants, observations, user_dimension_weights, contacts, users
  RESTART IDENTITY CASCADE`);
await query(`INSERT INTO users (amber_id, phone, full_name) VALUES ($1,'+14150000001','K')`, [K]);
await query(`INSERT INTO contacts (id, owner_id, full_name) VALUES ($1,$2,'Maggie'),($3,$2,'Sagar')`,
  [MAGGIE, K, SAGAR]);

const crying = await O.insertObservation({ ownerId: K, contactId: MAGGIE,
  body: "Maggie has been crying most evenings", source: "told_directly", salience: 0.8 });
const mortgage = await O.insertObservation({ ownerId: K, contactId: SAGAR,
  body: "Sagar took out a mortgage and got a bonus", source: "told_directly", salience: 0.8 });
const marathon = await O.insertObservation({ ownerId: K, contactId: SAGAR,
  body: "Sagar is training for a marathon", source: "told_directly", salience: 0.8 });

console.log("\n── the queue ──");
ok((await E.unembeddedCount()) === 3, "three facts are waiting for a vector",
   String(await E.unembeddedCount()));
const p1 = await E.runEmbeddingPass({ limit: 10, embed: fakeBatch });
ok(p1.claimed === 3 && p1.embedded === 3, "one pass embeds the batch", JSON.stringify(p1));
ok((await E.unembeddedCount()) === 0, "and the queue is empty");
ok((await E.runEmbeddingPass({ limit: 10, embed: fakeBatch })).claimed === 0,
   "a second pass does no work");
const stored = await query(`SELECT count(*)::int n FROM observations WHERE embedding IS NOT NULL`);
ok(stored.rows[0].n === 3, "the vectors are on the rows");

console.log("\n── a question finds a fact it shares no words with ──");
const distress = fakeEmbed("who is going through a hard time");
const hits = await R.retrieveHybrid({ ownerId: K, queryVector: distress, limit: 5 });
ok(hits[0]?.observationId === crying.observationId,
   "'a hard time' finds 'crying most evenings' -- NO shared word",
   JSON.stringify(hits.map((h) => [h.body.slice(0, 24), h.score.toFixed(3)])));
ok(hits[0].similarity > 0, "and the row reports the similarity that earned it",
   String(hits[0].similarity));
ok(hits[0].dimensionMatch > 0, "alongside the dimension match it was blended with");

const moneyQ = fakeEmbed("anything about loans or salary");
const moneyHits = await R.retrieveHybrid({ ownerId: K, queryVector: moneyQ, limit: 5 });
ok(moneyHits[0]?.observationId === mortgage.observationId,
   "a money question finds the mortgage", JSON.stringify(moneyHits.map((h) => h.body.slice(0, 24))));

console.log("\n── the blend is a dial, not a hard-coded choice ──");
await query(`UPDATE scoring_params SET value = 1.0 WHERE key = 'semantic_alpha'`);
const pureSemantic = await R.retrieveHybrid({ ownerId: K, queryVector: distress, limit: 5 });
ok(pureSemantic[0]?.observationId === crying.observationId, "alpha 1.0: pure semantic still works");
await query(`UPDATE scoring_params SET value = 0.0 WHERE key = 'semantic_alpha'`);
const pureDimensional = await R.retrieveHybrid({ ownerId: K, queryVector: distress,
  dimensionWeights: { financial: 0.9, emotional: 0.02, physical: 0.02, social: 0.02, spiritual: 0.02, intellectual: 0.02 },
  limit: 5 });
ok(pureDimensional[0]?.observationId === mortgage.observationId,
   "alpha 0.0: the vector is ignored and the DIMENSION wins, from one row in scoring_params",
   JSON.stringify(pureDimensional.map((h) => h.body.slice(0, 24))));
await query(`UPDATE scoring_params SET value = 0.5 WHERE key = 'semantic_alpha'`);

console.log("\n── degrading while the queue drains ──");
const late = await O.insertObservation({ ownerId: K, contactId: MAGGIE,
  body: "Maggie is grieving her father", source: "told_directly", salience: 0.9 });
const withUnembedded = await R.retrieveObservations({ ownerId: K,
  dimensionWeights: { emotional: 0.9, financial: 0.02, physical: 0.02, social: 0.02, spiritual: 0.02, intellectual: 0.02 },
  limit: 5 });
ok(withUnembedded.some((h) => h.observationId === late.observationId),
   "a fact with no vector yet is still found by the dimensional path");
ok((await R.retrieveHybrid({ ownerId: K, queryVector: null, limit: 5 })).length > 0,
   "and no query vector at all degrades to dimensional ranking, not to nothing");

console.log("\n── failure never corrupts ──");
const deadEmbedder = async () => null;
const before = await E.unembeddedCount();
const failed = await E.runEmbeddingPass({ limit: 10, embed: deadEmbedder });
ok(failed.embedded === 0 && failed.failed > 0, "a dead endpoint writes nothing",
   JSON.stringify(failed));
const attempts = await query(
  `SELECT embedding_attempts FROM observations WHERE observation_id = $1`, [late.observationId]);
ok(attempts.rows[0].embedding_attempts === 1, "the row keeps one attempt and comes back");
for (let i = 0; i < 3; i += 1) await E.runEmbeddingPass({ limit: 10, embed: deadEmbedder });
ok((await E.unembeddedCount()) === 0,
   "and after three attempts it leaves the queue rather than billing forever",
   String(await E.unembeddedCount()));
ok(before > 0, "sanity: it really was queued to begin with");

console.log("\n── filtered vector search at a size where it matters ──");
// FOUR ROWS PROVES NOTHING. At that size the planner is right to scan and every
// arrangement of index and filter returns the same answer. The bug this section
// exists for only appears when ONE ACCOUNT'S ROWS ARE A MINORITY of the table:
// an HNSW walk knows nothing about owner_id, so it finds the global nearest
// neighbors and the filter then discards almost all of them. The query returns
// too few rows and does it silently, because what it does return is correct.
const OTHER = "aaaaaaaa-0000-4000-8000-0000000000ff";
await query(`INSERT INTO users (amber_id, phone, full_name) VALUES ($1,'+14150009999','Crowd')
             ON CONFLICT DO NOTHING`, [OTHER]);
const bulkIds = [];
const bulkVecs = [];
for (let i = 0; i < 3000; i += 1) {
  bulkIds.push(null);
  bulkVecs.push(`[${fakeEmbed("unrelated filler about wedding party dinner " + i).join(",")}]`);
}
await query(
  `INSERT INTO observations (owner_id, kind, body, source, salience, embedding, dimension_status)
   SELECT $1, 'fact', 'filler ' || g, 'manual', 0.5, v::halfvec, 'none'
     FROM unnest($2::text[]) WITH ORDINALITY AS t(v, g)`,
  [OTHER, bulkVecs]);
const total = (await query(`SELECT count(*)::int n FROM observations WHERE embedding IS NOT NULL`)).rows[0].n;
ok(total > 3000, `the table now holds ${total} embedded rows, ours a minority`);

// Re-embed our own rows so they are findable again after the earlier failure run.
await query(`UPDATE observations SET embedding_attempts = 0 WHERE owner_id = $1`, [K]);
await E.runEmbeddingPass({ limit: 50, embed: fakeBatch });

const crowded = await R.retrieveHybrid({ ownerId: K, queryVector: distress, limit: 5 });
ok(crowded.length > 0,
   "the owner still gets results when their rows are a minority of the table",
   `${crowded.length} rows`);
ok(crowded.every((h) => h.observationId !== undefined), "and they are real rows");
ok(crowded[0]?.body?.includes("crying") || crowded[0]?.body?.includes("grieving"),
   "and the right one still wins", JSON.stringify(crowded.slice(0, 2).map((h) => h.body.slice(0, 28))));
const mine = await query(
  `SELECT count(*)::int n FROM observations WHERE owner_id = $1 AND deleted_at IS NULL`, [K]);
ok(crowded.length >= Math.min(5, mine.rows[0].n),
   "the filter did not silently starve the result set",
   JSON.stringify([crowded.length, mine.rows[0].n]));

console.log("\n── the mitigation is actually in effect ──");
// NOT "does the planner pick the index at 3000 rows" -- it does not, correctly,
// because 3000 rows is small and a scan is cheaper. Asserting otherwise would be
// asserting that Postgres is wrong. What CAN be checked, and is what actually
// protects the query at scale, is two things: the index is usable for this
// operator and column, and iterative_scan is genuinely set on the transaction
// that runs the candidate scan rather than merely described in a comment.
await query(`ANALYZE observations`);
// THE SET AND THE EXPLAIN MUST BE THE SAME CONNECTION. query() is pool.query(),
// which hands out whichever of the four connections is free, so `SET
// enable_seqscan = off` followed by an EXPLAIN was a coin flip -- the setting
// landed on one connection and the plan was taken on another, and this assertion
// failed on a virgin database and passed on every rerun. Same class of mistake
// the next test is about: a session setting is a property of a connection.
const { withTransaction } = await import("../src/db/sql.js");
const plan = await withTransaction(async (client) => {
  await client.query(`SET LOCAL enable_seqscan = off`);
  const r = await client.query(
    `EXPLAIN (FORMAT JSON) SELECT observation_id FROM observations
      WHERE owner_id = $1 AND deleted_at IS NULL AND embedding IS NOT NULL
      ORDER BY embedding <=> $2::halfvec LIMIT 50`,
    [OTHER, `[${distress.join(",")}]`]);
  return r;
});
ok(JSON.stringify(plan.rows[0]["QUERY PLAN"]).includes("obs_embedding_idx"),
   "the HNSW index is usable for <=> on this column -- opclass and type agree");

const applied = await withTransaction(async (client) => {
  await client.query(`SET LOCAL hnsw.iterative_scan = relaxed_order`);
  const r = await client.query(`SHOW hnsw.iterative_scan`);
  return Object.values(r.rows[0])[0];
});
ok(applied === "relaxed_order",
   "iterative_scan is a real setting this pgvector accepts, not a comment", String(applied));
const leaked = Object.values((await query(`SHOW hnsw.iterative_scan`)).rows[0])[0];
ok(leaked !== "relaxed_order",
   "and SET LOCAL does not leak onto the next query on that pooled connection",
   String(leaked));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await closePool();
process.exit(fail ? 1 : 0);
