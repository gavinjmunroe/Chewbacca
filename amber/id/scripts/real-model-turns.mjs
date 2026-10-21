/**
 * THIRTY REAL TURNS, WITH A LIVE MODEL, AND EVERY REPLY KEPT FOR READING.
 *
 * Everything up to now proved the app hands the model the right material. It
 * could not prove the model writes a good answer from it, because the model was
 * a stand-in that I wrote, and a stand-in I wrote will always look competent
 * to me.
 *
 * So this is the same real route -- real auth, real intent routing (live
 * Haiku), real retrieval against real Postgres, real SSE, real chip generation
 * (live model) -- with the REAL streaming completion. The only stand-ins left
 * are the two paid services that are not the model: Exa and the place search.
 * The Togari ranker is stood down deliberately, so the retrieval ladder is what
 * has to carry the answer; that is the path that was broken and the path a user
 * hits when the ranker is slow.
 *
 * IT ASSERTS ALMOST NOTHING. That is the point. The failure mode being hunted
 * here is "technically correct, reads like garbage", and no assertion catches
 * that. It writes every reply to disk, in full, with the intent the router
 * chose, the people the client received and the chips it was offered, so the
 * replies can be read one by one.
 *
 * The few things it does check are the ones that are objective: a person named
 * in an answer who is not in that owner's book is a hallucination, an answer
 * shorter than a sentence on a book with matches is a shrug, and a turn that
 * never reaches `complete` is a spinner.
 *
 *   ANTHROPIC_API_KEY=... IDENTITY_KEY_PEPPER=... node scripts/real-model-turns.mjs
 */
import fs from "node:fs";
import pg from "pg";
import Fastify from "fastify";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";

if (!process.env.IDENTITY_KEY_PEPPER) {
  console.error("Set IDENTITY_KEY_PEPPER (any 32+ chars).");
  process.exit(2);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY. This script exists to use the real model.");
  process.exit(2);
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
const { loadContactsByOwnerId } = await import("../src/db/store.js");

// THE ROUTE'S OWN CLIENT, NOT THE ONE IN lib/anthropic-chat.js.
//
// The first version of this file imported the lib client, and 7 of 30 turns came
// back empty with `system.0.text: Input should be a valid string`. That was this
// harness, not the app: the route builds its system prompt as an array of
// cacheable blocks and normalizes it through toSystemParam, while the lib client
// takes a plain string and wraps whatever it is given in one block -- so the
// array landed in `text` and the API rejected it. Every production caller of the
// lib client passes a joined string, so nothing real is affected. Wrapping the
// route's own export keeps the prompt visible without changing the path.
const { streamChat: realStreamChat } = await import("../src/routes/chat.js");

const line = (...a) => process.stdout.write(a.join(" ") + "\n");
const OUT = process.env.REAL_OUT || "/tmp/real-turns.json";

// ── the two paid services that are not the model ────────────────────────────
const standInExaSearch = async (q) => [
  { title: `Result for ${String(q).slice(0, 40)}`, url: "https://example.com/a", text: "A page about the thing asked for. ".repeat(12) },
  { title: "Second result", url: "https://example.com/b", text: "Another page, different angle on the same question. ".repeat(12) },
];
const standInExaContents = async (urls = []) =>
  (Array.isArray(urls) ? urls : []).slice(0, 5).map((u) => ({
    url: String(u), title: "Fetched page",
    text: "The full text of the page, long enough to count as a real read. ".repeat(20),
  }));
const standInExaFindPeople = async () => [
  { name: "Ada Byron", title: "VP Engineering", company: "Acme Hardware", url: "https://linkedin.com/in/ada-byron" },
  { name: "Grace Hopper", title: "VP of Engineering", company: "Naval Systems", url: "https://linkedin.com/in/grace-hopper" },
];
const standInFindPlaces = async () => [
  { name: "Abraço", category: "Coffee", url: "https://abraco.nyc", address: "86 E 7th St, New York" },
  { name: "Ruby's", category: "Cafe", url: "https://rubys.example", address: "219 Mulberry St, New York" },
];

// ── the app, with the REAL model ────────────────────────────────────────────
function buildApp(owner, record) {
  const app = Fastify({ logger: false });
  registerChatRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = { userId: `did:real:${owner.label}`, phone: owner.phone };
    },
    resolveAmberIdByPhone: async () => owner.ownerId,
    listContacts: async () => (await loadContactsByOwnerId(owner.ownerId)) ?? [],
    getProfile: async () => ({ displayName: owner.displayName, currentCity: owner.city }),
    // classifyIntent, generateSuggestions: LEFT REAL. Both call the model.
    streamChat: async (args) => {
      const system = Array.isArray(args?.system)
        ? args.system.map((b) => (typeof b === "string" ? b : b?.text || "")).join("\n")
        : String(args?.system || "");
      record.prompts.push(system);
      const t = Date.now();
      const out = await realStreamChat(args);
      record.modelCalls.push({ ms: Date.now() - t, chars: (out || "").length, nulled: out == null });
      return out;
    },
    exaSearch: standInExaSearch,
    exaContents: standInExaContents,
    exaFindPeople: standInExaFindPeople,
    findPlaces: standInFindPlaces,
    streamViaTogariSearch: async function* () {},
    rankViaTogariSearch: async () => null,
    appendMessage: async () => {},
    listConversation: async () => [],
    listRecentConversations: async () => [],
  });
  return app;
}

