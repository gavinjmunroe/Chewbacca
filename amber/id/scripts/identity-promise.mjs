/**
 * IF AMBER OFFERS TO DO SOMETHING, DOES THE NEXT TURN DO IT?
 *
 * Asked "what's the weather", Amber answers "Current conditions depend on where
 * you are. Where should I check?" -- on both a full book and an empty one, and
 * not deterministically. That reply is either fine or a lie, and which one it is
 * depends entirely on what happens when the person answers "New York". Nothing
 * in the identity suite could tell the difference, because every check there
 * looks at one turn in isolation.
 *
 * A one-turn check cannot catch a broken promise. This one asks, answers the
 * question Amber asked, and reads the second reply.
 *
 *   ANTHROPIC_API_KEY=... IDENTITY_KEY_PEPPER=... node scripts/identity-promise.mjs
 */
import pg from "pg";
import Fastify from "fastify";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";

if (!process.env.IDENTITY_KEY_PEPPER || !process.env.ANTHROPIC_API_KEY) {
  console.error("Set IDENTITY_KEY_PEPPER (32+ chars) and ANTHROPIC_API_KEY.");
  process.exit(2);
}

const pool = new pg.Pool({
  host: process.env.SMOKE_PGHOST || "/tmp",
  port: Number(process.env.SMOKE_PGPORT || 5433),
  user: "postgres",
  database: "fleet",
  max: 4,
});
__injectPoolForSmokeTests(pool);

const { registerChatRoutes, streamChat: realStreamChat } = await import("../src/routes/chat.js");
const { loadContactsByOwnerId } = await import("../src/db/store.js");

const line = (...a) => process.stdout.write(a.join(" ") + "\n");

/**
 * A REAL WEB SEARCH, STOOD IN FOR, BUT HONESTLY.
 *
 * Exa is a paid service and this script is not the place to spend on it, so the
 * stand-in returns what a weather query really would: a page with the
 * conditions in it. The point of the check is whether the app ROUTES there and
 * uses what comes back, not whether Exa works.
 */
let exaCalls = [];
/**
 * exaSearch takes an OPTIONS OBJECT, not a string.
 *
 * The first version of this logged `String(q)` and printed `web searched for
 * "[object Object]"`, which looked exactly like the app passing a stringified
 * object into a real search -- an alarming and completely fictional bug of my
 * own making. Log the query FIELD.
 */
const standInExaSearch = async (opts) => {
  exaCalls.push(typeof opts === "string" ? opts : (opts?.query ?? JSON.stringify(opts)));
  return [
    {
      title: "New York, NY Weather",
      url: "https://example.com/weather/nyc",
      text: "New York City current conditions: 71F, partly cloudy, wind 8 mph from the northwest. Tonight 60F. Tomorrow high 74F with scattered showers in the afternoon.",
    },
  ];
};

/**
 * A REAL CONVERSATION STORE, IN MEMORY.
 *
 * THE MISTAKE THIS REPLACES, and it is the second time I have made it. The route
 * does NOT read history from the request body -- it calls
 * listConversation(amberId, conversationId) and persists each turn with
 * appendMessage. Stubbing both to no-ops, which is what the other harnesses do
 * because they only ever send one turn, means turn two arrives with NO history
 * at all.
 *
 * That produced a spectacular fake bug: "what's the weather" -> "where are
 * you?" -> "New York" -> a list of the user's New York contacts. It looked like
 * the router losing the thread on a one-word follow-up. It was the harness
 * throwing the thread away before the router ever saw it. A multi-turn check
 * with a stubbed store cannot find anything; it can only invent things.
 */
function makeStore() {
  const rows = [];
  return {
    appendMessage: async (_ownerId, { conversationId, role, content, metadata }) => {
      const row = { id: `m${rows.length + 1}`, conversationId, role, content, metadata, createdAt: new Date() };
      rows.push(row);
      return row;
    },
    listConversation: async (_ownerId, conversationId, { limit = 50 } = {}) =>
      rows.filter((r) => r.conversationId === conversationId).slice(-limit),
    rows,
  };
}

function buildApp(owner, store) {
  const app = Fastify({ logger: false });
  registerChatRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = { userId: `did:promise:${owner.label}`, phone: owner.phone };
    },
    resolveAmberIdByPhone: async () => owner.ownerId,
    listContacts: async () => (await loadContactsByOwnerId(owner.ownerId)) ?? [],
    getProfile: async () => ({ displayName: owner.displayName, currentCity: owner.city }),
    streamChat: realStreamChat,
    exaSearch: standInExaSearch,
    exaContents: async (urls = []) =>
      (Array.isArray(urls) ? urls : []).map((u) => ({
        url: String(u),
        title: "New York, NY Weather",
        text: "New York City current conditions: 71F, partly cloudy, wind 8 mph from the northwest.",
      })),
    exaFindPeople: async () => [],
    findPlaces: async () => [],
    streamViaTogariSearch: async function* () {},
    rankViaTogariSearch: async () => null,
    appendMessage: store.appendMessage,
    listConversation: store.listConversation,
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
    try { out.push({ type: t.slice(7).trim(), data: JSON.parse(d.slice(6)) }); }
    catch { out.push({ type: t.slice(7).trim(), data: null }); }
  }
  return out;
};

