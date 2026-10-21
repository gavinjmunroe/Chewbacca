/**
 * THE GAUNTLET: LONG, CONVOLUTED, MULTI-INTENT TURNS AGAINST A LIVE MODEL.
 *
 * "Combine giving notes and asking for stuff in the same query. Make a massive
 *  query that has anecdotes peppered throughout with tons of people mentioned
 *  and asks for web searches, network searches, places, questions about other
 *  stuff, enrichments, etc."
 *
 * Every test before this one asked a single clean question. Real people do not.
 * They dump three minutes of context and six requests into one message, correct
 * themselves halfway through, name eight people, mention two the app has never
 * heard of, and finish with something unrelated. That message has to be
 * UNDERSTOOD, the facts in it have to be KEPT, and every request in it has to be
 * ANSWERED -- and none of that is exercised by "who do I know in New York".
 *
 * WHAT IS REAL HERE. The route, auth, the intent router (live), retrieval
 * against real Postgres, fact capture (live), the reply (live), the chips
 * (live), SSE over a real socket. Stood in: Exa and the place search, the two
 * paid services that are not the model. The Togari ranker is off, so the ladder
 * has to carry it.
 *
 * WHAT IT CHECKS, and the second one is the one that matters:
 *
 *   COVERAGE   every distinct ask in the message is addressed in the reply. A
 *              long message answered on its first clause only is the failure
 *              this file exists to find.
 *   CAPTURE    every fact stated in passing is written to the database, and the
 *              people named in passing exist afterwards -- including the ones
 *              who were not in the book when the message arrived.
 *   RECALL     a later, separate turn asks about one of those people and gets
 *              the fact back. Capture that cannot be read is not capture.
 *   TRUTH      no person is named who is not in that owner's book or in the web
 *              results, and no attribute is asserted that contradicts the book.
 *   VOICE      no plumbing vocabulary, no form letters, no empty bubbles.
 *
 *   ANTHROPIC_API_KEY=... IDENTITY_KEY_PEPPER=... node scripts/gauntlet.mjs
 */
import fs from "node:fs";
import pg from "pg";
import Fastify from "fastify";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";
import { buildBook, CAST } from "./gauntlet-book.mjs";

for (const k of ["IDENTITY_KEY_PEPPER", "ANTHROPIC_API_KEY"]) {
  if (!process.env[k]) { console.error(`Set ${k}.`); process.exit(2); }
}

const pool = new pg.Pool({
  host: process.env.SMOKE_PGHOST || "/tmp",
  port: Number(process.env.SMOKE_PGPORT || 5433),
  user: process.env.SMOKE_PGUSER || "postgres",
  database: process.env.SMOKE_PGDATABASE || "fleet",
  max: 8,
});
__injectPoolForSmokeTests(pool);

const { registerChatRoutes } = await import("../src/routes/chat.js");
const { loadContactsByOwnerId, upsertContactsForOwner } = await import("../src/db/store.js");
const { storeAppleCardDetails, retagAddressBook } = await import("../src/db/address-book-store.js");
const { normalizeIncomingContact } = await import("../src/routes/profile.js");

const line = (...a) => process.stdout.write(a.join(" ") + "\n");
const OUT = process.env.GAUNTLET_OUT || "/tmp/gauntlet.json";

// ── the two paid services ───────────────────────────────────────────────────
const standInExaSearch = async (q) =>
  Array.from({ length: 5 }, (_, i) => ({
    url: `https://example.com/${i}`,
    title: `Result ${i + 1} on ${String(q).slice(0, 40)}`,
    text: `A page about ${String(q).slice(0, 60)}. It names Wren Halloway, a partner at Northlight Capital in New York, and describes a Series B round closed last quarter.`,
    snippet: `A page about ${String(q).slice(0, 60)}.`,
    date: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
  }));
const standInExaContents = async (urls = []) =>
  (Array.isArray(urls) ? urls : []).slice(0, 5).map((u) => ({
    url: String(u), title: "Fetched page",
    text: "Full page text. Wren Halloway leads health infrastructure investing at Northlight Capital. ".repeat(14),
  }));
