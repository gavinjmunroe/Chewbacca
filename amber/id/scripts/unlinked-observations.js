/**
 * THE OBSERVATIONS WITH NO CONTACT, AND WHAT THE APP'S OWN RESOLVERS MAKE OF THEM.
 *
 *   railway run node scripts/unlinked-observations.js
 *   railway run node scripts/unlinked-observations.js --bodies
 *
 * READ-ONLY. Every statement is a SELECT, and it links nothing.
 *
 * WHY THIS EXISTS. pipeline-health reports "71 observation(s) have no contact_id
 * and can never roll up" and stops there, which reads as 71 broken rows. It is at
 * least three situations with three different answers:
 *
 *   A FACT ABOUT THE OWNER has no contact by design. obs_subject_chk forbids
 *   contact_id and circle_id BOTH being set; it permits both being unset, which
 *   is exactly what a fact about yourself is.
 *
 *   A FACT ABOUT A CIRCLE carries circle_id instead, and does roll up -- through
 *   the circle rather than through a contact.
 *
 *   A FACT THAT NAMES SOMEBODY AND HAS NO LINK is the real case. The cutover kept
 *   the name in observation_raw_names rather than dropping it, so there is still
 *   something to resolve.
 *
 * ── IT USES THE APP'S RESOLVERS, NOT A NEW ONE ────────────────────────────────
 *
 * The first version of this script hand-rolled a name matcher, and it was wrong
 * in a way worth recording: it reported "Sagar Tiwari -> no contact of that name"
 * while "Sagar" resolved to Sagar Tiwari GOAT sitting right there in the address
 * book. Two matchers already existed for exactly that, and contact-name-match.js
 * documents that same example in its own header.
 *
 * A diagnostic that answers with different logic from the live path tells you
 * about the diagnostic. So this asks in the order the app asks:
 *
 *   1. contact_name_memory     what this owner has already confirmed the name
 *                              means. A streak at or above the trust threshold is
 *                              a decision the user made, not a guess.
 *   2. resolveContactByName    one spoken token against first names, with soundex
 *                              and a bounded edit distance. A phonetic-only hit is
 *                              flagged as a guess, because it is one.
 *   3. fuzzyFindContactsByName token-by-token, for a multi-word name, where extra
 *                              tokens on the CONTACT side are free.
 *
 * Candidates are ranked by how much the owner has actually recorded about each
 * person, because "Caleb" matching five Calebs is a question for a human and that
 * count is what makes it answerable.
 *
 * NOTHING IS WRITTEN. Attaching a fact to the wrong person feeds that person's
 * warmth, recency and dimension scores with somebody else's life, which is worse
 * than leaving it unattached.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const SHOW_BODIES = argv.includes("--bodies");

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-unlinked.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const sql = await import("../src/db/sql.js");
const { query } = sql;
const { resolveContactByName } = await import("../src/lib/fact-capture.js");
const { fuzzyFindContactsByName } = await import("../src/lib/contact-name-match.js");
const { NAME_MEMORY_TRUST_STREAK } = await import("../src/db/observations-compat.js");

const { rows: obs } = await query(
  `SELECT o.observation_id, o.owner_id, o.kind, o.source, o.circle_id,
          o.observed_at, o.body,
          COALESCE(array_agg(rn.raw_name) FILTER (WHERE rn.raw_name IS NOT NULL), '{}') AS raw_names
     FROM observations o
     LEFT JOIN observation_raw_names rn ON rn.observation_id = o.observation_id
    WHERE o.contact_id IS NULL AND o.deleted_at IS NULL
    GROUP BY o.observation_id
    ORDER BY o.owner_id, o.observed_at`);

const onCircle = obs.filter((o) => o.circle_id != null);
const named = obs.filter((o) => o.circle_id == null && o.raw_names.length > 0);
const unnamed = obs.filter((o) => o.circle_id == null && o.raw_names.length === 0);

console.log(`\n  ${obs.length} live observation(s) with no contact_id\n`);
console.log(`      ${String(onCircle.length).padStart(4)}  attached to a CIRCLE instead -- these roll up, through the circle`);
console.log(`      ${String(unnamed.length).padStart(4)}  name NOBODY -- a fact about the owner, correct with no contact`);
console.log(`      ${String(named.length).padStart(4)}  NAME SOMEBODY and have no link -- the only group worth acting on`);

if (named.length === 0) {
  console.log(`\n  Nothing to resolve.\n`);
  await sql.closePool().catch(() => {});
  process.exit(0);
}

/**
 * The same shape store.js builds for resolution: id, full_name, first_name and
 * interaction_count = how many live observations name this contact. The resolver
 * ranks on that count, so leaving it at zero silently disables its tie-break.
 */
const owners = [...new Set(named.map((o) => String(o.owner_id)))];
const { rows: contactRows } = await query(
  `SELECT c.owner_id, c.id, c.full_name, c.first_name,
          count(o.observation_id) AS interaction_count
     FROM contacts c
     LEFT JOIN observations o
       ON o.contact_id = c.id AND o.owner_id = c.owner_id AND o.deleted_at IS NULL
    WHERE c.owner_id = ANY($1::uuid[]) AND c.deleted_at IS NULL
      AND c.full_name IS NOT NULL
    GROUP BY c.owner_id, c.id, c.full_name, c.first_name`,
  [owners]);

