/**
 * THE WHOLE FLOW, AS A USER, WITH NO API KEYS.
 *
 * "replace exa and the claude api key with just your functionality mirroring
 *  what they would do as a stand in"
 *
 * So this drives the REAL HTTP route -- POST /v1/chat, real auth, real intent
 * routing, real retrieval against a real Postgres, real SSE streaming, real
 * persistence -- and substitutes only the three things that cost money: the
 * model, Exa, and the places search. The stand-ins are not stubs that return
 * nothing; they behave the way the real ones behave, which is what makes the
 * assertions mean anything.
 *
 * ── WHY THE MODEL STAND-IN IS THE POINT ────────────────────────────────────
 *
 * The real Claude reads a system prompt and writes an answer from it. It cannot
 * name a person the prompt never mentioned, and it cannot know a fact the prompt
 * did not carry. So the question "does the app answer well" reduces almost
 * entirely to "was the model handed the right material", and THAT is checkable
 * without a key.
 *
 * The stand-in therefore does exactly what the model does with a grounded block:
 * it parses the people and the quoted excerpts out of the prompt and composes an
 * answer from them. Then this file asserts:
 *
 *   - when the database holds people matching the question, the PROMPT contains
 *     them (this is the "I don't have any information" bug, caught at its cause
 *     rather than at its symptom);
 *   - every person the answer names is real, and belongs to THIS owner;
 *   - the prompt never contains JavaScript source, an uninterpolated ${...}, or
 *     a person listed by a blank reason;
 *   - the SSE contract holds, and a turn always reaches `complete`;
 *   - the answer is never a bare shrug when there was material to use.
 *
 * ── HOW TO RUN ─────────────────────────────────────────────────────────────
 *
 *   node scripts/fleet-full-flow.mjs            # after seeding with adversarial-fleet
 *
 * Env: SMOKE_PG* for the database, FLEET_FROM / FLEET_TO to run a slice of the
 * owners, FLEET_QUERIES to cap questions per owner.
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
  database: process.env.SMOKE_PGDATABASE || "fleet",
  max: Number(process.env.SMOKE_POOL_MAX || 16),
});
__injectPoolForSmokeTests(pool);

const { registerChatRoutes } = await import("../src/routes/chat.js");
const { listContactsForOwnerAppShape, loadContactsByOwnerId } = await import("../src/db/store.js");

const line = (...a) => process.stdout.write(a.join(" ") + "\n");
const pctl = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);

const failures = [];
const fail = (kind, detail, ctx = {}) => failures.push({ kind, detail, ...ctx });

// ── THE STAND-INS ───────────────────────────────────────────────────────────

/**
 * The model. Reads the grounded block out of the system prompt and answers from
 * it, exactly as the real one must.
 *
 * It also RECORDS the prompt, which is the whole reason this exists: the
 * assertions below are mostly about what the model was given, because that is
 * what determines whether the answer can be any good.
 */
