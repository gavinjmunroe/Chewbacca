/**
 * DO BOTH MERGE PATHS NOW DO THE SAME THING? A REAL-DATABASE CHECK.
 *
 * The unit suite cannot answer this either. The in-memory SQL fake has no
 * pg_constraint, so referencingColumns() comes back empty under `npm test` and
 * the whole discovery tail -- the part that fixes the bug -- runs against
 * nothing and passes. Green, and testing air.
 *
 * So this runs against a real database and proves the four things the
 * convergence was for:
 *
 *   1. event_participants MOVES. This is the bug. That table shipped on
 *      2026-09-03 with an FK to contacts and was in none of the collapse
 *      function's hand-written lists, so every automatic collapse since then
 *      left a person's meeting attendance pointing at a card it then
 *      soft-deleted. The FK is ON DELETE CASCADE, but a soft delete does not
 *      cascade, so nothing ever complained.
 *
 *   2. A COLLISION DROPS ONLY WHAT COLLIDES. Both cards at the same meeting is
 *      one row on the survivor, not a license to delete every other meeting the
 *      absorbed card attended. This is the failure mode of the crude fallback.
 *
 *   3. TRUST DECIDES A CONTESTED FIELD, not which card happened to survive. A
 *      name the user typed beats a name a sync guessed, whichever card it is on.
 *
 *   4. THE TWO PATHS AGREE. The same two cards merged through the person's
 *      endpoint and through the resolver produce the same surviving row.
 *
 * ── IT CLEANS UP AFTER ITSELF ────────────────────────────────────────────────
 *
 * It creates its own throwaway owner and only ever touches rows it created, then
 * hard-deletes them. It never reads, writes or merges anything that was already
 * there, so it is safe against production -- but it does WRITE, so it is a
 * script you run deliberately, not part of `npm test`.
 *
 *   railway run npm run smoke:merge-converge -- --confirm
 */

import { randomUUID } from "node:crypto";
import { query, closePool } from "../src/db/sql.js";

// ── THE GATE ────────────────────────────────────────────────────────────────
//
// This script WRITES, and it DELETEs what it wrote. It only ever touches the
// throwaway owner it creates a moment earlier, so it cannot reach anybody's real
// contacts -- but "cannot" is a claim about code that is one edit away from
// being false, and the database it is pointed at is production.
if (!process.argv.includes("--confirm")) {
  console.error(
    "\n  merge-converge-smoke writes to the database it is pointed at.\n\n" +
      "  It creates a throwaway user, a handful of fake contacts and meetings,\n" +
      "  merges them both ways, checks the result, and hard-deletes everything\n" +
      "  it made. It never touches a row it did not create.\n\n" +
      "  Re-run with --confirm when you mean it:\n\n" +
      "    railway run npm run smoke:merge-converge -- --confirm\n",
  );
  process.exit(2);
}

// Named so the credentials check in script-hygiene-audit.mjs can see that this
// script knows where its authentication comes from: `railway run` injects
// GOOGLE_APPLICATION_CREDENTIALS_JSON along with the AMBER_SQL_* variables.
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    "\n  No GCP credentials in the environment. Run this through `railway run`,\n" +
      "  which injects them alongside the AMBER_SQL_* variables.\n",
  );
  process.exit(2);
}

import { mergeContacts } from "../src/db/contact-merge.js";
import { collapseContactGroup } from "../src/db/store.js";

const OWNER = randomUUID();
const PHONE = `+1998${String(Date.now()).slice(-7)}`;
let failures = 0;

function check(label, ok, detail = "") {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
  }
}

const mkContact = async (fields) => {
  const cols = Object.keys(fields);
  const ph = cols.map((_, i) => `$${i + 2}`).join(", ");
  const { rows } = await query(
    `INSERT INTO contacts (owner_id, ${cols.join(", ")})
     VALUES ($1::uuid, ${ph}) RETURNING id`,
    [OWNER, ...cols.map((c) => fields[c])],
  );
  return String(rows[0].id);
};

