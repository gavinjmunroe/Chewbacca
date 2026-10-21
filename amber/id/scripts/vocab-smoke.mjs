/**
 * SMOKE TEST — the voice dictionary, which is the tagging pipeline.
 *
 *     SMOKE_DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch \
 *       node scripts/vocab-smoke.mjs
 *
 * The reported symptom was that voice notes tag the right contact sometimes and
 * nobody other times, with no pattern. There was no pattern: voice-vocab.js wrote
 * five columns that do not exist and caught the error as "fail-open", so nothing
 * was ever stored and tagging only worked when the raw transcript already happened
 * to be right.
 *
 * SO THE FIRST ASSERTION IN THIS FILE IS "A WRITE ACTUALLY ARRIVES". That is the
 * one that was failing, and no test asked it. Every function here is checked by
 * reading the row back, never by the call returning without throwing -- a
 * fire-and-forget function that swallows its own errors returns successfully from
 * doing nothing at all.
 */
process.env.IDENTITY_KEY_PEPPER ||= "smoke-only-pepper-not-a-real-secret-0123456789";

import { pool, query, closePool } from "./smoke-db.mjs";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";
import * as V from "../src/lib/voice-vocab.js";

__injectPoolForSmokeTests(pool);

let pass = 0, fail = 0;
const ok = (c, m, d = "") => {
  if (c) { pass++; console.log("  ✓ " + m); }
  else { fail++; console.log("  ✗ " + m + (d ? "   " + d : "")); }
};

const K  = "aaaaaaaa-0000-4000-8000-00000000fa01";
const K2 = "aaaaaaaa-0000-4000-8000-00000000fa02";
const C_AJAY   = "11111111-0000-4000-8000-00000000fb01";
const C_SAGAR  = "11111111-0000-4000-8000-00000000fb02";

await query(`TRUNCATE voice_vocabulary, contacts, users RESTART IDENTITY CASCADE`);
await query(`INSERT INTO users (amber_id, phone, full_name) VALUES
  ($1,'+14155551001','Karthik'), ($2,'+14155551002','Other')`, [K, K2]);
await query(`INSERT INTO contacts (id, owner_id, full_name) VALUES
  ($1,$3,'Ajay Devarakonda'), ($2,$3,'Sagar Patel')`, [C_AJAY, C_SAGAR, K]);

const rowsFor = async (owner) => (await query(
  `SELECT heard, corrected_to, hit_count, contact_id FROM voice_vocabulary
    WHERE owner_id = $1 ORDER BY heard`, [owner])).rows;

// ── the write that was never happening ───────────────────────────────────────
console.log("\n── a write reaches the table ──");
const n = await V.recordVoiceVocab(K, ["Ajay", "Rytual"], C_AJAY);
ok(n === 2, "two terms are stored in one statement, not one round trip each", String(n));
const stored = await rowsFor(K);
ok(stored.length === 2, "and the rows are really there", JSON.stringify(stored.map((r) => r.heard)));
ok(stored.every((r) => r.heard === r.corrected_to),
   "a bare preferred spelling is stored as heard = corrected_to");
ok(stored.find((r) => r.heard === "Ajay")?.contact_id === C_AJAY,
   "carrying the contact it belongs to — a uuid, which the old /^\\d+$/ check rejected",
   JSON.stringify(stored.find((r) => r.heard === "Ajay")));

// ── reinforcement ────────────────────────────────────────────────────────────
console.log("\n── saying it again reinforces rather than duplicates ──");
await V.recordVoiceVocab(K, ["Ajay"], null);
const again = await rowsFor(K);
ok(again.length === 2, "still two rows", String(again.length));
ok(again.find((r) => r.heard === "Ajay")?.hit_count === 2, "and the hit count went up");
ok(again.find((r) => r.heard === "Ajay")?.contact_id === C_AJAY,
   "a later write with no contact does not erase the contact already known");

// ── corrections ──────────────────────────────────────────────────────────────
console.log("\n── a correction, and what makes it a correction ──");
ok((await V.recordVoiceCorrection(K, "A J", "Ajay", C_AJAY)) === true,
   "heard -> intended is stored");
const corrections = await V.getVoiceCorrections(K);
ok(corrections.length === 1,
   "and read back as exactly one pair — the preferred spellings are not corrections",
   JSON.stringify(corrections));
ok(corrections[0].heard === "A J" && corrections[0].term === "Ajay",
   "both halves survive", JSON.stringify(corrections[0]));
ok(corrections[0].contactId === C_AJAY, "with the contact attached");
ok((await V.recordVoiceCorrection(K, "Ajay", "ajay")) === false,
   "a correction differing only in case is refused");
ok((await V.recordVoiceCorrection(K, "Sagar", "Sagar")) === false,
   "and one that changes nothing at all is refused");