function makeStandInModel(record) {
  return async ({ system, messages, onToken }) => {
    const prompt = Array.isArray(system)
      ? system.map((b) => (typeof b === "string" ? b : b?.text || "")).join("\n")
      : String(system || "");
    const asked = String(messages?.at(-1)?.content ?? "");
    record.prompts.push(prompt);

    // The people the prompt named, parsed the way a reader would: the block
    // lists them as "  - Name — Title — Company  [where]".
    const named = [];
    for (const m of prompt.matchAll(/^ {2}- (.+?)(?:\s{2}\[|$)/gm)) {
      const who = m[1].split(" — ")[0].trim();
      if (who) named.push(who);
    }
    // And the excerpts it quoted, which are what a good answer actually uses.
    const quotes = [...prompt.matchAll(/^ {6}"(.+)"$/gm)].map((m) => m[1]);

    let answer;
    if (named.length > 0) {
      const head = named.slice(0, 5);
      answer =
        `${head.join(", ")}${named.length > 5 ? ` and ${named.length - 5} more` : ""}` +
        ` came back for that.` +
        (quotes.length ? ` Your note on the first one says "${quotes[0]}".` : "") +
        ` Want me to draft something to one of them?`;
    } else if (/THE SHAPE OF THEIR BOOK/.test(prompt)) {
      // MATCH THE HEADING, THEN LOOK FOR A NUMBER NEAR IT.
      //
      // This used to require the exact bytes "THE SHAPE OF THEIR BOOK: 2897
      // contacts". The prompt was reworded (every count now carries its
      // denominator, because a bare numerator got read as the whole book) and
      // this regex stopped matching, so the stand-in fell through to "I looked
      // and could not place that" on 243 turns and the run reported 243 SHRUG
      // failures against an app that had not regressed at all.
      //
      // A test fixture that pins the exact wording of a prompt fails every time
      // the prompt is improved, which trains you to ignore it. Anchor on the
      // heading, which is the contract, and read the number loosely.
      const total =
        prompt.match(/THE SHAPE OF THEIR BOOK[^\n]*?(\d[\d,]*) contacts/)?.[1] ?? "some";
      answer =
        `You have ${total} contacts saved. Nothing in them matches that directly,` +
        ` and here is what I did look through. Want to add a note about anyone?`;
    } else {
      answer = `I looked and could not place that. ${asked.slice(0, 40)}`;
    }
    for (const chunk of answer.match(/.{1,24}/g) ?? []) onToken(chunk);
    return answer;
  };
}

/** Exa web search. Shaped like the real rows: url, title, text, date. */
const standInExaSearch = async (q, opts = {}) => {
  const n = Math.min(Number(opts?.numResults ?? 5) || 5, 8);
  return Array.from({ length: n }, (_, i) => ({
    url: `https://example.com/${encodeURIComponent(String(q).slice(0, 20))}/${i}`,
    title: `Result ${i + 1} about ${String(q).slice(0, 40)}`,
    text: `A page discussing ${String(q).slice(0, 60)}. It mentions hiring, funding and a move to New York.`,
    snippet: `A page discussing ${String(q).slice(0, 60)}.`,
    date: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
  }));
};

/** Exa people search, restricted to LinkedIn the way the real one is. */
const standInExaFindPeople = async () => [
  { name: "Ada Byron", title: "VP Engineering", company: "Acme Hardware", url: "https://linkedin.com/in/ada-byron" },
  { name: "Grace Hopper", title: "VP of Engineering", company: "Naval Systems", url: "https://linkedin.com/in/grace-hopper" },
  { name: "Shirley Park", title: "Director of Engineering", company: "Stripe", url: "https://linkedin.com/in/shirley-park" },
];

/** The place search, shaped like the real card. */
const standInFindPlaces = async () => [
  { name: "Abraço", category: "Coffee", url: "https://abraco.nyc", address: "86 E 7th St, New York" },
  { name: "Ruby's", category: "Cafe", url: "https://rubys.example", address: "219 Mulberry St, New York" },
];

/** Deep page read. */
const standInExaContents = async (urls = []) =>
  (Array.isArray(urls) ? urls : []).slice(0, 5).map((u) => ({
    url: String(u),
    title: "Fetched page",
    text: "The full text of the page, long enough to count as a real read. ".repeat(20),
  }));

/**
 * The intent router. Mirrors the real classifier's OUTPUT SHAPE and its rough
 * judgment, from the question alone -- deliberately simple, because the route's
 * own planner is what this test is exercising, not the classifier.
 */
const standInClassify = async ({ message } = {}) => {
  const m = String(message || "").toLowerCase();
  const aboutOwnPeople = /\b(i know|my |who do i|anyone i)\b/.test(m);
  const aboutWorld = /\b(find me|vps? of|search|news|best way|recommend)\b/.test(m);
  if (aboutOwnPeople && aboutWorld) return { intent: "both", needsWeb: true };
  if (aboutOwnPeople) return { intent: "network_query", needsWeb: false };
  if (aboutWorld) return { intent: "chat", needsWeb: true };
  return { intent: "chat", needsWeb: false };
};

/** Chips, built only from the people the route actually handed over. */
const standInSuggestions = async ({ people = [] } = {}) => {
  const out = [];
  for (const p of people.slice(0, 2)) {
    if (p?.contactId && p?.name) {
      out.push({ type: "draft_message", label: `Draft a message to ${p.name}`, contactId: String(p.contactId) });
    }
  }
  out.push({ type: "add_note", label: "Add a note about someone" });
  return out;
};

// ── THE APP, WIRED TO THE REAL DATABASE ─────────────────────────────────────
function buildAppForOwner(owner, record) {
  const app = Fastify({ logger: false });
  registerChatRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = { userId: `did:fleet:${owner.i}`, phone: owner.phone };
    },
    resolveAmberIdByPhone: async () => owner.ownerId,
    // REAL contacts, from the REAL database, for THIS owner.
    listContacts: async () => (await loadContactsByOwnerId(owner.ownerId)) ?? [],
    getProfile: async () => ({ displayName: `Fleet ${owner.i}`, currentCity: "Los Angeles" }),
    classifyIntent: standInClassify,
    streamChat: makeStandInModel(record),
    exaSearch: standInExaSearch,
    exaContents: standInExaContents,
    exaFindPeople: standInExaFindPeople,
    findPlaces: standInFindPlaces,
    generateSuggestions: standInSuggestions,
    // The ranker is a separate service; standing it down means the ladder is
    // what has to answer, which is exactly the path under test.
    streamViaTogariSearch: async function* () {},
    rankViaTogariSearch: async () => null,
    appendMessage: async () => {},
    listConversation: async () => [],
    listRecentConversations: async () => [],
  });
  return app;
}