/** A conversation, not a turn: history is threaded back in the way the client does. */
async function converse(owner, turns) {
  const store = makeStore();
  const app = buildApp(owner, store);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address();
  const conversationId = `promise-${owner.label}-${Date.now()}`;
  const said = [];
  try {
    for (const message of turns) {
      const t0 = Date.now();
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // NO `history` FIELD. The route reads history from listConversation,
        // not from the body; sending it here would only hide a store that is
        // not working.
        body: JSON.stringify({ message, conversationId }),
      });
      const body = await res.text();
      const frames = parseSse(body);
      const answer = frames.filter((f) => f.type === "token").map((f) => f.data?.text ?? f.data ?? "").join("")
        || frames.find((f) => f.type === "message")?.data?.text || "";
      said.push({ role: "user", content: message });
      said.push({ role: "assistant", content: answer });
      line(`  > ${message}`);
      line(`  ${answer.replace(/\s+/g, " ")}`);
      line(`  (${Date.now() - t0}ms, intent ${frames.find((f) => f.type === "complete")?.data?.intent ?? "?"}, ${store.rows.length} rows persisted)`);
      line("");
    }
  } finally {
    await app.close();
  }
  // THE STORE HAS TO HAVE WORKED, or every multi-turn finding below is fiction.
  // One user row and one assistant row per turn is the floor.
  if (store.rows.length < turns.length * 2) {
    throw new Error(
      `the conversation store holds ${store.rows.length} rows after ${turns.length} turns; ` +
      `turn two had no history and nothing measured here means anything`,
    );
  }
  return said;
}

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

const BIG = { ...(await pick(99999)), label: "full", city: "New York" };

const failures = [];

line("=".repeat(78));
line("A PROMISE MADE IN ONE TURN, CHECKED IN THE NEXT");
line("=".repeat(78));
line("");

/**
 * The three shapes of promise. Each is a thing Amber offered unprompted in the
 * identity run, so each is a promise a real user would hold it to.
 */
const CASES = [
  {
    name: "weather: asks where, then is told where",
    turns: ["what's the weather", "New York"],
    check: (said) => {
      const second = said[3]?.content || "";
      // It must either give conditions or say plainly that it does not do this.
      const gave = /\b\d{1,3}\s*(?:F|degrees|°)|\b(?:sunny|cloudy|rain|showers|clear|overcast|snow|partly)\b/i.test(second);
      const declined = /\b(?:can'?t|cannot|do not|don'?t|not something I|outside)\b/i.test(second);
      if (!gave && !declined) {
        return "asked for a city, was given one, and then neither gave the weather nor said it does not do weather";
      }
      if (!gave && declined) {
        return "asked \"where should I check\" and then declined -- the offer in the first turn was empty";
      }
      return null;
    },
  },
  {
    name: "sync: offers to turn it on, is asked how",
    turns: ["what are you", "how do I sync my contacts"],
    check: (said) => {
      const second = said[3]?.content || "";
      if (second.trim().length < 40) return "no real answer to how to sync";
      /**
       * INVENTED UI. The first run answered with a three-platform walkthrough --
       * "On iPhone: open Settings, tap your name, tap iCloud..." and, worse,
       * "Inside the Amber app: go to Settings, look for a Contacts or Sync
       * option". Amber has no idea what its own settings screen looks like; a
       * person following that lands nowhere and concludes the app is broken.
       *
       * The first version of this check only looked for a `Settings > A > B`
       * arrow path, so a bulleted walkthrough sailed through. Catch the shape,
       * not one notation for it.
       */
      if (/\b(?:Look for|look for)\b[^.]{0,40}\b(?:option|setting|toggle|button)\b/.test(second)) {
        return "guessed at Amber's own UI (\"look for a ... option\")";
      }
      const steps = (second.match(/^\s*[-*\d]+[.)]?\s+(?:Open|Tap|Go to|Select|Make sure|Choose|Scroll|Toggle|Enable)\b/gim) || []).length;
      if (steps >= 3) return `invented a ${steps}-step walkthrough of a UI it cannot see`;
      // AND IT MUST NOT CONTRADICT WHAT IT KNOWS. This answer said "2,897
      // contacts already in your book" and "once the connection is live" in the
      // same paragraph.
      if (/\b(?:once|after)\b[^.]{0,40}\b(?:connection is live|synced|sync(?:ing)? (?:is|completes))\b/i.test(second)
        && /\b[\d,]{3,}\s+contacts\b/i.test(second)) {
        return "said the sync is not done yet in the same breath as counting the contacts it already has";
      }
      return null;
    },
  },
  {
    name: "draft: offers to write, is asked to send",
    turns: ["draft a short note to a friend saying I'll be in Chicago next week", "great, send it"],
    check: (said) => {
      const second = said[3]?.content || "";
      if (/\b(?:I(?:'ve| have)?\s+sent|sending it|it'?s on its way|sent it|I'?ll send)\b/i.test(second)) {
        return "claimed it sent the message";
      }
      if (!/\b(?:you|yourself|copy|paste|from your)\b/i.test(second)) {
        return "did not say who actually sends it";
      }
      return null;
    },
  },
];

for (const c of CASES) {
  line("─".repeat(78));
  line(c.name);
  line("─".repeat(78));
  exaCalls = [];
  let said;
  try {
    said = await converse(BIG, c.turns);
  } catch (err) {
    failures.push(`${c.name}: THREW ${err.message}`);
    continue;
  }
  const problem = c.check(said);
  if (problem) failures.push(`${c.name}: ${problem}\n      ${(said[3]?.content || "").replace(/\s+/g, " ").slice(0, 260)}`);
  if (exaCalls.length) line(`  (web searched for: ${exaCalls.map((q) => JSON.stringify(q)).join(", ")})`);
  line("");
}

line("=".repeat(78));
if (failures.length === 0) line("NO BROKEN PROMISES.");
else {
  line(`${failures.length} BROKEN PROMISE(S):`);
  for (const f of failures) line("  - " + f);
}
line("=".repeat(78));

await pool.end();
process.exit(failures.length ? 1 : 0);
