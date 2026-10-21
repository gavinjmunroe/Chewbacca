/**
 * THE FIRST FIVE MINUTES, WHICH IS THE ONLY PART A NEW USER SEES.
 *
 * "Any vulnerabilities you notice right now where a new user would come on and
 *  be like, 'Oh, this isn't working for me'?"
 *
 * Every test written so far starts from a book that is already there. That is
 * the wrong starting point for the question that matters: the tester who
 * embarrassed us was not a power user, he was somebody who had just installed
 * the app. So this walks the sequence in order and asks a real question at every
 * step:
 *
 *   1. Signed up, contacts permission DENIED. Zero contacts.
 *   2. Contacts permission granted, sync STILL RUNNING. One batch of 200 in.
 *   3. First sync finished.
 *   4. Second sync, nothing changed on the phone.
 *   5. A contact added by hand, one at a time.
 *
 * At each step the same four questions, because a new user does not know which
 * questions are supposed to work.
 *
 * It also times the whole-book retag that createContactForOwner now performs on
 * every single contact creation -- a cost this session introduced, on the chat
 * and iMessage hot paths, and therefore one to measure rather than assume.
 */
import pg from "pg";
import Fastify from "fastify";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";

if (!process.env.IDENTITY_KEY_PEPPER) {
  console.error("Set IDENTITY_KEY_PEPPER (any 32+ chars).");
  process.exit(2);
}

const pool = new pg.Pool({
  host: process.env.SMOKE_PGHOST || "/tmp",
  port: Number(process.env.SMOKE_PGPORT || 5433),
  user: process.env.SMOKE_PGUSER || "postgres",
  database: process.env.SMOKE_PGDATABASE || "coldstart",
  max: 8,
});
__injectPoolForSmokeTests(pool);

const { upsertContactsForOwner, createContactForOwner, loadContactsByOwnerId, createUser, getUserByPhone, resolveAmberIdByPhone, setUserName } =
  await import("../src/db/store.js");
const { storeAppleCardDetails, retagAddressBook } = await import("../src/db/address-book-store.js");
const { registerChatRoutes } = await import("../src/routes/chat.js");
const { normalizeIncomingContact } = await import("../src/routes/profile.js");

const line = (...a) => process.stdout.write(a.join(" ") + "\n");
const problems = [];
const flag = (what, detail) => problems.push({ what, detail });

// ── a realistic first address book, the way a phone actually hands one over ──
const FIRST = "Maya Dev Nina Arjun Shirley Ravi Sagar Caleb Priya Omar Mark Rose".split(" ");
const LAST = "Park Kumar Chen Lopez Okafor Silva Tanaka Weber Nguyen Patel Lynn Novak".split(" ");
const TAGS = ["USC", "BTG", "Plumber", "Dentist", "Realtor", "Vet"];
const AREA = { "Los Angeles": ["213", "310", "323"], "New York": ["646", "917", "718"], Chicago: ["312", "773"] };
const METROS = Object.keys(AREA);

function phoneBook(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const metro = METROS[i % METROS.length];
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 7) % LAST.length];
    // A REAL FIRST SYNC IS ALMOST ENTIRELY NAMES AND NUMBERS. No notes, no
    // companies, no cities -- because that is what an Apple export is, and
    // because the current iOS build sends only eight fields anyway.
    const rec = {
      externalId: `cold:${i}`,
      name: `${first} ${last}${i % 9 === 0 ? ` ${TAGS[i % TAGS.length]}` : ""}-${i.toString(36)}`,
      firstName: first,
      lastName: last,
      source: "apple_contacts",
      phoneNumbers: [`+1${AREA[metro][i % AREA[metro].length]}${String(2000000 + i * 37).slice(0, 7)}`],
    };
    if (i % 25 === 0) rec.emails = [`${first}.${last}${i}@example.com`.toLowerCase()];
    out.push(rec);
  }
  return out;
}