// ── the bias prompt ──────────────────────────────────────────────────────────
console.log("\n── the bias list, newest first ──");
const bias = await V.getVoiceVocab(K);
ok(bias.length === 2 && bias.includes("Ajay") && bias.includes("Rytual"),
   "the decoder gets the spellings this owner wants", JSON.stringify(bias));
ok(bias.every((b) => typeof b === "string" && b.length > 0),
   "as plain strings, not rows");
// This is the assertion that was silently empty forever: an empty bias list is
// indistinguishable from "this user has taught us nothing", which is why nobody
// noticed the reads were throwing.
ok(bias.length > 0, "and it is NOT EMPTY, which is how the old failure looked");

// ── the actual tagging map ───────────────────────────────────────────────────
console.log("\n── term -> contact, which is the whole point ──");
await V.recordVoiceCorrection(K, "Sugar", "Sagar", C_SAGAR);
const map = await V.getVocabContactMap(K);
ok(map.get("ajay") === C_AJAY, "the corrected spelling names the contact");
ok(map.get("a j") === C_AJAY, "and so does the misheard one — a transcript may hold either");
ok(map.get("sugar") === C_SAGAR && map.get("sagar") === C_SAGAR,
   "both forms for the second contact too");
// "Rytual" was in the SAME batch as "Ajay", with the same contactId. It is not
// in the map, and that is the guard working: only a term matching the contact's
// name gets linked, because otherwise a transcript saying "Rytual" would tag Ajay
// — a false positive manufactured by the tagging system's own memory.
ok(!map.has("rytual"),
   "a company name in the same batch is NOT linked to the person",
   JSON.stringify([...map.keys()]));
const rytualRow = (await rowsFor(K)).find((r) => r.heard === "Rytual");
ok(rytualRow && rytualRow.contact_id === null,
   "it is still stored for the bias prompt, just with no contact",
   JSON.stringify(rytualRow));

// ── owner isolation ──────────────────────────────────────────────────────────
console.log("\n── one owner's dictionary is not another's ──");
await V.recordVoiceVocab(K2, ["Ajay"], null);
ok((await V.getVoiceVocab(K2)).length === 1, "the second owner has their own single term");
ok((await V.getVocabContactMap(K2)).size === 0,
   "and no contact map, because they linked nothing");
const mine = await rowsFor(K);
ok(mine.length === 4, "the first owner still has four rows", String(mine.length));
// The composite FK is the thing that makes this structural rather than habitual.
let crossOwner = false;
try {
  await query(
    `INSERT INTO voice_vocabulary (owner_id, heard, corrected_to, contact_id)
     VALUES ($1, 'x', 'y', $2)`, [K2, C_AJAY]);
  crossOwner = true;
} catch { /* expected */ }
ok(crossOwner === false,
   "and the FK refuses a row pointing at another owner's contact outright");

// ── substitution, which must not mangle the sentence ─────────────────────────
console.log("\n── applying corrections to a transcript ──");
const applied = V.applyVocabCorrections("I saw A J and Sugar at the thing", corrections.concat(
  [{ heard: "Sugar", term: "Sagar" }]));
ok(applied.text === "I saw Ajay and Sagar at the thing",
   "both names repaired, sentence intact", JSON.stringify(applied.text));
const noMangle = V.applyVocabCorrections("that was a major problem", [{ heard: "AJ", term: "Ajay" }]);
ok(noMangle.text === "that was a major problem",
   "and 'major' does not become 'majay' — whole words only", JSON.stringify(noMangle.text));

// ── failure is loud ──────────────────────────────────────────────────────────
console.log("\n── a schema mismatch is reported, not swallowed ──");
// The old code caught this and commented it "fail-open", which is how it stayed
// broken. Fail-open is right; fail-SILENT is what cost the months.
const seen = [];
const realError = console.error;
console.error = (...a) => seen.push(a.join(" "));
try {
  await query(`ALTER TABLE voice_vocabulary RENAME COLUMN corrected_to TO corrected_to_x`);
  const broke = await V.recordVoiceVocab(K, ["Anything"], null);
  ok(broke === 0, "the write reports that it did not happen, rather than returning void");
  ok((await V.getVoiceVocab(K)).length === 0, "and the read degrades to empty");
} finally {
  await query(`ALTER TABLE voice_vocabulary RENAME COLUMN corrected_to_x TO corrected_to`);
  console.error = realError;
}
ok(seen.some((s) => s.includes("VOCAB_SCHEMA_MISMATCH")),
   "with a log line that names it as a schema mismatch, not a data condition",
   JSON.stringify(seen.slice(0, 1)));
// Three distinct spellings by now: Ajay, Rytual, Sagar.
ok((await V.getVoiceVocab(K)).length === 3, "and it recovers once the column is back",
   JSON.stringify(await V.getVoiceVocab(K)));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await closePool();
process.exit(fail ? 1 : 0);
