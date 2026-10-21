/**
 * WHAT THE DUPLICATE FINDER ACTUALLY FOUND, IN FULL, FOR ONE OWNER.
 *
 *   railway run node scripts/duplicates-report.mjs +15551234567
 *
 * WHY THIS EXISTS. The sheet said "Two cards. One is on Amber." under every
 * pair, and the report back was: none of these people are on Amber, and there
 * are no duplicates in my contacts. Both halves of that are checkable and
 * neither can be checked from the app, because the app was showing one name and
 * one phone number out of two whole records.
 *
 * So this prints BOTH cards of every pair, whole: names, every phone, every
 * email, company, city, whether the row is linked to an Amber account, when it
 * was last touched and how many facts hang off it -- plus which of the two
 * sources produced the pair and the exact rule that fired.
 *
 * Read it and one of three things is true, and you can tell which:
 *
 *   THE PAIRS ARE REAL      two rows, same person, filed under different names.
 *                           That is why searching the contact list for the name
 *                           on the row finds only one.
 *   THE RULE IS TOO LOOSE   two rows, visibly different people. The reason line
 *                           says which rule let them through, and that rule is
 *                           the bug.
 *   THE ROWS ARE GHOSTS     a card with nothing on it that the contact list does
 *                           not draw. Then the duplicate is real and invisible,
 *                           which is its own bug.
 *
 * READ-ONLY. It runs the same two functions the route runs and prints what they
 * return. Nothing is merged, nothing is written.
 */
import { query, closePool } from "../src/db/sql.js";
import { duplicateCandidates, duplicateCandidatesFromBook } from "../src/db/contact-merge.js";
import { resolveAmberIdByPhone } from "../src/db/store.js";

const phone = process.argv[2];
if (!phone) {
  console.error("Usage: railway run node scripts/duplicates-report.mjs <your phone, e.g. +15551234567>");
  process.exit(2);
}

const ownerId = await resolveAmberIdByPhone(phone).catch(() => null);
if (!ownerId) {
  console.error(`No owner for ${phone}.`);
  process.exit(1);
}

const [fromBook, fromGraph] = await Promise.all([
  duplicateCandidatesFromBook(ownerId, { limit: 100 }).catch((e) => {
    console.error("fromBook failed:", e?.message || e);
    return [];
  }),
  duplicateCandidates(ownerId, { limit: 100 }).catch((e) => {
    console.error("fromGraph failed:", e?.message || e);
    return [];
  }),
]);

/** Every field that would let a person recognize their own contact. */
async function card(id) {
  const { rows } = await query(
    `SELECT c.id, c.full_name, c.first_name, c.last_name, c.company, c.title, c.city,
            c.phone_primary, c.phones_all, c.emails, c.source, c.linked_amber_id,
            c.created_at, c.updated_at, c.deleted_at,
            (SELECT count(*)::int FROM observations o
              WHERE o.contact_id = c.id AND o.deleted_at IS NULL) AS facts
       FROM contacts c WHERE c.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

const line = (...a) => process.stdout.write(a.join(" ") + "\n");
/**
 * phones_all AND emails ARE COMMA-SEPARATED TEXT, NOT ARRAYS.
 *
 * The first version of this spread them (`[...c.phones_all]`), which spreads a
 * STRING into its characters -- so every card printed its number followed by
 * "+, 1, 6, 3, 0, ..." and looked like corrupted data, and `emails.join` threw
 * and killed the report two thirds of the way down. Neither was true of the
 * database; both were this file. src/db/store.js splits these with
 * `.split(",")` everywhere and that is the contract.
 */
const list = (v) => {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === "string") return v.split(",").map((x) => x.trim()).filter(Boolean);
  return [];
};
const show = (label, c) => {
  if (!c) return line(`    ${label}: ROW NOT FOUND`);
  const phones = [...new Set([c.phone_primary, ...list(c.phones_all)].filter(Boolean))];
  const emails = list(c.emails);
  line(`    ${label}`);
  line(`      name      ${JSON.stringify(c.full_name)}  (first=${JSON.stringify(c.first_name)} last=${JSON.stringify(c.last_name)})`);
  line(`      phones    ${phones.length ? phones.join(", ") : "(none)"}`);
  line(`      emails    ${emails.length ? emails.join(", ") : "(none)"}`);
  line(`      company   ${c.company ?? "(none)"}${c.title ? ` / ${c.title}` : ""}   city ${c.city ?? "(none)"}`);
  line(`      source    ${c.source ?? "(none)"}   facts ${c.facts}`);
  line(`      on Amber  ${c.linked_amber_id ? `YES ${c.linked_amber_id}` : "no"}`);
  line(`      deleted   ${c.deleted_at ? `YES ${c.deleted_at}` : "no"}   updated ${c.updated_at}`);
};

const total = await query(
  `SELECT count(*)::int AS n FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL`,
  [ownerId],
);

line("=".repeat(78));
line(`OWNER ${ownerId}   ${total.rows[0].n} live contacts`);
line(`address-book source: ${fromBook.length} pair(s)`);
line(`account-linked source: ${fromGraph.length} pair(s)`);
line("=".repeat(78));

// NOT `list` -- that is the comma-split helper above, and shadowing it here is
// one careless edit away from calling an array.
for (const [source, found] of [["ADDRESS BOOK", fromBook], ["ACCOUNT LINKED", fromGraph]]) {
  line("");
  line(`── ${source} ${"─".repeat(70 - source.length)}`);
  if (found.length === 0) {
    line("  (nothing)");
    continue;
  }
  for (const d of found) {
    line("");
    line(`  ${d.name ?? "(unnamed)"}`);
    line(`    tier      ${d.tier ?? "(none)"}`);
    line(`    reason    ${d.reason ?? "(none reported)"}`);
    line(`    amberId   ${d.amberId ?? "null — this pair has NOTHING to do with Amber"}`);
    show("KEEP", await card(d.keepContactId));
    show("DROP", await card(d.dropContactId));
  }
}

line("");
line("=".repeat(78));
line("Nothing was merged. This is a read-only report.");
await closePool();
