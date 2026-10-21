/**
 * HOW GOOD IS THE DEDUPE, AS A NUMBER.
 *
 * "The dedupe has to be perfect" is not a thing anybody can verify by looking.
 * This turns it into a handful of figures against a real address book, so the
 * next change to the resolver can be checked rather than hoped about.
 *
 * ── WHAT IS AND IS NOT MEASURABLE ───────────────────────────────────────────
 *
 * There is no labeled ground truth here. Nobody has gone through five thousand
 * contacts marking which pairs are the same person, so true precision and
 * recall cannot be computed and any script claiming to is lying. What CAN be
 * computed, exactly, is the half that is provable:
 *
 *   MISSES ARE PROVABLE, WITH TWO CAVEATS THE FIRST VERSION OF THIS GOT WRONG.
 *   Two live cards sharing an email are the same person: rule 3 merges on it
 *   without asking. A shared PHONE is weaker, and the resolver knows it --
 *   families share a landline, and a business shares a number with whoever
 *   runs it. So a shared phone counts as a miss only when the names are also
 *   compatible (Madeline / Madeleine) AND the pair is not already sitting in
 *   the review queue. A pair the resolver deliberately refused and flagged is
 *   the system working, not failing, and the first version of this script
 *   reported "Indira Kota ~ Maya Kota" -- a mother and daughter on one
 *   landline -- as a bug.
 *
 *   PAIRS ARE COUNTED ONCE. Two cards sharing two different phone numbers are
 *   one duplicate, not two, and the first version counted the key rather than
 *   the pair.
 *
 *   BAD MERGES ARE PARTLY PROVABLE. A merge the user undid is one the resolver
 *   got wrong, by the only authority that counts. That is a precision signal on
 *   real data. It undercounts, because most bad merges are never noticed.
 *
 *   THE AMBIGUOUS SET IS COUNTABLE, NOT JUDGEABLE. Cards sharing a folded name
 *   with no corroborating identifier are exactly the pairs the resolver
 *   deliberately refuses to merge. Whether each is two people or one duplicate
 *   needs eyes. The count is reported, and a sample is printed, so the size of
 *   the gray area is known even though its contents are not.
 *
 * Read-only. It writes nothing, and it prints no phone numbers or email
 * addresses -- a benchmark you cannot paste into a ticket is a benchmark nobody
 * runs twice.
 *
 *   railway run node scripts/dedupe-benchmark.mjs
 *   railway run node scripts/dedupe-benchmark.mjs --owner <amber_id> --json out.json
 */

import fs from "node:fs";
import { query, closePool } from "../src/db/sql.js";
import { phoneKey, emailKey, foldName, namesCompatible } from "../src/lib/contact-identity.js";

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
};
const OWNER_ARG = argOf("--owner");
const JSON_OUT = argOf("--json");
const SAMPLE = Number(argOf("--sample") ?? 10);

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    "\n  No GCP credentials in the environment. Run this through `railway run`,\n" +
      "  which injects them alongside the AMBER_SQL_* variables.\n",
  );
  process.exit(2);
}

/** Never print somebody's contact details. A short stable tag is enough to grep by. */
const tag = (id) => String(id).slice(0, 8);
const short = (s, n = 28) => {
  const v = String(s ?? "").trim();
  return v.length <= n ? v : `${v.slice(0, n - 1)}…`;
};