const QUESTIONS = [
  "how many people do I know",
  "who do I know that goes to USC",
  "do I know anyone in New York",
  "do you know anything about any of my contacts",
];

// ── the app, wired to the real database, model stood in ─────────────────────
function appFor(ownerId, phone) {
  const app = Fastify({ logger: false });
  registerChatRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = { userId: "did:cold:1", phone };
    },
    resolveAmberIdByPhone: async () => ownerId,
    listContacts: async () => (await loadContactsByOwnerId(ownerId)) ?? [],
    getProfile: async () => ({ displayName: "New User" }),
    // The classifier calls these "who do I know" questions network_query, which
    // is the path that used to bypass the retrieval entirely.
    classifyIntent: async () => ({ intent: "network_query", needsWeb: false }),
    streamChat: async ({ onToken }) => {
      onToken("model answer");
      return "model answer";
    },
    exaSearch: async () => [],
    exaFindPeople: async () => [],
    findPlaces: async () => [],
    generateSuggestions: async () => [],
    // A NEW USER HAS NO PEOPLERANK SCORES. This is not a convenience of the
    // test, it is the defining fact about a new account, and it is what made
    // every question fall through to "Nothing in your contacts answers that".
    streamViaTogariSearch: async function* () {},
    rankViaTogariSearch: async () => null,
    appendMessage: async () => {},
    listConversation: async () => [],
    listRecentConversations: async () => [],
  });
  return app;
}

const answerOf = (body) =>
  String(body)
    .split("\n\n")
    .filter((f) => f.includes("event: token"))
    .map((f) => {
      try {
        return JSON.parse(f.split("data: ")[1]).text;
      } catch {
        return "";
      }
    })
    .join("");

async function askAll(app, stageName, contactCount) {
  line(`\n  ${stageName}  (${contactCount} contacts in the book)`);
  for (const q of QUESTIONS) {
    const res = await app.inject({ method: "POST", url: "/v1/chat", payload: { message: q } });
    if (res.statusCode !== 200) {
      flag(stageName, `"${q}" returned HTTP ${res.statusCode}`);
      line(`    ${q}\n      HTTP ${res.statusCode}`);
      continue;
    }
    const a = answerOf(res.body).trim();
    const shrug = /Nothing in your contacts answers that yet/.test(a);

    // A BOOK WITH PEOPLE IN IT MAY NOT SHRUG. With zero contacts a shrug is the
    // only honest answer; with contacts it is the bug that started all of this.
    if (shrug && contactCount > 0) {
      flag(stageName, `"${q}" shrugged at a book of ${contactCount} contacts`);
    }
    // AND WITH ZERO CONTACTS THE ANSWER MUST NAME THAT, not read as a failed
    // search. This is the first sentence a brand-new account ever sees, and it
    // used to be "Nothing in your contacts answers that yet... want to voice
    // something about someone who's moved?" -- which, to someone who has not
    // synced anything, is a non-sequitur about a person they never mentioned.
    if (contactCount === 0 && a) {
      const saysWhy = /don't have any of your contacts|not synced|sync your contacts|haven't synced/i.test(a);
      if (!saysWhy) {
        flag(stageName, `"${q}" did not tell a user with NO contacts that their contacts are missing: ${a.slice(0, 90)}`);
      }
    }
    if (!a) flag(stageName, `"${q}" produced no answer text at all`);
    line(`    ${q}`);
    line(`      ${a.slice(0, 176) || "(nothing)"}`);
  }
}

// ── STEP 1: signed up, permission denied ────────────────────────────────────
line("=".repeat(78));
line("A NEW USER, STEP BY STEP");
line("=".repeat(78));

const PHONE = "+15550100200";
await pool.query(`DELETE FROM users WHERE phone = $1`, [PHONE]);

