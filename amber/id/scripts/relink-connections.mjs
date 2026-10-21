/**
 * POINT EVERY EXISTING CONNECTION AT THE CARDS THE TWO PEOPLE ALREADY HAD.
 *
 *   railway run node scripts/relink-connections.mjs --dry
 *   railway run node scripts/relink-connections.mjs
 *
 * WHY THERE IS ANYTHING TO REPAIR. Two routes reach an active connection:
 * somebody presses accept, or both people happen to send a request to each
 * other and the second one connects on the spot. The accept path has stamped
 * contacts.linked_amber_id for both sides for a while. The mutual path never
 * did -- it inserted the row and returned "connected".
 *
 * Everything downstream reads that column. Circle previews say whether a member
 * is on Amber; the profile web matches connections to circles through it; the
 * caller's own card for a connection is found by it. So a pair who connected
 * the mutual way ended up genuinely connected with neither address book
 * pointing at it, and the app said "nobody from that circle is on Amber" about
 * the only people who were.
 *
 * The write path is fixed. This is for the connections that already exist.
 *
 * WHAT IT DOES, AND ITS LIMIT. It calls the same linkResolvableContacts the
 * accept path calls, scoped to each pair, in both directions. That function
 * links a card ONLY when the card carries a phone or an email that the account
 * has proved it owns, and only when exactly one account matches. It cannot
 * guess. A pair it leaves unlinked is reported at the end with the reason
 * visible: the card and the account share no verified key, which is a data
 * problem no script should paper over by matching on a name.
 *
 * --dry prints what it would link and writes nothing.
 */
import { query, closePool } from "../src/db/sql.js";
import { linkResolvableContacts } from "../src/db/identity-link.js";

const dry = process.argv.includes("--dry");
const line = (...a) => process.stdout.write(a.join(" ") + "\n");

const { rows: pairs } = await query(
  `SELECT a_amber_id, b_amber_id FROM connections WHERE status = 'active'`,
);

line("=".repeat(78));
line(`${pairs.length} active connection(s)${dry ? "   [DRY RUN, nothing will be written]" : ""}`);
line("=".repeat(78));

/** Does this owner already hold a card pointing at that account? */
async function linked(ownerId, amberId) {
  const { rows } = await query(
    `SELECT c.id, c.full_name FROM contacts c
      WHERE c.owner_id = $1 AND c.linked_amber_id = $2 AND c.deleted_at IS NULL
      LIMIT 1`,
    [ownerId, amberId],
  );
  return rows[0] ?? null;
}

/** A card the owner plausibly holds for that account, by verified key. */
async function candidate(ownerId, amberId) {
  const { rows } = await query(
    `SELECT c.id, c.full_name, c.phone_primary
       FROM contacts c
       JOIN contact_identity_keys k ON k.contact_id = c.id
       JOIN identity_keys ik ON ik.key_hash = k.key_hash
      WHERE c.owner_id = $1 AND ik.amber_id = $2 AND c.deleted_at IS NULL
      LIMIT 1`,
    [ownerId, amberId],
  ).catch(() => ({ rows: [] }));
  return rows[0] ?? null;
}

let already = 0;
let repaired = 0;
const unresolved = [];

for (const p of pairs) {
  for (const [ownerId, amberId] of [
    [String(p.a_amber_id), String(p.b_amber_id)],
    [String(p.b_amber_id), String(p.a_amber_id)],
  ]) {
    const before = await linked(ownerId, amberId);
    if (before) {
      already += 1;
      continue;
    }
    if (dry) {
      const c = await candidate(ownerId, amberId);
      if (c) line(`  WOULD LINK  owner ${ownerId.slice(0, 8)} -> ${amberId.slice(0, 8)}  card "${c.full_name}"`);
      else unresolved.push({ ownerId, amberId });
      continue;
    }
    await linkResolvableContacts({ ownerId, amberId }).catch(() => {});
    const after = await linked(ownerId, amberId);
    if (after) {
      repaired += 1;
      line(`  LINKED  owner ${ownerId.slice(0, 8)} -> ${amberId.slice(0, 8)}  card "${after.full_name}"`);
    } else {
      unresolved.push({ ownerId, amberId });
    }
  }
}

line("");
line("=".repeat(78));
line(`already linked : ${already}`);
line(dry ? `would repair   : see above` : `repaired       : ${repaired}`);
line(`unresolved     : ${unresolved.length}`);
if (unresolved.length) {
  line("");
  line("UNRESOLVED means the owner holds no card carrying a phone or email that");
  line("the account has verified. Nothing here matches on a name, on purpose --");
  line("linking the wrong card files one person's notes under another.");
  for (const u of unresolved.slice(0, 20)) {
    line(`  owner ${u.ownerId.slice(0, 8)} has no provable card for ${u.amberId.slice(0, 8)}`);
  }
}
line("=".repeat(78));
await closePool();