const splitList = (s) =>
  String(s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function pickOwner() {
  if (OWNER_ARG) {
    const raw = String(OWNER_ARG).trim();
    if (UUID_RE.test(raw)) return raw.toLowerCase();
    if (/^[0-9a-f]{6,32}$/i.test(raw)) {
      const { rows } = await query(
        `SELECT amber_id FROM users WHERE amber_id::text LIKE $1 LIMIT 2`,
        [`${raw.toLowerCase()}%`],
      ).catch(() => ({ rows: [] }));
      if (rows.length === 1) return String(rows[0].amber_id);
      console.error(`\n  "${raw}" matched ${rows.length} accounts.\n`);
      return null;
    }
    const { resolveAmberIdByPhone } = await import("../src/db/store.js");
    const id = await resolveAmberIdByPhone(raw).catch(() => null);
    if (id) return String(id);
    console.error(`\n  Could not resolve "${raw}" to an account.\n`);
    return null;
  }
  // The busiest address book, because a benchmark against an empty account
  // proves nothing and reports a perfect score doing it.
  //
  // WHICH IS NOT NECESSARILY YOURS, and the first version did not say so. It
  // reported on a 2,560-contact book that turned out to belong to a different
  // account than the one the operator assumed, and every conclusion drawn from
  // that run was about somebody else's contacts. Now it says whose book it
  // picked and that it picked by default.
  const { rows } = await query(
    `SELECT owner_id, count(*)::int AS n
       FROM contacts WHERE deleted_at IS NULL
      GROUP BY owner_id ORDER BY n DESC LIMIT 1`,
  );
  if (!rows[0]) return null;
  console.log(
    `\n  No --owner given. Defaulting to the largest address book in this\n` +
      `  database, which may not be yours. Pass --owner <phone|uuid|id-prefix>\n` +
      `  to measure a specific account.`,
  );
  return rows[0].owner_id;
}

async function main() {
  const owner = await pickOwner();
  if (!owner) {
    console.log("\n  No contacts in this database. Nothing to measure.\n");
    return;
  }

  const { rows: contacts } = await query(
    `SELECT id, full_name, phone_primary, phones_all, emails, company, source,
            external_id, created_at
       FROM contacts
      WHERE owner_id = $1::uuid AND deleted_at IS NULL`,
    [owner],
  );

  console.log(`\n  dedupe benchmark — owner ${tag(owner)}, ${contacts.length} live contacts\n`);
  if (contacts.length === 0) return;

  // ── provable misses: a shared identifier across two live cards ────────────
  const byPhone = new Map();
  const byEmail = new Map();
  const byName = new Map();

  for (const c of contacts) {
    const id = String(c.id);
    const phones = new Set(
      [c.phone_primary, ...splitList(c.phones_all)].map((p) => phoneKey(p)).filter(Boolean),
    );
    for (const k of phones) {
      if (!byPhone.has(k)) byPhone.set(k, new Set());
      byPhone.get(k).add(id);
    }
    for (const e of splitList(c.emails)) {
      const k = emailKey(e);
      if (!k) continue;
      if (!byEmail.has(k)) byEmail.set(k, new Set());
      byEmail.get(k).add(id);
    }
    const n = foldName(c.full_name);
    if (n) {
      if (!byName.has(n)) byName.set(n, new Set());
      byName.get(n).add(id);
    }
  }

  const collide = (index) =>
    [...index.entries()].filter(([, ids]) => ids.size > 1).map(([k, ids]) => ({ key: k, ids: [...ids] }));

  const phoneCollisions = collide(byPhone);
  const emailCollisions = collide(byEmail);

  // A number shared by hundreds of rows is a placeholder (a main office line, a
  // 000-0000 from a bad import), not a person. The resolver already refuses to
  // merge on those, so counting them as misses would report a failure that is
  // actually the correct behavior.
  const PLACEHOLDER_AT = 5;
  const usablePhone = phoneCollisions.filter((m) => m.ids.length < PLACEHOLDER_AT);
  const placeholders = phoneCollisions.length - usablePhone.length;

  // Pairs the resolver already looked at and refused on purpose. Counting these
  // as failures is what made the first run of this script wrong.
  const { rows: reviewPairs } = await query(
    `SELECT contact_id, candidate_contact_id, reason
       FROM contact_review_candidates WHERE owner_id = $1::uuid`,
    [owner],
  ).catch(() => ({ rows: [] }));
  const flagged = new Set(
    reviewPairs.map((r) => [String(r.contact_id), String(r.candidate_contact_id)].sort().join("|")),
  );

  const nameOf = new Map(contacts.map((c) => [String(c.id), foldName(c.full_name)]));

  // Every colliding GROUP becomes its constituent PAIRS, so one pair sharing
  // two numbers is counted once.
  const pairs = new Map();
  const addPairs = (groups, via) => {
    for (const g of groups) {
      for (let i = 0; i < g.ids.length; i += 1) {
        for (let j = i + 1; j < g.ids.length; j += 1) {
          const key = [g.ids[i], g.ids[j]].sort().join("|");
          const prior = pairs.get(key);
          pairs.set(key, { ids: [g.ids[i], g.ids[j]], via: prior ? `${prior.via}+${via}` : via });
        }
      }
    }
  };
  addPairs(emailCollisions, "email");
  addPairs(usablePhone, "phone");

  const misses = [];
  const refusedOnPurpose = [];
  for (const [key, pair] of pairs) {
    const [a, b] = pair.ids;
    // An email match needs no corroboration; a phone match does, because a
    // shared line is not a shared identity.
    const byEmailAlone = pair.via.includes("email");
    const compatible = namesCompatible(nameOf.get(a) ?? "", nameOf.get(b) ?? "");
    if (!byEmailAlone && !compatible) {
      refusedOnPurpose.push({ ...pair, why: "shared line, different people" });
      continue;
    }
    if (flagged.has(key)) {
      refusedOnPurpose.push({ ...pair, why: "already in the review queue" });
      continue;
    }
    misses.push(pair);
  }

  const missedCards = new Set();
  for (const m of misses) for (const id of m.ids) missedCards.add(id);

  // ── the gray area: same name, nothing else in common ──────────────────────
  const nameOnly = collide(byName).filter(({ ids }) => {
    const set = new Set(ids);
    const sharesIdentifier = [...usablePhone, ...emailCollisions].some(
      (m) => m.ids.filter((id) => set.has(id)).length > 1,
    );
    return !sharesIdentifier;
  });

  // ── merges the user reversed: the only precision signal on real data ──────
  const { rows: mergeRows } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE undone_at IS NOT NULL)::int AS undone,
            count(*) FILTER (WHERE origin = 'auto')::int AS automatic
       FROM contact_merges WHERE owner_id = $1::uuid`,
    [owner],
  ).catch(() => ({ rows: [{ total: 0, undone: 0, automatic: 0 }] }));
  const merges = mergeRows[0] ?? { total: 0, undone: 0, automatic: 0 };

  const { rows: reviewRows } = await query(
    `SELECT count(*)::int AS n FROM contact_review_candidates WHERE owner_id = $1::uuid`,
    [owner],
  ).catch(() => ({ rows: [{ n: 0 }] }));

  // ── IDENTITY KEY COVERAGE ────────────────────────────────────────────────
  //
  // The number that explains every other number here. Matching is a LOOKUP
  // against contact_identity_keys, not a scan of the address book: a contact
  // with no keys is invisible to the resolver, so it can never be found as a
  // duplicate and never be merged into. A book reporting zero misses because
  // half of it is unindexed is not a clean book, it is a blind one.
  // JOINED TO LIVE CONTACTS, which the first version of this did not do and so
  // reported 100.3% coverage -- an impossible number, and the giveaway that the
  // two sides were counting different populations. Keys outlive the card they
  // belonged to until a purge runs, so counting them against the live book
  // inflates the numerator.
  const { rows: keyRows } = await query(
    `SELECT count(DISTINCT k.contact_id)::int AS keyed, count(*)::int AS keys
       FROM contact_identity_keys k
       JOIN contacts c
         ON c.owner_id = k.owner_id AND c.id = k.contact_id AND c.deleted_at IS NULL
      WHERE k.owner_id = $1::uuid`,
    [owner],
  ).catch(() => ({ rows: [{ keyed: 0, keys: 0 }] }));

  // Contacts with anything to key on. THREE kinds of key, not two: a phone, an
  // email, OR the source's own id for the card (key_type 3). The first version
  // counted only the first two, so a contact keyed on nothing but its Apple id
  // was indexed and not counted as indexable -- the other half of why coverage
  // came out above 100%.
  const keyable = contacts.filter(
    (c) =>
      phoneKey(c.phone_primary) ||
      splitList(c.phones_all).some((p) => phoneKey(p)) ||
      splitList(c.emails).some((e) => emailKey(e)) ||
      (c.external_id != null && String(c.external_id).trim() !== ""),
  ).length;

  const { rows: srcRows } = await query(
    `SELECT count(DISTINCT source)::int AS sources, count(*)::int AS rows
       FROM contact_sources WHERE owner_id = $1::uuid AND deleted_at IS NULL`,
    [owner],
  ).catch(() => ({ rows: [{ sources: 0, rows: 0 }] }));

  const report = {
    owner: tag(owner),
    contacts: contacts.length,
    // THE HEADLINE. Two live cards sharing a phone or an email are the same
    // person by the resolver's own rules. Anything above zero is a miss.
    provableDuplicatePairs: misses.length,
    cardsInvolved: missedCards.size,
    byPhone: misses.filter((m) => !m.via.includes("email")).length,
    byEmail: misses.filter((m) => m.via.includes("email")).length,
    // Pairs that DO share an identifier and are correctly left alone: a
    // household landline, a business number, or a pair already flagged for the
    // person to adjudicate. Reported because a benchmark that hides its
    // exclusions is a benchmark nobody can audit.
    refusedOnPurpose: refusedOnPurpose.length,
    placeholderNumbersIgnored: placeholders,
    ambiguousNameGroups: nameOnly.length,
    reviewQueue: reviewRows[0]?.n ?? 0,
    merges: merges.total,
    mergesAutomatic: merges.automatic,
    mergesUndone: merges.undone,
    undoRate: merges.total ? Number((merges.undone / merges.total).toFixed(4)) : 0,
    distinctSources: srcRows[0]?.sources ?? 0,
    provenanceRows: srcRows[0]?.rows ?? 0,
    identityKeys: keyRows[0]?.keys ?? 0,
    contactsKeyed: keyRows[0]?.keyed ?? 0,
    contactsKeyable: keyable,
    // Anything below 100% is a slice of the book the resolver cannot see.
    // Clamped, because a ratio above 1 is a bug in this script rather than a
    // fact about the book, and printing it as a percentage hides that.
    keyCoverage: keyable
      ? Math.min(1, Number(((keyRows[0]?.keyed ?? 0) / keyable).toFixed(4)))
      : 1,
  };

  const pct = (n) => `${((n / contacts.length) * 100).toFixed(2)}%`;

  console.log(`  MISSES                   ${report.provableDuplicatePairs}` +
    `  (${report.byPhone} by phone, ${report.byEmail} by email)`);
  console.log(`  cards involved           ${report.cardsInvolved}  ${pct(report.cardsInvolved)} of the book`);
  console.log(`  correctly left alone     ${report.refusedOnPurpose}   shared line or already flagged`);
  console.log(`  placeholder numbers      ${report.placeholderNumbersIgnored} ignored (shared by ${PLACEHOLDER_AT}+ cards)`);
  console.log(`  ambiguous name groups    ${report.ambiguousNameGroups}   same name, nothing else shared`);
  console.log(`  review queue             ${report.reviewQueue}`);
  console.log(`  merges                   ${report.merges} (${report.mergesAutomatic} automatic)`);
  console.log(`  undone by the user       ${report.mergesUndone}   undo rate ${(report.undoRate * 100).toFixed(2)}%`);
  console.log(`  sources contributing     ${report.distinctSources}`);
  console.log(
    `  INDEXED FOR MATCHING     ${report.contactsKeyed}/${report.contactsKeyable}` +
      `  ${(report.keyCoverage * 100).toFixed(1)}%   (${report.identityKeys} keys)`,
  );
  if (report.keyCoverage < 0.99) {
    console.log(
      `\n  WARNING: ${report.contactsKeyable - report.contactsKeyed} contact(s) with a phone or\n` +
        `  an email are not in the key index, so the resolver cannot see them as\n` +
        `  duplicates of anything. A clean miss count above is not meaningful\n` +
        `  until this is 100%. Fix with:\n` +
        `    node scripts/reconcile-contacts.mjs --owner <you> --confirm`,
    );
  }

  if (report.provableDuplicatePairs > 0) {
    console.log(`\n  MISSES, up to ${SAMPLE}:`);
    for (const m of misses.slice(0, SAMPLE)) {
      const names = m.ids
        .map((id) => short(contacts.find((c) => String(c.id) === id)?.full_name ?? "?"))
        .join("  ~  ");
      console.log(`    ${m.ids.map(tag).join(" + ")}   [${m.via}]  ${names}`);
    }
    console.log(
      `\n  Each of these is two live cards the resolver should already have\n` +
        `  merged on a shared identifier. Run the resolver over this owner and\n` +
        `  re-measure; if they survive, they are a bug rather than a backlog.\n`,
    );
  } else {
    console.log(`\n  Nothing left unmerged that should have merged. Recall is clean\n` +
      `  on the half that is provable.\n`);
  }

  if (refusedOnPurpose.length > 0) {
    console.log(`  LEFT ALONE ON PURPOSE, up to ${SAMPLE}:`);
    for (const r of refusedOnPurpose.slice(0, SAMPLE)) {
      const names = r.ids
        .map((id) => short(contacts.find((c) => String(c.id) === id)?.full_name ?? "?"))
        .join("  ~  ");
      console.log(`    ${r.ids.map(tag).join(" + ")}   ${names}   (${r.why})`);
    }
    console.log(
      `\n  These share a number but not an identity: a household line, a\n` +
        `  business and its owner, or a pair already waiting for you to decide.\n` +
        `  Merging them would be the bug.\n`,
    );
  }

  if (nameOnly.length > 0) {
    console.log(`  AMBIGUOUS, up to ${SAMPLE} (these need eyes, not code):`);
    for (const g of nameOnly.slice(0, SAMPLE)) {
      const companies = g.ids
        .map((id) => short(contacts.find((c) => String(c.id) === id)?.company ?? "no company", 18))
        .join("  ~  ");
      console.log(`    ${short(g.key, 22).padEnd(24)} ${g.ids.length} cards   ${companies}`);
    }
    console.log("");
  }

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`  wrote ${JSON_OUT}\n`);
    console.log(`  Diff this against the last run to see whether a resolver change\n` +
      `  helped or quietly cost recall.\n`);
  }
}

let failed = 0;
try {
  await main();
} catch (e) {
  failed = 1;
  console.error("\n  FAILED:", e?.stack || e);
} finally {
  await closePool();
}
process.exit(failed);