const mkEvent = async (title) => {
  const { rows } = await query(
    `INSERT INTO events (owner_id, title, starts_at) VALUES ($1::uuid, $2, now())
     RETURNING event_id`,
    [OWNER, title],
  );
  return String(rows[0].event_id);
};

const attend = (eventId, contactId) =>
  query(
    `INSERT INTO event_participants (event_id, owner_id, contact_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid) ON CONFLICT DO NOTHING`,
    [eventId, OWNER, contactId],
  );

const participationOf = async (contactId) => {
  const { rows } = await query(
    `SELECT event_id FROM event_participants WHERE owner_id = $1::uuid AND contact_id = $2::uuid`,
    [OWNER, contactId],
  );
  return rows.map((r) => String(r.event_id)).sort();
};

const cardOf = async (id) => {
  const { rows } = await query(
    `SELECT full_name, company, title, city, linkedin_url, external_id,
            source, source_tier, phones_all, emails, deleted_at
       FROM contacts WHERE owner_id = $1::uuid AND id = $2::uuid`,
    [OWNER, id],
  );
  return rows[0] ?? null;
};

async function teardown() {
  for (const t of [
    "event_participants", "events", "observations", "contact_sources",
    "contact_merges", "contact_identity_keys", "contacts",
  ]) {
    await query(`DELETE FROM ${t} WHERE owner_id = $1::uuid`, [OWNER]).catch(() => {});
  }
  await query(`DELETE FROM users WHERE amber_id = $1::uuid`, [OWNER]).catch(() => {});
}