/**
 * TIME TO FIRST TOKEN, MEASURED THE WAY THE USER EXPERIENCES IT.
 *
 * `app.inject` buffers the whole response, so it can only ever report the moment
 * the LAST byte was ready -- which is the number that made the old fixed-string
 * branch look fast. It was not fast: it spent three to four seconds in the intent
 * router, the ranker race and dimension retrieval, and then delivered the entire
 * sentence at once. A streamed answer spends the same three seconds and then
 * starts drawing.
 *
 * So the turn goes over a real socket and the clock is read at the first `token`
 * frame. That is the number the person holding the phone actually feels.
 */
async function askOverHttp(app, message) {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address();
  const t0 = Date.now();
  let firstToken = null;
  let body = "";
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!res.body) return { statusCode: res.status, body: "", ttft: null, total: Date.now() - t0 };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      body += chunk;
      if (firstToken == null && /event: token/.test(body)) firstToken = Date.now() - t0;
    }
    return { statusCode: res.status, body, ttft: firstToken, total: Date.now() - t0 };
  } finally {
    await app.close();
  }
}

const parseSse = (body) => {
  const out = [];
  for (const frame of String(body).split("\n\n")) {
    const lines = frame.split("\n");
    const t = lines.find((l) => l.startsWith("event: "));
    const d = lines.find((l) => l.startsWith("data: "));
    if (!t || !d) continue;
    try { out.push({ type: t.slice(7).trim(), data: JSON.parse(d.slice(6)) }); }
    catch { out.push({ type: t.slice(7).trim(), data: null }); }
  }
  return out;
};

// ── who is asking ───────────────────────────────────────────────────────────
const pick = async (n) => {
  const r = await pool.query(
    `WITH c AS (SELECT owner_id, count(*) n FROM contacts WHERE deleted_at IS NULL GROUP BY 1)
     SELECT u.amber_id, u.phone, u.full_name, coalesce(c.n,0)::int AS n
       FROM users u LEFT JOIN c ON c.owner_id = u.amber_id
      WHERE coalesce(c.n,0) = (SELECT max(coalesce(c2.n,0)) FROM users u2 LEFT JOIN c c2 ON c2.owner_id = u2.amber_id
                                WHERE coalesce(c2.n,0) <= $1)
      LIMIT 1`, [n],
  );
  const row = r.rows[0];
  return { ownerId: String(row.amber_id), phone: row.phone, n: row.n, displayName: row.full_name };
};