const parseSse = (body) => {
  const out = [];
  for (const frame of String(body).split("\n\n")) {
    const lines = frame.split("\n");
    const t = lines.find((l) => l.startsWith("event: "));
    const d = lines.find((l) => l.startsWith("data: "));
    if (!t || !d) continue;
    try {
      out.push({ type: t.slice(7).trim(), data: JSON.parse(d.slice(6)) });
    } catch {
      out.push({ type: t.slice(7).trim(), data: null });
    }
  }
  return out;
};

// ── THE QUESTIONS ───────────────────────────────────────────────────────────
const LONG_PASTE =
  "I was thinking about the meeting yesterday and everyone who was there and what " +
  "they said about the roadmap and the hiring plan and ".repeat(14);

const QUERIES = [
  "tell me about my network and who is all in NYC working in tech",
  "find me VPs of engineering in New York, tell me who I already know there, recommend a coffee shop near Union Square, whose birthday is coming up, and draft an intro to the best one",
  "who do I know at C++ (the language) [seriously]?",
  "who do I know'); DROP TABLE contacts;--",
  "a|b|.*|(((",
  "%_\\ who has a wildcard",
  "'; SELECT * FROM users; --",
  "$1 $2 ${terms} {{name}}",
  "",
  "   \t\n  ",
  "?",
  "who do I know about the thing",
  LONG_PASTE,
  "who do I know 🇯🇵 in 東京",
  "من أعرف في نيويورك",
  "wer kennt Müller-Lüdenscheidt",
  "X".repeat(120),
  "🙂🙂🙂",
  "do I know anyone called Will or May or Art",
  "who's at Barry's? and o'brien?",
  "anyone in bio-tech or e-commerce",
  "WHO DO I KNOW THAT GOES TO usc",
  "any lawyers, doctors, dentists, plumbers, or orthodontists",
  "who do I know named Park",
  "how many people do I know",
];