const contactsByOwner = new Map();
for (const r of contactRows) {
  const o = String(r.owner_id);
  if (!contactsByOwner.has(o)) contactsByOwner.set(o, []);
  contactsByOwner.get(o).push({
    id: String(r.id),
    full_name: r.full_name,
    first_name: r.first_name,
    interaction_count: Number(r.interaction_count) || 0,
  });
}

const { rows: memRows } = await query(
  `SELECT owner_id, name_key, contact_id, stable_streak
     FROM contact_name_memory WHERE owner_id = ANY($1::uuid[])`, [owners]);
const memory = new Map(
  memRows.map((r) => [`${r.owner_id} ${String(r.name_key).toLowerCase()}`, r]));

const nameOfContact = (list, id) =>
  list.find((c) => c.id === String(id))?.full_name ?? String(id);

/** What the app would decide about one raw name, and how sure it is. */
function decide(ownerId, raw, contacts) {
  const mem = memory.get(`${ownerId} ${String(raw).trim().toLowerCase()}`);
  if (mem) {
    const trusted = Number(mem.stable_streak) >= NAME_MEMORY_TRUST_STREAK;
    return {
      tier: trusted ? "confirmed" : "weak",
      contactId: String(mem.contact_id),
      how: `name memory, streak ${mem.stable_streak}${trusted ? "" : " -- below the trust threshold"}`,
      label: nameOfContact(contacts, mem.contact_id),
    };
  }

  const r = resolveContactByName(raw, contacts);
  if (r.status === "resolved") {
    return {
      tier: r.phonetic ? "weak" : "confident",
      contactId: String(r.contactId),
      how: r.phonetic ? "sounds like it, spelled differently" : "name match",
      label: r.matchedName,
    };
  }
  if (r.status === "ambiguous") {
    return {
      tier: "ambiguous",
      how: `${r.candidates.length} candidates`,
      label: r.bestGuessName,
      candidates: (r.candidateObjects || []).slice(0, 6),
    };
  }

  // Multi-token names are the case resolveContactByName cannot see: it compares
  // the whole string against a single first name.
  const fuzzy = fuzzyFindContactsByName(raw, contacts, { limit: 6, minScore: 0.6 });
  if (fuzzy.length === 1) {
    return {
      tier: fuzzy[0].exactName ? "confident" : "weak",
      contactId: fuzzy[0].id,
      how: `every token covered${fuzzy[0].exactName ? "" : ", one or more fuzzily"}`,
      label: fuzzy[0].full_name,
    };
  }
  if (fuzzy.length > 1) {
    return {
      tier: "ambiguous",
      how: `${fuzzy.length} token-level candidates`,
      label: fuzzy[0].full_name,
      candidates: fuzzy.map((c) => ({ id: c.id, name: c.full_name, count: c.interaction_count })),
    };
  }
  return { tier: "none", how: "no contact resembles this name" };
}

const TIERS = ["confirmed", "confident", "weak", "ambiguous", "none"];
const tally = Object.fromEntries(TIERS.map((t) => [t, 0]));

console.log(`\n  WHAT THE APP'S OWN RESOLVERS DECIDE\n`);
for (const o of named) {
  const contacts = contactsByOwner.get(String(o.owner_id)) || [];
  const lines = [];
  for (const raw of o.raw_names) {
    const d = decide(String(o.owner_id), raw, contacts);
    tally[d.tier]++;
    const head = `${d.tier.toUpperCase().padEnd(10)} ${String(raw).padEnd(16)}`;
    lines.push(d.contactId ? `${head} -> ${d.label}   [${d.how}]` : `${head} -> ${d.how}`);
    for (const c of d.candidates || []) {
      const nm = c.name ?? c.full_name;
      const ct = c.count ?? c.interactionCount ?? c.interaction_count ?? 0;
      lines.push(`${" ".repeat(28)}${nm} (${ct} fact(s) recorded)`);
    }
  }
  console.log(`      ${o.kind}/${o.source}  ${o.observed_at.toISOString().slice(0, 10)}`);
  for (const l of lines) console.log(`          ${l}`);
  if (SHOW_BODIES) console.log(`          "${String(o.body).replace(/\s+/g, " ").slice(0, 140)}"`);
}

console.log(`\n  BY CONFIDENCE   (names, not observations -- one observation can name two people)\n`);
console.log(`      ${String(tally.confirmed).padStart(4)}  CONFIRMED   the owner already told the app who this name means`);
console.log(`      ${String(tally.confident).padStart(4)}  CONFIDENT   exactly one contact, matched on spelling`);
console.log(`      ${String(tally.weak).padStart(4)}  WEAK        one contact, but phonetic or fuzzy -- a guess`);
console.log(`      ${String(tally.ambiguous).padStart(4)}  AMBIGUOUS   several contacts, ranked by how much you talk about them`);
console.log(`      ${String(tally.none).padStart(4)}  NONE        nobody in the address book resembles the name`);
console.log(`\n  NOTHING WAS CHANGED. CONFIRMED and CONFIDENT are a decision to make; WEAK and`);
console.log(`  AMBIGUOUS are questions; NONE means that person is not a contact yet.\n`);

await sql.closePool().catch(() => {});