const BIG = { ...(await pick(99999)), label: "big", city: "New York" };
const MID = { ...(await pick(800)), label: "mid", city: "Los Angeles" };
const SML = { ...(await pick(520)), label: "small", city: "Austin" };
const THIN = { ...(await pick(2)), label: "thin", city: "Chicago" };

// A BRAND-NEW USER, created here, with an empty book. The single most common
// first-run state and the one that has to feel right.
const NEWPHONE = "+15550909090";
await pool.query(`DELETE FROM users WHERE phone = $1`, [NEWPHONE]);
const nu = await pool.query(
  `INSERT INTO users (phone, full_name, status) VALUES ($1, 'Brand New', 'active') RETURNING amber_id`, [NEWPHONE],
);
const EMPTY = { ownerId: String(nu.rows[0].amber_id), phone: NEWPHONE, n: 0, label: "empty", displayName: "Brand New", city: "Seattle" };

// ── the thirty turns ────────────────────────────────────────────────────────
// Real questions, of the kind a tester types. Not syntax attacks -- those have
// their own suite. This one is entirely about whether the answer is any good.
const PLAN = [
  [BIG, "who do I know in New York"],
  [BIG, "tell me about my network"],
  [BIG, "who do I know that works in tech"],
  [BIG, "I'm going to be in LA next week, who should I see"],
  [BIG, "who are the founders I know"],
  [BIG, "whose birthday is coming up"],
  [BIG, "who do I know at Google"],
  [BIG, "I need an intro to someone in healthcare, who's my best path"],
  [BIG, "find me VPs of engineering in New York and tell me who I already know there"],
  [BIG, "who have I not talked to in a while that I should reconnect with"],

  [MID, "who do I know in tech"],
  [MID, "any doctors in my contacts"],
  [MID, "who do I know that went to USC"],
  [MID, "recommend a coffee shop near Union Square and tell me who I could bring"],
  [MID, "what do you know about my network"],
  [MID, "who works in finance"],
  [MID, "draft an intro between two people I know who should meet"],

  [SML, "who do I know in Austin"],
  [SML, "tell me about my contacts"],
  [SML, "anyone in marketing"],
  [SML, "who should I follow up with this week"],
  [SML, "do I know any lawyers"],
  [SML, "who is the most connected person in my network"],

  [THIN, "who do I know in New York"],
  [THIN, "tell me about my network"],
  [THIN, "can you help me find people in tech"],
  [THIN, "what can you do"],

  [EMPTY, "who do I know in New York"],
  [EMPTY, "tell me about my network"],
  [EMPTY, "what can you do"],
];

// ── every live contact, so a named person can be checked ────────────────────
const nameRows = await pool.query(
  `SELECT owner_id, id, full_name FROM contacts WHERE deleted_at IS NULL AND owner_id = ANY($1::uuid[])`,
  [[BIG.ownerId, MID.ownerId, SML.ownerId, THIN.ownerId, EMPTY.ownerId]],
);
const ownerOf = new Map(nameRows.rows.map((r) => [String(r.id), String(r.owner_id)]));
const namesByOwner = new Map();
for (const r of nameRows.rows) {
  if (!namesByOwner.has(String(r.owner_id))) namesByOwner.set(String(r.owner_id), new Set());
  namesByOwner.get(String(r.owner_id)).add(String(r.full_name || "").trim());
}

line("=".repeat(78));
line("THIRTY REAL TURNS AGAINST A LIVE MODEL");
line("=".repeat(78));
for (const o of [BIG, MID, SML, THIN, EMPTY]) line(`  ${o.label.padEnd(6)} ${o.displayName.padEnd(12)} ${String(o.n).padStart(5)} contacts`);
line("");

const results = [];
const problems = [];
const flag = (kind, detail, i) => problems.push({ kind, detail, turn: i });