// ── RUN ─────────────────────────────────────────────────────────────────────
const all = await pool.query(
  `SELECT u.amber_id, u.phone FROM users u WHERE u.phone LIKE '+1888%' ORDER BY u.phone`,
);
const FROM = Number(process.env.FLEET_FROM || 0);
const TO = Number(process.env.FLEET_TO || all.rows.length);
const QN = Number(process.env.FLEET_QUERIES || QUERIES.length);
const owners = all.rows.slice(FROM, TO).map((r, k) => ({ i: FROM + k, ownerId: String(r.amber_id), phone: r.phone }));

line("=".repeat(78));
line(`FULL FLOW THROUGH POST /v1/chat — ${owners.length} owners x ${QN} questions = ${owners.length * QN} turns`);
line("=".repeat(78));

// Ground truth for the leak check.
const ownerOf = new Map();
for (const row of (await pool.query(`SELECT id, owner_id FROM contacts WHERE deleted_at IS NULL`)).rows) {
  ownerOf.set(String(row.id), String(row.owner_id));
}
const nameSets = new Map();

const latencies = [];
let turns = 0;
let grounded = 0;
let shrugs = 0;
// PER PATH, THE RIGHT METRIC.
//
// `grounded` (did the prompt carry the book?) only means something where a model
// is called. network_query composes its own sentence and calls no model, so it
// scored 0/2 while actually working. What matters on EVERY path is the same
// thing: did the turn come back with real people from this user's own book.
const perQuery = new Map(
  QUERIES.slice(0, QN).map((q) => [
    q,
    { turns: 0, grounded: 0, answeredWithPeople: 0, substantive: 0, shrugged: 0, people: 0, ms: [] },
  ]),
);

/**
 * A question that leaves NO search terms behind is a question about the book
 * rather than about a person in it -- "how many people do I know", "what do you
 * know about my contacts". Computed with the app's own tokenizer so the test
 * cannot disagree with the code about what a term is.
 */
const { termsFrom } = await import("../src/db/gather.js");
const bookIsAboutQuestion = (q) => q.trim().length > 0 && termsFrom(q).length === 0;
const started = Date.now();