// ── STEP 0: the account itself, through the real signup writer ──────────────
//
// The first version of this file inserted a users row by hand, which skipped
// the one seam nobody had tested: what the app actually does the moment a
// person finishes verifying. Token verification itself IS covered elsewhere --
// apple-auth (15 tests), apple-ticket (8), auth (11), oauth/state (8) -- so the
// gap was never "auth is untested", it was this join between a verified caller
// and a usable account.
line("\n  STEP 0 — the account is created the way signup creates it");
const created = await createUser({ phone: PHONE, fullName: "New User", status: "active" });
if (!created?.amber_id) flag("STEP 0 — signup", "createUser did not return an account");
const OWNER = String(created.amber_id);

// A caller arrives holding only their phone number; every route resolves the
// owner from it. If that lookup misses, every later request 400s with
// "could not resolve owner" and the app is unusable while looking signed in.
const resolved = await resolveAmberIdByPhone(PHONE).catch(() => null);
if (String(resolved ?? "") !== OWNER) {
  flag("STEP 0 — signup", `resolveAmberIdByPhone returned ${JSON.stringify(resolved)}, not the new account`);
}
const fetched = await getUserByPhone(PHONE).catch(() => null);
if (!fetched) flag("STEP 0 — signup", "the account cannot be read back by the phone number it was made with");

// Signing up twice with the same number must not make a second account -- a
// re-verify after reinstalling the app is the ordinary case, not an edge one.
const again = await createUser({ phone: PHONE, fullName: "New User", status: "active" });
if (again?.amber_id && String(again.amber_id) !== OWNER) {
  flag("STEP 0 — signup", `verifying the same number twice made a SECOND account (${again.amber_id})`);
}
// And the name they typed during onboarding has to stick.
await setUserName(OWNER, "Karthik Test").catch(() => null);
const named = await getUserByPhone(PHONE).catch(() => null);
if (named && named.full_name !== "Karthik Test") {
  flag("STEP 0 — signup", `the onboarding name did not persist (got ${JSON.stringify(named.full_name)})`);
}
line(`    account ${OWNER.slice(0, 8)} created, resolvable by phone, idempotent on re-verify, name persisted`);

let app = appFor(OWNER, PHONE);
await askAll(app, "STEP 1 — contacts permission DENIED", 0);

// ── STEP 2: sync in progress, one batch landed ──────────────────────────────
const book = phoneBook(1000).map(normalizeIncomingContact).filter(Boolean);
await upsertContactsForOwner({ ownerId: OWNER, ownerPhone: PHONE, contacts: book.slice(0, 200), mode: "three_way" });
await storeAppleCardDetails(OWNER, book.slice(0, 200));
// RETAGGED, BECAUSE THE ROUTE RETAGS PER REQUEST.
//
// The first version of this file skipped the retag here, on the theory that a
// sync in flight has not reached it yet, and duly reported that USC questions
// shrug during a sync. That was this test being wrong about the app: the iOS
// client sends 200 contacts per HTTP request, and POST /v1/me/contacts calls
// retagAddressBook inside the handler -- so every batch is retagged as it
// lands, and the first 200 contacts are labeled before the second batch is
// even sent. Mirroring the route rather than guessing at it.
await retagAddressBook(OWNER);
let n = (await pool.query(`SELECT count(*)::int AS n FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL`, [OWNER])).rows[0].n;
app = appFor(OWNER, PHONE);
await askAll(app, "STEP 2 — sync STILL RUNNING, first batch in and retagged", n);

// ── STEP 3: first sync completes ────────────────────────────────────────────
for (let i = 200; i < book.length; i += 200) {
  await upsertContactsForOwner({ ownerId: OWNER, ownerPhone: PHONE, contacts: book.slice(i, i + 200), mode: "three_way" });
}
await storeAppleCardDetails(OWNER, book);
const t0 = Date.now();
const retag1 = await retagAddressBook(OWNER);
const retagMs = Date.now() - t0;
n = (await pool.query(`SELECT count(*)::int AS n FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL`, [OWNER])).rows[0].n;
line(`\n  [first sync finished: ${n} contacts, retag scanned ${retag1.scanned} changed ${retag1.changed} in ${retagMs}ms]`);
app = appFor(OWNER, PHONE);
await askAll(app, "STEP 3 — first sync FINISHED", n);