const standInExaFindPeople = async () => [
  { name: "Wren Halloway", title: "Partner", company: "Northlight Capital", url: "https://linkedin.com/in/wren-halloway" },
  { name: "Emeka Balogun", title: "VP of Engineering", company: "Corvid Health", url: "https://linkedin.com/in/emeka-balogun" },
];
const standInFindPlaces = async () => [
  { name: "Abraço", category: "Coffee", url: "https://abraco.example", address: "86 E 7th St, New York" },
  { name: "Saint Reine", category: "Wine bar", url: "https://saintreine.example", address: "219 Mulberry St, New York" },
  { name: "Kettle & Coop", category: "Cafe", url: "https://kettle.example", address: "14 Bleecker St, New York" },
];
// WEB NAMES ARE LEGITIMATE ANSWERS. The truth check has to know them or it will
// call every correct web result a hallucination.
const WEB_NAMES = new Set([
  "Wren Halloway", "Emeka Balogun", "Northlight Capital", "Corvid Health",
  // The venues the place stand-in returns. Naming one of these is the CORRECT
  // behavior -- the bug was naming Sightglass Coffee and Blue Bottle instead.
  "Saint Reine", "Kettle & Coop", "Abraço", "Mulberry St", "Bleecker St", "E 7th",
]);

function buildApp(owner, record) {
  const app = Fastify({ logger: false });
  registerChatRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = { userId: `did:gauntlet:${owner.label}`, phone: owner.phone };
    },
    resolveAmberIdByPhone: async () => owner.ownerId,
    listContacts: async () => (await loadContactsByOwnerId(owner.ownerId)) ?? [],
    getProfile: async () => ({ displayName: owner.displayName, currentCity: owner.city }),
    streamChat: async (args) => {
      const system = Array.isArray(args?.system)
        ? args.system.map((b) => (typeof b === "string" ? b : b?.text || "")).join("\n")
        : String(args?.system || "");
      record.prompts.push(system);
      return (await import("../src/routes/chat.js")).streamChat(args);
    },
    exaSearch: standInExaSearch,
    exaContents: standInExaContents,
    exaFindPeople: standInExaFindPeople,
    findPlaces: standInFindPlaces,
    streamViaTogariSearch: async function* () {},
    rankViaTogariSearch: async () => null,
    // appendMessage / listConversation / listRecentConversations LEFT REAL.
    //
    // Stubbing them to no-ops meant no conversation row was ever written, and
    // every captured fact then died on
    //   observations_source_conversation_id_fkey
    // because the fact rows carry the conversation as their source. The
    // exception is swallowed as a non-fatal capture failure, so the run looked
    // like "capture does not work" when it was the harness refusing to create
    // the row the real route always creates (chat.js persists the user message,
    // awaited, long before capture starts). A stub that removes a write the
    // code under test depends on is not a stand-in, it is a different program.
  });
  return app;
}

async function askOverHttp(app, message, extra = {}) {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address();
  const t0 = Date.now();
  let ttft = null, body = "";
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, ...extra }),
    });
    if (!res.body) return { statusCode: res.status, body: "", ttft: null, total: Date.now() - t0 };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      body += dec.decode(value, { stream: true });
      if (ttft == null && /event: token/.test(body)) ttft = Date.now() - t0;
    }
    return { statusCode: res.status, body, ttft, total: Date.now() - t0 };
  } finally {
    await app.close();
  }
}

const parseSse = (body) => {
  const out = [];
  for (const frame of String(body).split("\n\n")) {
    const t = frame.split("\n").find((l) => l.startsWith("event: "));
    const d = frame.split("\n").find((l) => l.startsWith("data: "));
    if (!t || !d) continue;
    try { out.push({ type: t.slice(7).trim(), data: JSON.parse(d.slice(6)) }); }
    catch { out.push({ type: t.slice(7).trim(), data: null }); }
  }
  return out;
};