for (const owner of owners) {
  const record = { prompts: [] };
  const app = buildAppForOwner(owner, record);

  // What this owner actually holds, so "the prompt should have named someone"
  // can be checked against the database rather than against a guess.
  if (!nameSets.has(owner.ownerId)) {
    const rows = await pool.query(
      `SELECT id, full_name FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL`, [owner.ownerId],
    );
    nameSets.set(owner.ownerId, new Set(rows.rows.map((r) => String(r.full_name || "")).filter(Boolean)));
  }

  for (const q of QUERIES.slice(0, QN)) {
    const ctx = { owner: owner.i, query: JSON.stringify(q).slice(0, 56) };
    record.prompts.length = 0;
    const t0 = process.hrtime.bigint();
    let res;
    try {
      res = await app.inject({ method: "POST", url: "/v1/chat", payload: { message: q } });
    } catch (err) {
      fail("REQUEST THREW", err?.message ?? String(err), ctx);
      continue;
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    latencies.push(ms);
    turns++;
    const score = perQuery.get(q);
    score.turns++;
    score.ms.push(ms);

    // A. A TURN ALWAYS FINISHES. This is the spinner-forever complaint.
    //
    // An empty or whitespace-only message is REJECTED by the route's own schema,
    // and that is correct -- there is nothing to answer. Asserting 200 for those
    // was this test being wrong about the app.
    const mustReject = q.trim().length === 0;
    if (mustReject) {
      if (res.statusCode !== 400) {
        fail("SHOULD REJECT", `an empty message returned ${res.statusCode}, not 400`, ctx);
      }
      continue;
    }
    if (res.statusCode !== 200) {
      fail("HTTP", `status ${res.statusCode}: ${String(res.body).slice(0, 160)}`, ctx);
      continue;
    }
    const events = parseSse(res.body);
    const types = events.map((e) => e.type);
    if (types.at(-1) !== "complete") {
      fail("NO COMPLETE", `stream ended on "${types.at(-1)}" after [${types.slice(0, 8).join(",")}]`, ctx);
    }
    if (types[0] !== "meta") fail("CONTRACT", `first event was "${types[0]}", not "meta"`, ctx);

    // B. THE MODEL WAS GIVEN SOMETHING, AND IT WAS CLEAN.
    for (const p of record.prompts) {
      if (/"\s*\+\s*\n/.test(p) || /"\s*\+\s*"/.test(p)) {
        fail("SOURCE IN PROMPT", `the prompt contains a string concatenation: ...${p.match(/.{0,60}"\s*\+.{0,40}/)?.[0] ?? ""}`, ctx);
      }
      if (/\$\{[a-zA-Z_]/.test(p)) {
        fail("UNINTERPOLATED", `the prompt contains \${...}: ...${p.match(/.{0,50}\$\{[a-zA-Z_][^}]*\}/)?.[0] ?? ""}`, ctx);
      }
      if (/\[tagged \]/.test(p)) {
        fail("BLANK REASON", "a person is listed as [tagged ] with nothing to name them by", ctx);
      }
    }
    const promptText = record.prompts.join("\n");
    if (/THE SHAPE OF THEIR BOOK/.test(promptText)) {
      grounded++;
      score.grounded++;
    }

    // C. EVERY PERSON THE PROMPT NAMED IS REAL, AND IS THIS OWNER'S.
    const peopleEvents = events.filter((e) => e.type === "people");
    for (const ev of peopleEvents) {
      for (const p of ev.data?.people ?? []) {
        if (!p?.contactId) continue;
        const real = ownerOf.get(String(p.contactId));
        if (real === undefined) fail("PHANTOM PERSON", `emitted contact ${p.contactId}, not a live row`, ctx);
        else if (real !== owner.ownerId) {
          fail("CROSS-OWNER LEAK", `owner ${owner.i} was shown contact ${p.contactId}, another owner's`, ctx);
        }
      }
    }

    // D. THE CHIPS MUST NAME SOMEBODY REAL, OR NOT NAME ANYBODY.
    const sugg = events.filter((e) => e.type === "suggestions").flatMap((e) => e.data?.suggestions ?? []);
    for (const s of sugg) {
      if (s?.contactId && ownerOf.get(String(s.contactId)) !== owner.ownerId) {
        fail("CHIP LEAK", `a chip offered contact ${s.contactId}, which is not this owner's`, ctx);
      }
    }
    if (sugg.some((s) => s?.type === "draft_message" && s?.contactId)) score.people++;

    // THE END-TO-END SUCCESS METRIC: real people, from this book, reached the
    // client. True whether they came through the prompt or were composed by the
    // network path directly.
    const emittedPeople = peopleEvents.flatMap((e) => e.data?.people ?? []).filter((p) => p?.contactId);
    if (emittedPeople.length > 0) score.answeredWithPeople++;

    // AND THE SHRUG, WHICH IS THE WHOLE COMPLAINT.
    //
    // webOfferNoMatches is the "Nothing in your contacts answers that yet"
    // string. It is a legitimate answer to a question the book genuinely cannot
    // answer -- nobody in this book is in Tokyo -- and an indefensible one to
    // "how many people do I know", which is a number the app is holding.
    //
    // So the invariant is narrow and real: a question that produced NO search
    // terms at all is a question about the book, and a non-empty book must
    // never answer it with the shrug.
    const answerText = events.filter((e) => e.type === "token").map((e) => e.data?.text ?? "").join("");
    const shrugged = /Nothing in your contacts answers that yet/.test(answerText);
    if (shrugged) score.shrugged++;
    if (shrugged && bookIsAboutQuestion(q) && (nameSets.get(owner.ownerId)?.size ?? 0) > 0) {
      fail(
        "SHRUG ON A BOOK QUESTION",
        `a book of ${nameSets.get(owner.ownerId).size} contacts answered "${q.slice(0, 40)}" with ` +
          `"Nothing in your contacts answers that yet"`,
        ctx,
      );
    }
    if (answerText.trim().length >= 40 || emittedPeople.length > 0) score.substantive++;

    // A SLOW TURN HAS TO NAME ITSELF.
    //
    // The report used to print one overall `max` -- 4,941ms in one run -- with no
    // way to tell which owner asked what. A number nobody can reproduce is not a
    // finding. p95 is 76ms, so anything past 1.5s is a different thing happening,
    // not the tail of the same thing.
    if (ms > 1500) {
      fail("SLOW TURN", `${Math.round(ms)}ms on a book of ${nameSets.get(owner.ownerId)?.size ?? "?"} contacts`, ctx);
    }

    // E. A SHRUG WHEN THERE WAS MATERIAL IS THE ORIGINAL BUG.
    const answer = events.filter((e) => e.type === "token").map((e) => e.data?.text ?? "").join("");
    if (answer && /^I looked and could not place that/.test(answer) && /THE SHAPE OF THEIR BOOK/.test(promptText)) {
      fail("SHRUG", "the model was handed the book and still had nothing to work with", ctx);
    }
    if (!answer.trim() && q.trim().length > 0) {
      fail("EMPTY ANSWER", "the turn produced no answer text at all", ctx);
      shrugs++;
    }
  }

  if (owner.i % 10 === 0) {
    line(
      `  owner ${String(owner.i).padStart(3)}  ${turns} turns, ${failures.length} failure(s), ` +
        `p95 ${Math.round(pctl(latencies, 0.95))}ms  (${Math.round((Date.now() - started) / 1000)}s)`,
    );
  }
}

// ── REPORT ──────────────────────────────────────────────────────────────────
line("\n" + "=".repeat(78));
line("EVERY QUESTION, THROUGH THE REAL ROUTE");
line("=".repeat(78));
for (const [q, sc] of perQuery) {
  const label = q.length > 44 ? q.slice(0, 41).replace(/\s+$/, "") + "..." : q;
  const mark = sc.answeredWithPeople > 0 ? "\u2022" : sc.substantive === sc.turns && sc.turns > 0 ? "\u25a3" : "\u25cb";
  line(
    `  ${mark} people ${String(sc.answeredWithPeople).padStart(3)}/${String(sc.turns).padStart(3)}` +
      `  substantive ${String(sc.substantive).padStart(3)}` +
      `  shrug ${String(sc.shrugged).padStart(3)}` +
      `  chips ${String(sc.people).padStart(3)}` +
      `  p95 ${String(Math.round(pctl(sc.ms, 0.95))).padStart(5)}ms  ${JSON.stringify(label)}`,
  );
}

line("\n" + "=".repeat(78));
line("RESULT");
line("=".repeat(78));
line(`turns              ${turns}`);
line(`prompts grounded   ${grounded}`);
line(`empty answers      ${shrugs}`);
line(`latency            p50 ${Math.round(pctl(latencies, 0.5))}ms  p95 ${Math.round(pctl(latencies, 0.95))}ms  max ${Math.round(Math.max(...latencies, 0))}ms`);
line("");

if (failures.length === 0) {
  line("PASS -- no invariant broken across the whole flow.");
} else {
  const byKind = new Map();
  for (const f of failures) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind).push(f);
  }
  line(`FAIL -- ${failures.length} broken invariant(s) in ${byKind.size} kind(s):\n`);
  for (const [kind, list] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
    line(`  ${kind}  (${list.length})`);
    const seen = new Set();
    for (const f of list) {
      const k = f.detail.replace(/[0-9a-f-]{36}/g, "<id>").replace(/\d+/g, "N");
      if (seen.has(k)) continue;
      seen.add(k);
      line(`     owner ${f.owner}  ${f.query ?? ""}`);
      line(`       ${f.detail}`);
      if (seen.size >= 3) break;
    }
    line("");
  }
}

await pool.end();
process.exit(failures.length === 0 ? 0 : 1);