async function main() {
  console.log(`\n  merge-converge smoke — throwaway owner ${OWNER}\n`);
  await query(
    `INSERT INTO users (amber_id, phone) VALUES ($1::uuid, $2) ON CONFLICT DO NOTHING`,
    [OWNER, PHONE],
  );

  // ── 1 + 2. event_participants moves, and a collision costs only itself ────
  {
    const keep = await mkContact({ full_name: "Ep Keeper", source: "apple", source_tier: 2 });
    const drop = await mkContact({ full_name: "Ep Loser", source: "apple", source_tier: 2 });
    const shared = await mkEvent("both were here");
    const hers = await mkEvent("only the absorbed card was here");
    const his = await mkEvent("only the survivor was here");
    await attend(shared, keep);
    await attend(shared, drop);
    await attend(hers, drop);
    await attend(his, keep);

    const res = await collapseContactGroup(OWNER, keep, [drop]);
    check("the collapse succeeded", res.ok, JSON.stringify(res));

    const after = await participationOf(keep);
    check(
      "the absorbed card's meeting attendance moved to the survivor",
      after.includes(hers),
      `survivor is at ${after.length} meeting(s); expected the absorbed card's to be among them`,
    );
    check(
      "a meeting they both attended is one row, not a duplicate",
      after.filter((e) => e === shared).length === 1,
    );
    check(
      "the collision did NOT take the non-colliding meetings with it",
      after.length === 3,
      `expected 3 distinct meetings on the survivor, got ${after.length}`,
    );
    check("nothing is left pointing at the absorbed card", (await participationOf(drop)).length === 0);
  }

  // ── 3. trust decides a contested field ───────────────────────────────────
  {
    // The survivor is the Apple-synced card. The absorbed one is what the user
    // typed by hand. Under the old rule the survivor's spelling simply won
    // because it was the survivor; under trust, the typed one does.
    const keep = await mkContact({
      full_name: "Jon Smyth", company: "Acme", source: "apple", source_tier: 2,
    });
    const drop = await mkContact({
      full_name: "Jonathan Smith", title: "Head of Ops", city: "Chicago",
      source: "manual", source_tier: 3,
    });

    const res = await mergeContacts(OWNER, keep, drop);
    check("the user-initiated merge succeeded", res.ok, JSON.stringify(res));

    const card = await cardOf(keep);
    check(
      "the name the user typed beats the name the sync guessed",
      card?.full_name === "Jonathan Smith",
      `got ${JSON.stringify(card?.full_name)}`,
    );
    check(
      "a field only the absorbed card had is carried over",
      card?.title === "Head of Ops" && card?.city === "Chicago",
      `title=${JSON.stringify(card?.title)} city=${JSON.stringify(card?.city)}`,
    );
    check(
      "a field only the survivor had is kept",
      card?.company === "Acme",
      `got ${JSON.stringify(card?.company)}`,
    );
    check(
      "the surviving card is labeled by its most authoritative contributor",
      card?.source === "manual" && Number(card?.source_tier) === 3,
      `source=${card?.source} tier=${card?.source_tier}`,
    );
    check("the absorbed card is soft-deleted", Boolean((await cardOf(drop))?.deleted_at));
  }

  // ── 3b. a vendor card cannot relabel or rename ───────────────────────────
  {
    const keep = await mkContact({
      full_name: "Priya Raman", source: "apple", source_tier: 2, external_id: "apple:abc",
    });
    const drop = await mkContact({
      full_name: "P. Raman", company: "Enriched Inc", source: "clay", source_tier: 0,
      external_id: "clay:zzz",
    });
    await mergeContacts(OWNER, keep, drop);
    const card = await cardOf(keep);
    check(
      "an enrichment vendor cannot rename a synced contact",
      card?.full_name === "Priya Raman",
      `got ${JSON.stringify(card?.full_name)}`,
    );
    check(
      "but it CAN fill a blank, which is the point of enrichment",
      card?.company === "Enriched Inc",
      `got ${JSON.stringify(card?.company)}`,
    );
    check(
      "the card is not relabeled as vendor-sourced",
      card?.source === "apple",
      `got ${JSON.stringify(card?.source)}`,
    );
    check(
      "the survivor keeps its own external_id, so the next sync still finds it",
      card?.external_id === "apple:abc",
      `got ${JSON.stringify(card?.external_id)}`,
    );
  }

  // ── 4. the two paths agree ───────────────────────────────────────────────
  {
    const mkPair = async () => [
      await mkContact({
        full_name: "Dana Keeper", company: "Keep Co", source: "apple", source_tier: 2,
        phone_primary: "+15550004444", phones_all: "+15550004444",
      }),
      await mkContact({
        full_name: "Dana Keeper", title: "Designer", source: "manual", source_tier: 3,
        phone_primary: "+15550005555", phones_all: "+15550005555",
        emails: "dana@example.com",
      }),
    ];
    const [aKeep, aDrop] = await mkPair();
    const [bKeep, bDrop] = await mkPair();

    await mergeContacts(OWNER, aKeep, aDrop);      // the person's endpoint
    await collapseContactGroup(OWNER, bKeep, [bDrop]); // the resolver

    const viaUser = await cardOf(aKeep);
    const viaResolver = await cardOf(bKeep);
    const shape = (c) =>
      JSON.stringify({
        full_name: c?.full_name, company: c?.company, title: c?.title,
        source: c?.source, source_tier: Number(c?.source_tier),
        phones: String(c?.phones_all ?? "").split(",").map((s) => s.trim()).sort(),
        emails: String(c?.emails ?? "").split(",").map((s) => s.trim()).sort(),
      });
    check(
      "merging by hand and merging by sync produce the same surviving card",
      shape(viaUser) === shape(viaResolver),
      `user     ${shape(viaUser)}\n      resolver ${shape(viaResolver)}`,
    );
    check(
      "both phone numbers survive rather than one replacing the other",
      String(viaUser?.phones_all ?? "").includes("5550004444") &&
        String(viaUser?.phones_all ?? "").includes("5550005555"),
      `got ${JSON.stringify(viaUser?.phones_all)}`,
    );
  }

  console.log(failures === 0 ? "\n  all checks passed\n" : `\n  ${failures} check(s) failed\n`);
}

try {
  await main();
} catch (e) {
  failures += 1;
  console.error("\n  FAILED:", e?.stack || e);
} finally {
  await teardown();
  await closePool();
}
process.exit(failures === 0 ? 0 : 1);