// ── seed three owners ───────────────────────────────────────────────────────
async function makeOwner(label, size, seed, city) {
  const phone = `+1555${String(seed).padStart(7, "0")}`;
  await pool.query(`DELETE FROM users WHERE phone = $1`, [phone]);
  const u = await pool.query(
    `INSERT INTO users (phone, full_name, status) VALUES ($1, $2, 'active') RETURNING amber_id`,
    [phone, `Gauntlet ${label}`],
  );
  const ownerId = String(u.rows[0].amber_id);
  if (size > 0) {
    const raw = [...CAST, ...buildBook(size, seed)];
    const contacts = raw.map(normalizeIncomingContact).filter(Boolean);
    for (let i = 0; i < contacts.length; i += 200) {
      const batch = contacts.slice(i, i + 200);
      await upsertContactsForOwner({ ownerId, ownerPhone: phone, contacts: batch, mode: "three_way" });
      await storeAppleCardDetails(ownerId, batch);
    }
    await retagAddressBook(ownerId);
  }
  const n = (await pool.query(
    `SELECT count(*)::int n FROM contacts WHERE owner_id=$1 AND deleted_at IS NULL`, [ownerId],
  )).rows[0].n;
  return { ownerId, phone, label, n, displayName: `Gauntlet ${label}`, city };
}

const HEAVY = await makeOwner("heavy", 900, 11, "New York");
const MED = await makeOwner("med", 300, 23, "Los Angeles");
const FRESH = await makeOwner("fresh", 0, 31, "Seattle");

line("=".repeat(78));
line("THE GAUNTLET");
line("=".repeat(78));
for (const o of [HEAVY, MED, FRESH]) line(`  ${o.label.padEnd(6)} ${String(o.n).padStart(5)} contacts`);

