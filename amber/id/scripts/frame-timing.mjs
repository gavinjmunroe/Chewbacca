/**
 * WHEN DOES EACH FRAME ACTUALLY ARRIVE?
 *
 * Total turn time is the wrong number to optimize, and time-to-first-token is
 * only half the story. What a person feels is: when did the answer finish, and
 * how much longer did the turn keep them waiting after that. This timestamps
 * every SSE frame so the gap between the LAST TOKEN and `complete` is visible as
 * its own number -- that gap is dead time, spent on work the reader cannot see.
 */
import pg from "pg";
import Fastify from "fastify";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";
import { buildBook, CAST } from "./gauntlet-book.mjs";

const pool = new pg.Pool({ host: "/tmp", port: 5433, user: "postgres", database: "fleet", max: 8 });
__injectPoolForSmokeTests(pool);
const { registerChatRoutes } = await import("../src/routes/chat.js");
const { loadContactsByOwnerId, upsertContactsForOwner } = await import("../src/db/store.js");
const { storeAppleCardDetails, retagAddressBook } = await import("../src/db/address-book-store.js");
const { normalizeIncomingContact } = await import("../src/routes/profile.js");

const line = (...a) => process.stdout.write(a.join(" ") + "\n");

async function owner(label, size, seed) {
  const phone = `+1555${String(seed).padStart(7, "0")}`;
  const existing = await pool.query(`SELECT amber_id FROM users WHERE phone=$1`, [phone]);
  if (existing.rowCount > 0) {
    const id = String(existing.rows[0].amber_id);
    const n = (await pool.query(`SELECT count(*)::int n FROM contacts WHERE owner_id=$1 AND deleted_at IS NULL`, [id])).rows[0].n;
    if (n > 0) return { ownerId: id, phone, label, n };
  }
  await pool.query(`DELETE FROM users WHERE phone=$1`, [phone]);
  const u = await pool.query(`INSERT INTO users (phone, full_name, status) VALUES ($1,$2,'active') RETURNING amber_id`, [phone, `Timing ${label}`]);
  const ownerId = String(u.rows[0].amber_id);
  const contacts = [...CAST, ...buildBook(size, seed)].map(normalizeIncomingContact).filter(Boolean);
  for (let i = 0; i < contacts.length; i += 200) {
    const batch = contacts.slice(i, i + 200);
    await upsertContactsForOwner({ ownerId, ownerPhone: phone, contacts: batch, mode: "three_way" });
    await storeAppleCardDetails(ownerId, batch);
  }
  await retagAddressBook(ownerId);
  const n = (await pool.query(`SELECT count(*)::int n FROM contacts WHERE owner_id=$1 AND deleted_at IS NULL`, [ownerId])).rows[0].n;
  return { ownerId, phone, label, n };
}

const stand = {
  exaSearch: async () => Array.from({ length: 5 }, (_, i) => ({ url: `https://example.com/${i}`, title: `R${i}`, text: "page text ".repeat(40) })),
  exaContents: async (u = []) => u.slice(0, 5).map((x) => ({ url: String(x), title: "p", text: "text ".repeat(80) })),
  exaFindPeople: async () => [{ name: "Wren Halloway", title: "Partner", company: "Northlight Capital", url: "https://linkedin.com/in/wren" }],
  findPlaces: async () => [{ name: "Abraço", category: "Coffee", address: "86 E 7th St, New York" }],
};

function app(o) {
  const a = Fastify({ logger: false });
  registerChatRoutes(a, {
    requireAuth: async (r) => { r.privyUser = { userId: `did:t:${o.label}`, phone: o.phone }; },
    resolveAmberIdByPhone: async () => o.ownerId,
    listContacts: async () => (await loadContactsByOwnerId(o.ownerId)) ?? [],
    getProfile: async () => ({ displayName: `Timing ${o.label}`, currentCity: "New York" }),
    ...stand,
    streamViaTogariSearch: async function* () {},
    rankViaTogariSearch: async () => null,
  });
  return a;
}

async function run(o, message) {
  const a = app(o);
  await a.listen({ port: 0, host: "127.0.0.1" });
  const { port } = a.server.address();
  const t0 = Date.now();
  const frames = [];
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const t = frame.split("\n").find((l) => l.startsWith("event: "));
        if (t) frames.push({ type: t.slice(7).trim(), at: Date.now() - t0 });
      }
    }
  } finally {
    await a.close();
  }
  const tokens = frames.filter((f) => f.type === "token");
  const complete = frames.find((f) => f.type === "complete");
  const firstToken = tokens[0]?.at ?? null;
  const lastToken = tokens.at(-1)?.at ?? null;
  const gap = complete && lastToken != null ? complete.at - lastToken : null;
  const nonToken = frames.filter((f) => f.type !== "token");
  return { firstToken, lastToken, complete: complete?.at ?? null, gap, tokens: tokens.length, order: nonToken.map((f) => `${f.type}@${f.at}`) };
}

const O = await owner("heavy", 900, 41);
line(`owner: ${O.n} contacts\n`);

const CASES = [
  ["short people question", "who do I know in New York"],
  ["long braindump with 4 asks", "Danielle Kwon told me she is leaving Cravath in November to be GC at Corvid Health, and her daughter started at Brown. Marcus O'Dell left Sequoia to raise his own fund and wants operators inside hospital systems. Who fits that? Also find me a wine bar in Nolita for six people, tell me who in New York I could invite, and look up what Corvid Health actually is."],
  ["pure chat, nothing to capture", "what is the difference between a staff engineer and a principal engineer"],
];

for (const [label, msg] of CASES) {
  const r = await run(O, msg);
  line(`${label}`);
  line(`  chars=${msg.length}  firstToken=${r.firstToken}ms  lastToken=${r.lastToken}ms  complete=${r.complete}ms`);
  line(`  DEAD TIME AFTER THE ANSWER FINISHED: ${r.gap}ms`);
  line(`  frames: ${r.order.join("  ")}\n`);
}
await pool.end();
process.exit(0);