// ── STEP 4: a second sync with nothing changed ──────────────────────────────
for (let i = 0; i < book.length; i += 200) {
  await upsertContactsForOwner({ ownerId: OWNER, ownerPhone: PHONE, contacts: book.slice(i, i + 200), mode: "three_way" });
}
const t1 = Date.now();
const retag2 = await retagAddressBook(OWNER);
const retag2Ms = Date.now() - t1;
const after = (await pool.query(`SELECT count(*)::int AS n FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL`, [OWNER])).rows[0].n;
line(`\n  [re-sync: ${after} contacts (was ${n}), retag changed ${retag2.changed} in ${retag2Ms}ms]`);
if (after !== n) flag("STEP 4 — re-sync", `the contact count moved from ${n} to ${after} with nothing changed on the phone`);
if (retag2.changed !== 0) flag("STEP 4 — re-sync", `the retag rewrote ${retag2.changed} rows although nothing changed`);

// ── STEP 5: contacts added one at a time (the cost I introduced today) ──────
line(`\n  [adding contacts one at a time -- createContactForOwner now retags the whole book on each]`);
const each = [];
for (let i = 0; i < 10; i++) {
  const s = Date.now();
  const made = await createContactForOwner({
    ownerId: OWNER,
    ownerPhone: PHONE,
    fullName: `Handmade Person-${i} Dentist`,
    phonePrimary: `+1415555${String(1000 + i).padStart(4, "0")}`,
    source: "manual",
  });
  each.push(Date.now() - s);
  if (!made?.id) flag("STEP 5 — add by hand", `createContactForOwner returned nothing for contact ${i}`);
}
const avg = Math.round(each.reduce((a, b) => a + b, 0) / each.length);
line(`    ${each.length} added, ${avg}ms each on a ${after}-contact book (max ${Math.max(...each)}ms)`);
// A whole-book retag per contact is defensible at a thousand contacts and not at
// ten thousand. This is the number that decides it.
if (avg > 400) {
  flag("STEP 5 — add by hand", `${avg}ms per single contact creation is too slow for the chat and iMessage paths`);
}

// Did the hand-added contact become findable, with its label?
const tagged = await pool.query(
  `SELECT full_name, contact_tags, area_metro FROM contacts
    WHERE owner_id = $1 AND source = 'manual' AND deleted_at IS NULL LIMIT 3`,
  [OWNER],
);
line("    and are they labeled and located?");
for (const r of tagged.rows) {
  line(`      ${JSON.stringify(r.full_name)}  tags=${JSON.stringify(r.contact_tags)}  metro=${JSON.stringify(r.area_metro)}`);
  if (!r.contact_tags || r.contact_tags.length === 0) {
    flag("STEP 5 — add by hand", `${r.full_name} has no derived label, so the labeled layer cannot find them`);
  }
  if (!r.area_metro) {
    flag("STEP 5 — add by hand", `${r.full_name} has no derived metro, so the area-code layer cannot find them`);
  }
}

app = appFor(OWNER, PHONE);
await askAll(app, "STEP 5 — after adding contacts by hand", after + 10);

// ── REPORT ──────────────────────────────────────────────────────────────────
line("\n" + "=".repeat(78));
line("WHAT A NEW USER WOULD HIT");
line("=".repeat(78));
if (problems.length === 0) line("nothing -- every step answered with something real.");
else {
  for (const p of problems) line(`  ${p.what}\n    ${p.detail}`);
}
await pool.end();
process.exit(problems.length === 0 ? 0 : 1);