// ── the turns ───────────────────────────────────────────────────────────────
// `asks` are the distinct requests buried in the message. Each carries probes:
// the reply must contain at least one. `anecdotes` are facts stated in passing
// that must end up in the database.
const TURNS = [
  {
    id: "G1-braindump",
    owner: HEAVY,
    message:
      "Okay this is going to be a lot, bear with me. I just got off a call with Danielle Kwon, she's the healthcare M&A partner at Cravath I've mentioned, and she told me she's leaving Cravath in November to go in-house as GC at a company called Corvid Health, which I'd never heard of. She also mentioned her daughter just started at Brown. Separately Marcus O'Dell texted me, he's moved from Sequoia to running his own fund now, still doing health infrastructure, and he asked me to find him two or three people I know who actually work inside hospital systems, not vendors selling into them, actual operators. I think Şirin Öztürk counts, she's cardiology at Mount Sinai. Who else do I know that fits that? " +
      "Then two other things. One, I'm going to be in New York the week of the 22nd and I want to do a dinner for maybe six people, somewhere in Nolita or the Lower East Side, not too loud, ideally a wine bar. Can you find me a few options and tell me who from my contacts is in New York that I could invite. " +
      "Two, can you look up what Corvid Health actually is, who runs it, whether they've raised anything, because if Danielle is going there as GC it's probably further along than I think. " +
      "Oh and one more, remind me that Priya, the LA one not the Flatiron one, is pregnant and due in February so I should not be pitching her on a job right now.",
    asks: [
      { label: "hospital operators in the network", probes: [/Şirin|Sirin|Öztürk|Ozturk|Mount Sinai/i] },
      { label: "dinner venue options", probes: [/Saint Reine|Abraço|Abraco|Kettle/i] },
      { label: "who in New York to invite", probes: [/New York|NYC/i] },
      { label: "look up Corvid Health", probes: [/Corvid/i] },
    ],
    anecdotes: [
      { person: "Danielle Kwon", probe: /corvid|general counsel|\bGC\b|leaving|november/i },
      { person: "Marcus O'Dell", probe: /own fund|left sequoia|leaving sequoia|his own/i },
      { person: "Priya Sundaram", probe: /pregnan|february|due/i },
    ],
  },
  {
    id: "G2-correction",
    owner: HEAVY,
    message:
      "Quick one but I keep getting this wrong. Tobias Lindqvist is the one hiring staff engineers, at Vercel, in Austin. No wait, that's right, but the person who told me about it was not Tobias, it was Grace, I don't remember Grace's last name, she's the one who used to work with him. Anyway Tobias is hiring two staff engineers and wants referrals by end of month. " +
      "Given that, who do I know that's a senior or staff level engineer anywhere, and separately who do I know in Austin at all, because if someone's already there that's an easier sell. " +
      "Also unrelated, what's the actual difference between a staff engineer and a principal engineer at most companies, I've never been clear on it. " +
      "And can you draft a short message to Tobias saying I'll send him names this week.",
    asks: [
      { label: "senior/staff engineers in the network", probes: [/engineer/i] },
      { label: "who is in Austin", probes: [/Austin|Tobias/i] },
      { label: "staff vs principal explainer", probes: [/staff|principal/i] },
      { label: "draft to Tobias", probes: [/Tobias/i] },
    ],
    anecdotes: [
      { person: "Tobias Lindqvist", probe: /staff engineer|hiring|referral/i },
    ],
  },
  {
    id: "G3-ambiguous-name",
    owner: HEAVY,
    message:
      "What do I know about Priya? I feel like there are two of them and I keep mixing them up, which one is at Flatiron and which one did I meet through Marcus. Also whichever one is in oncology data, I want to introduce her to Şirin, can you draft that intro. And while you're at it, is there anyone else in my contacts doing anything in oncology or cancer research specifically.",
    asks: [
      { label: "disambiguate the two Priyas", probes: [/Raghunathan/i] },
      { label: "the other Priya", probes: [/Sundaram|Ramp|Los Angeles|LA\b/i] },
      { label: "draft the intro", probes: [/Şirin|Sirin|Öztürk|Ozturk/i] },
      { label: "others in oncology", probes: [/oncolog|cancer|nobody|no one|only/i] },
    ],
    anecdotes: [],
  },
  {
    id: "G4-stranger-and-self",
    owner: HEAVY,
    message:
      "I met someone last night named Wren Halloway, partner at a fund called Northlight Capital, based in New York, does health infrastructure. Really sharp. She said to email her. I don't have her in my contacts. Can you find out more about her and Northlight from the web, and also tell me if anyone I already know overlaps with her world so I have something to open with. " +
      "Also for my own record: I'm moving to Brooklyn on the first of next month, and I'm off dairy now, which matters because people keep taking me to cheese places. " +
      "And who do I know in Brooklyn already.",
    asks: [
      { label: "web lookup on Wren/Northlight", probes: [/Wren|Northlight/i] },
      { label: "overlap in the network", probes: [/Marcus|health|invest/i] },
      { label: "who is in Brooklyn", probes: [/Brooklyn|718/i] },
    ],
    anecdotes: [
      { person: "Wren Halloway", probe: /northlight|partner|health/i, mustBeCreated: true },
    ],
    selfFacts: [/brooklyn/i, /dairy/i],
  },
  {
    id: "G5-nobody-matches",
    owner: HEAVY,
    message:
      "Do I know any commercial airline pilots, or anyone in aviation at all? Also anyone who's done a Series A at a hardware company. And if the answer is nobody for both, tell me straight rather than showing me people who are almost it. Then separately, my friend Emeka Balogun, who is not in my phone, just became VP of Engineering at Corvid Health, can you note that, and remind me who else I know at Corvid.",
    asks: [
      { label: "aviation: say nobody plainly", probes: [/no one|nobody|not|don't have|do not have/i] },
      { label: "hardware Series A", probes: [/hardware|series a|no one|nobody|not/i] },
      { label: "who else at Corvid", probes: [/Corvid|Danielle|no one|nobody/i] },
    ],
    anecdotes: [
      { person: "Emeka Balogun", probe: /corvid|vp of engineering|engineering/i, mustBeCreated: true },
    ],
  },
  {
    id: "G6-med-book",
    owner: MED,
    message:
      "Two things at once. First, Hana Yilmaz, I have literally nothing on her but a phone number, she's my landlord's daughter and she's applying to nursing programs, so if anything healthcare comes up she's someone to help. Second, I need to put together a short list of people I know in finance or investing for a fundraise, and I want to know for each one whether I actually have a way to reach them or just a phone number. Then tell me what my book is actually missing, like what would make the next answer better.",
    asks: [
      { label: "finance/investing list", probes: [/finance|invest|Goldman|Blackstone|Citadel|Sequoia|a16z|Evercore|Bridgewater|no one|nobody/i] },
      { label: "reachability per person", probes: [/email|phone|number|reach/i] },
      { label: "what the book is missing", probes: [/missing|email|compan|note|add/i] },
    ],
    anecdotes: [
      { person: "Hana Yilmaz", probe: /nursing|landlord|healthcare/i },
    ],
  },
  {
    id: "G7-fresh-user",
    owner: FRESH,
    message:
      "I just downloaded this. Before I connect anything, what actually happens to my contacts, where do they go. Also my sister Ana Alvarez is a nurse practitioner in Denver and my best friend from school is Kwame Mensah, he does something in logistics in Houston, can you hold onto both of those. Then tell me what I should do first.",
    asks: [
      { label: "what happens to contacts", probes: [/contact|sync|your/i] },
      { label: "what to do first", probes: [/sync|start|first|tell me/i] },
    ],
    anecdotes: [
      { person: "Ana Alvarez", probe: /nurse|denver/i, mustBeCreated: true },
      { person: "Kwame Mensah", probe: /logistics|houston|school/i, mustBeCreated: true },
    ],
  },
  {
    id: "G8-everything",
    owner: HEAVY,
    message:
      "Last big one. Recap of my week so you have it: had coffee with Marcus O'Dell on Monday, he's raising a $40M first fund and wants LPs who understand hospital economics. Tuesday I saw Danielle Kwon again, her start date at Corvid got pushed to January. Wednesday nothing. Thursday I had dinner with Şirin Öztürk and she said Mount Sinai is standing up a new cardiology data program and she needs someone who can build it, which is basically the job Tobias's staff engineers would want, so there might be something there. Friday I finally met Hana Yilmaz's mother, who runs a catering business in Chicago, and I said I'd help her with a website. " +
      "So: who in my contacts could build a cardiology data program, who do I know in Chicago in case I want to help with the catering thing, whose birthday is coming up in the next month, find me a coffee place near Union Square for next Tuesday, look up what a first-time fund manager typically needs from an LP, and draft me a message to Marcus connecting him to anyone relevant. Also is there anyone I have not talked to in a long time that I should pick back up with.",
    asks: [
      { label: "who could build the data program", probes: [/engineer|Tobias|data/i] },
      { label: "who is in Chicago", probes: [/Chicago|312|no one|nobody/i] },
      { label: "birthdays next month", probes: [/birthday/i] },
      { label: "coffee near Union Square", probes: [/Abraço|Abraco|Kettle|Saint Reine|coffee/i] },
      { label: "first-time fund manager / LP question", probes: [/LP|fund|limited partner/i] },
      { label: "draft to Marcus", probes: [/Marcus/i] },
    ],
    anecdotes: [
      { person: "Marcus O'Dell", probe: /40|first fund|raising|LP/i },
      { person: "Danielle Kwon", probe: /january|pushed|start date/i },
      { person: "Şirin Öztürk", probe: /cardiology data|program|build/i },
    ],
  },
];

// Follow-ups, run after every turn above, in a fresh conversation, to prove the
// facts survived the turn that stated them.
const RECALL = [
  { owner: HEAVY, q: "what do you know about Danielle Kwon", probes: [/corvid|general counsel|\bGC\b|january|brown/i] },
  { owner: HEAVY, q: "what's going on with Marcus O'Dell", probes: [/fund|raising|LP|40/i] },
  { owner: HEAVY, q: "tell me about Wren Halloway", probes: [/northlight|partner|health/i] },
  { owner: HEAVY, q: "who is Emeka Balogun", probes: [/corvid|engineering/i] },
  { owner: HEAVY, q: "is Priya Sundaram pregnant", probes: [/pregnan|february|due|yes/i] },
  { owner: MED, q: "what do I know about Hana Yilmaz", probes: [/nursing|landlord|healthcare/i] },
  { owner: FRESH, q: "who is Ana Alvarez", probes: [/nurse|denver|sister/i] },
];

// ── run ─────────────────────────────────────────────────────────────────────
// "came through Marcus's network" is ordinary English and was being flagged, so
// the phrase has to be anchored to the thing that came through: a NAME or a
// RESULT, not a person. Only the machinery vocabulary counts.
const PLUMBING =
  /\b(the data(?![a-z])|a tag\b|tag or category|(?:names?|results?|records?|fields?)\s+(?:did not|didn't|do not|don't)\s+(?:come through|resolve|populate|return)|the filter\b|filter ran|in the data\b|on my end|database|the record\b)\b/i;

const problems = [];
const notes = [];
const flag = (kind, detail, id) => problems.push({ kind, detail, id });
const results = [];

const nameRe = /\b([A-ZÀ-ÿŞÖ][\p{L}'’-]+ [A-ZÀ-ÿŞÖ][\p{L}'’-]+)\b/gu;

async function bookNames(ownerId) {
  const r = await pool.query(
    `SELECT full_name FROM contacts WHERE owner_id=$1 AND deleted_at IS NULL`, [ownerId],
  );
  return new Set(r.rows.map((x) => String(x.full_name || "").trim()).filter(Boolean));
}

for (const turn of TURNS) {
  const record = { prompts: [] };
  const app = buildApp(turn.owner, record);
  let res;
  try {
    res = await askOverHttp(app, turn.message);
  } catch (err) {
    flag("REQUEST THREW", String(err?.message ?? err), turn.id);
    continue;
  }
  const events = parseSse(res.body);
  const answer = events.filter((e) => e.type === "token").map((e) => e.data?.text ?? "").join("");
  const chips = events.filter((e) => e.type === "suggestions").flatMap((e) => e.data?.suggestions ?? []);
  const people = events.filter((e) => e.type === "people").flatMap((e) => e.data?.people ?? []);
  const places = events.filter((e) => e.type === "places").flatMap((e) => e.data?.places ?? []);
  const intent = events.find((e) => e.type === "meta")?.data?.intent
    ?? events.find((e) => e.type === "intent")?.data?.intent ?? null;
  // The cards that ask "did you mean this person?" / "add as a new contact?".
  // A fact that needs a tap and never offers one is a fact the user loses.
  const confirmCards = events.filter((e) =>
    e.type === "clarify" || e.type === "soft_confirm" || e.type === "captured").map((e) => e.type);

  if (res.statusCode !== 200) flag("HTTP", `status ${res.statusCode}`, turn.id);
  if (events.at(-1)?.type !== "complete") flag("NO COMPLETE", `ended on ${events.at(-1)?.type}`, turn.id);
  if (!answer.trim()) flag("EMPTY", "no answer text at all", turn.id);
  if (PLUMBING.test(answer)) {
    flag("PLUMBING", `"${answer.match(PLUMBING)[0]}" — ...${answer.slice(Math.max(0, answer.search(PLUMBING) - 60), answer.search(PLUMBING) + 60)}...`, turn.id);
  }

  // COVERAGE
  const missed = (turn.asks ?? []).filter((a) => !a.probes.some((p) => p.test(answer)));
  for (const m of missed) flag("ASK NOT ANSWERED", `"${m.label}" is nowhere in the reply`, turn.id);

  // CAPTURE — POLLED, NOT SLEPT ON.
  //
  // The first version waited a flat 1.5s and reported 12 of 12 facts missing.
  // Extraction on a 1,300-character message is a model call over ten signals
  // plus name resolution against 900 contacts: measured at 16.4 seconds. The
  // harness was reading the table before the write existed. A fixed sleep in a
  // test is a coin flip dressed as an assertion; this waits for the row or for
  // the deadline, and reports how long it took so the LATENCY is visible too.
  const CAP_DEADLINE_MS = 45000;
  const captured = [];
  for (const a of turn.anecdotes ?? []) {
    const started = Date.now();
    let hit = null;
    let seen = null;
    while (Date.now() - started < CAP_DEADLINE_MS) {
      // A FACT CAN LAND IN TWO PLACES AND BOTH COUNT.
      //
      // The "fact" route writes an observation; the "contact_field" route writes
      // straight onto the person's card -- Danielle's move to Corvid arrives as
      // company/title on the contact row, not as a sentence in observations. The
      // first version of this check read only observations and reported
      // "nothing stored for Danielle Kwon" on a turn where the recall question
      // two minutes later answered "incoming General Counsel at Corvid".
      const rows = await pool.query(
        `SELECT o.body, o.status, o.raw_name, c.full_name
           FROM observations o LEFT JOIN contacts c ON c.id = o.contact_id
          WHERE o.owner_id = $1 AND o.deleted_at IS NULL
            AND (c.full_name ILIKE $2 OR o.raw_name ILIKE $2 OR o.body ILIKE $2)
          ORDER BY o.observed_at DESC LIMIT 40`,
        [turn.owner.ownerId, `%${a.person.split(" ")[0]}%`],
      );
      const cardRows = await pool.query(
        `SELECT full_name,
                concat_ws(' ', full_name, company, title, department, city, region, apple_notes) AS card
           FROM contacts
          WHERE owner_id = $1 AND deleted_at IS NULL AND full_name ILIKE $2
          LIMIT 10`,
        [turn.owner.ownerId, `%${a.person.split(" ")[0]}%`],
      );
      seen = rows.rows[0]?.body ?? seen;
      hit = rows.rows.find((r) => a.probe.test(String(r.body || "")));
      if (!hit) {
        const card = cardRows.rows.find((r) => a.probe.test(String(r.card || "")));
        if (card) hit = { body: card.card, status: "on_card", raw_name: null, full_name: card.full_name };
      }
      if (hit) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    captured.push({
      person: a.person, found: !!hit, waitedMs: Date.now() - started,
      status: hit?.status ?? null, attachedTo: hit?.full_name ?? hit?.raw_name ?? null,
      sample: hit?.body ?? seen ?? null,
    });
    if (!hit) {
      flag("FACT NOT CAPTURED", `nothing stored for ${a.person} matching ${a.probe} after ${CAP_DEADLINE_MS}ms`, turn.id);
    } else if ((hit.status === "pending" || !hit.full_name) && !a.mustBeCreated) {
      // A FACT ABOUT A KNOWN CONTACT SHOULD REACH THEIR CARD. A fact about
      // somebody who is not in the book is SUPPOSED to sit unfiled -- Amber does
      // not manufacture a person from a passing mention, it offers a card and
      // waits for a tap. That is only acceptable because the unfiled rows are now
      // read back (gather.js unfiledLayer), which the recall turns prove; before
      // that, parking a fact and denying it later was the same as losing it.
      flag("FACT PARKED", `${a.person}: stored but attached to nobody (status=${hit.status}, raw_name=${hit.raw_name})`, turn.id);
    }
    if (a.mustBeCreated) {
      const c = await pool.query(
        `SELECT 1 FROM contacts WHERE owner_id=$1 AND deleted_at IS NULL AND full_name ILIKE $2 LIMIT 1`,
        [turn.owner.ownerId, `%${a.person.split(" ").at(-1)}%`],
      );
      // NOT A FAILURE, A DESIGN. Recorded so the run shows it, and checked
      // against the thing that actually matters: the fact has to be readable
      // afterwards, which the RECALL turns below assert directly.
      if (c.rowCount === 0) {
        notes.push(`${turn.id}: ${a.person} has no card (by design) — recall must still answer`);
      }
    }
  }

  // TRUTH
  const known = await bookNames(turn.owner.ownerId);
  const firsts = new Set([...known].map((n) => n.split(/\s+/)[0]));
  const invented = [];
  // A NAME THE USER THEMSELVES JUST TYPED IS NOT AN INVENTION, and neither is a
  // two-word markdown heading. The first pass flagged "On Corvid", "Intro Draft"
  // and the user's own sister -- noise that buries the one real hallucination.
  const saidByUser = new Set([...String(turn.message).matchAll(nameRe)].map((m) => m[1]));
  const headingish = new Set(
    [...answer.matchAll(/^#{1,6}\s*(.+)$/gm)].flatMap((m) => [...String(m[1]).matchAll(nameRe)].map((x) => x[1])),
  );
  for (const m of answer.matchAll(nameRe)) {
    const cand = m[1];
    if (saidByUser.has(cand) || headingish.has(cand)) continue;
    if (/^(On|If|For|Beyond|Near|Your|Hey|Hi|Dear|About|From|With|And|But|The|This|That|What|When|Where|Why|How|Also|Then|So|Both|Either) /.test(cand)) continue;
    if (known.has(cand) || WEB_NAMES.has(cand) || firsts.has(cand.split(" ")[0])) continue;
    if (/^(New York|Los Angeles|San Francisco|Union Square|Lower East|Mount Sinai|Corvid Health|Northlight Capital|Flatiron Health|Kaiser Permanente|Goldman Sachs|Union Square|Staff Engineer|Principal Engineer|Nurse Practitioner|Series A|Series B)$/.test(cand)) continue;
    invented.push(cand);
  }
  for (const c of [...new Set(invented)]) {
    flag("POSSIBLE INVENTION", `reply names "${c}"`, turn.id);
  }

  for (const p of people) {
    if (!p?.contactId) continue;
    const own = await pool.query(`SELECT owner_id FROM contacts WHERE id=$1`, [p.contactId]);
    if (String(own.rows[0]?.owner_id) !== turn.owner.ownerId) {
      flag("CROSS-OWNER LEAK", `contact ${p.contactId} is not ${turn.owner.label}'s`, turn.id);
    }
  }

  results.push({
    id: turn.id, owner: turn.owner.label, book: turn.owner.n, intent, confirmCards,
    words: turn.message.split(/\s+/).length,
    ttft: res.ttft, total: res.total,
    asks: (turn.asks ?? []).map((a) => ({ label: a.label, answered: a.probes.some((p) => p.test(answer)) })),
    captured, places: places.length, peopleCount: people.length,
    chips: chips.map((c) => c.label), answer,
  });
  line(
    `  ${turn.id.padEnd(20)} ${String(turn.message.split(/\s+/).length).padStart(4)}w  ` +
      `ttft=${String(res.ttft ?? "-").padStart(5)} total=${String(res.total).padStart(6)}ms  ` +
      `asks ${(turn.asks ?? []).filter((a) => a.probes.some((p) => p.test(answer))).length}/${(turn.asks ?? []).length}  ` +
      `facts ${captured.filter((c) => c.found).length}/${captured.length}  ` +
      `intent=${String(intent).padEnd(13)} cards=${confirmCards.length}  ${answer.length}ch`,
  );
}

line("\n  --- recall, in a separate turn ---");
for (const r of RECALL) {
  const record = { prompts: [] };
  const app = buildApp(r.owner, record);
  let res;
  try {
    res = await askOverHttp(app, r.q, { followUp: true });
  } catch (err) {
    flag("RECALL THREW", String(err?.message ?? err), r.q);
    continue;
  }
  const events = parseSse(res.body);
  const answer = events.filter((e) => e.type === "token").map((e) => e.data?.text ?? "").join("");
  const ok = r.probes.some((p) => p.test(answer));
  if (!ok) flag("RECALL FAILED", `"${r.q}" came back without the fact: ${JSON.stringify(answer.slice(0, 200))}`, r.q);
  results.push({ id: `recall: ${r.q}`, owner: r.owner.label, recall: ok, ttft: res.ttft, total: res.total, answer });
  line(`  ${ok ? "ok  " : "MISS"} ${JSON.stringify(r.q).slice(0, 46).padEnd(48)} ${String(res.total).padStart(6)}ms  ${answer.length}ch`);
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
line(`\n  full replies written to ${OUT}`);

line("\n" + "=".repeat(78));
line("PROBLEMS");
line("=".repeat(78));
if (notes.length > 0) {
  line("\n  BY DESIGN, RECORDED NOT FLAGGED");
  for (const n of notes) line(`     ${n}`);
  line("");
}
if (problems.length === 0) line("  none.");
else {
  const byKind = new Map();
  for (const p of problems) {
    if (!byKind.has(p.kind)) byKind.set(p.kind, []);
    byKind.get(p.kind).push(p);
  }
  for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    line(`\n  ${kind}  (${list.length})`);
    for (const p of list) line(`     ${String(p.id).slice(0, 40).padEnd(42)} ${p.detail}`);
  }
}

await pool.end();
process.exit(problems.length === 0 ? 0 : 1);