for (let i = 0; i < PLAN.length; i++) {
  const [owner, q] = PLAN[i];
  const record = { prompts: [], modelCalls: [] };
  const app = buildApp(owner, record);
  let res;
  try {
    res = await askOverHttp(app, q);
  } catch (err) {
    flag("REQUEST THREW", String(err?.message ?? err), i);
    continue;
  }
  const ms = res.total;
  const ttft = res.ttft;
  const events = parseSse(res.body);
  const types = events.map((e) => e.type);
  const text = events.filter((e) => e.type === "token").map((e) => e.data?.token ?? e.data?.text ?? "").join("")
    || events.filter((e) => e.type === "message").map((e) => e.data?.content ?? "").join("");
  const people = events.filter((e) => e.type === "people").flatMap((e) => e.data?.people ?? []);
  const chips = events.filter((e) => e.type === "suggestions").flatMap((e) => e.data?.suggestions ?? []);
  const meta = events.find((e) => e.type === "meta")?.data ?? null;

  results.push({
    i, owner: owner.label, book: owner.n, q, ms, ttft, status: res.statusCode,
    intent: meta?.intent ?? null, eventTypes: types,
    answer: text, people: people.map((p) => ({ id: p.contactId, name: p.name, why: p.reason ?? p.why ?? null })),
    chips: chips.map((c) => ({ type: c.type, label: c.label, contactId: c.contactId ?? null })),
    modelCalls: record.modelCalls,
    promptChars: record.prompts.reduce((a, p) => a + p.length, 0),
  });

  // The objective checks.
  if (res.statusCode !== 200) flag("HTTP", `status ${res.statusCode}`, i);
  else {
    if (types.at(-1) !== "complete") flag("NO COMPLETE", `ended on "${types.at(-1)}"`, i);
    for (const p of people) {
      if (p?.contactId && ownerOf.get(String(p.contactId)) !== owner.ownerId) {
        flag("CROSS-OWNER LEAK", `contact ${p.contactId} is not ${owner.label}'s`, i);
      }
    }
    for (const c of chips) {
      if (c?.contactId && ownerOf.get(String(c.contactId)) !== owner.ownerId) {
        flag("CHIP LEAK", `chip offered contact ${c.contactId}`, i);
      }
    }
    if (owner.n > 0 && text.trim().length < 40) {
      flag("SHRUG", `${text.trim().length} chars back on a book of ${owner.n}: ${JSON.stringify(text.slice(0, 80))}`, i);
    }
    if (record.modelCalls.some((c) => c.nulled)) flag("MODEL RETURNED NULL", "the live completion failed and fell back", i);
    // A name in the answer that is a capitalised full name and belongs to
    // nobody in this owner's book is either a web result or an invention. Only
    // flagged for the pure network questions, where there is no web material.
    if (/^(who|any|do i|tell me about my|anyone)/i.test(q) && !/find me|recommend|search/i.test(q)) {
      const known = namesByOwner.get(owner.ownerId) ?? new Set();
      const firstNames = new Set([...known].map((n) => n.split(/\s+/)[0]));
      for (const m of text.matchAll(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g)) {
        const cand = m[1];
        if (known.has(cand)) continue;
        if (firstNames.has(cand.split(" ")[0])) continue;
        if (/^(New York|Los Angeles|San Francisco|United States|Union Square|Add Note|Draft Message)$/.test(cand)) continue;
        flag("POSSIBLE INVENTION", `answer names "${cand}", not in ${owner.label}'s book`, i);
      }
    }
  }

  line(
    `  ${String(i).padStart(2)} ${owner.label.padEnd(6)} ${JSON.stringify(q).slice(0, 52).padEnd(54)}` +
      ` ttft=${String(ttft ?? "-").padStart(6)} total=${String(ms).padStart(6)}ms` +
      ` ${String(text.length).padStart(5)}ch  ${people.length}p ${chips.length}c`,
  );
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
line(`\n  full replies written to ${OUT}`);

line("\n" + "=".repeat(78));
line("OBJECTIVE PROBLEMS");
line("=".repeat(78));
if (problems.length === 0) line("  none -- which says nothing about whether the answers read well. Read them.");
else for (const p of problems) line(`  turn ${p.turn}  ${p.kind}\n      ${p.detail}`);

await pool.end();
process.exit(0);
