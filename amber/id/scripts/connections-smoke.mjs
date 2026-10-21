/**
 * SMOKE TEST — the connections graph, which nothing has ever exercised.
 *
 *     SMOKE_DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch \
 *       node scripts/connections-smoke.mjs
 *
 * connections-store.js was written against (id bigserial, user_a, user_b,
 * created_at, deleted_at). The table is (a_amber_id, b_amber_id, status,
 * established_at) with the PAIR as its primary key -- migration 004 redesigned it
 * and the consumer was never checked. Nine column references across every
 * function, so the whole social graph threw on every call, and each function
 * catches and returns [] or false. A person with connections read as a person
 * with none.
 *
 * areConnected() is the one that matters most: it is the network leg of
 * viewer-reach, so "false" there means shared notes silently do not arrive.
 *
 * So the assertions are about the graph being READ BACK, not about calls
 * returning. A function that swallows its own exception returns successfully from
 * having done nothing.
 */
process.env.IDENTITY_KEY_PEPPER ||= "smoke-only-pepper-not-a-real-secret-0123456789";

import { pool, query, closePool } from "./smoke-db.mjs";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";
import * as C from "../src/db/connections-store.js";

__injectPoolForSmokeTests(pool);

let pass = 0, fail = 0;
const ok = (c, m, d = "") => {
  if (c) { pass++; console.log("  ✓ " + m); }
  else { fail++; console.log("  ✗ " + m + (d ? "   " + d : "")); }
};

// Deliberately NOT in sorted order: A > B as strings, so every insert path has to
// canonicalise rather than trust the order it was handed.
const A = "ffffffff-0000-4000-8000-00000000ca01";
const B = "11111111-0000-4000-8000-00000000cb01";
const D = "22222222-0000-4000-8000-00000000cc01";

await query(`TRUNCATE wall_posts, connections, connection_requests, users
             RESTART IDENTITY CASCADE`);
await query(
  `INSERT INTO users (amber_id, phone, full_name, username) VALUES
     ($1,'+14155552001','Ayesha Khan','ayesha'),
     ($2,'+14155552002','Ben Ortiz','ben'),
     ($3,'+14155552003','Dana Wu','dana')`,
  [A, B, D]);

const pairRows = async () => (await query(
  `SELECT a_amber_id, b_amber_id, status FROM connections ORDER BY a_amber_id`)).rows;

// ── the request round trip ───────────────────────────────────────────────────
console.log("\n── a request, then an accept ──");
const req = await C.createRequest(A, B, "hello");
ok(req?.status === "requested", "A can request B", JSON.stringify(req));
const incoming = await C.listIncomingRequests(B);
ok(incoming.length === 1, "B sees exactly one incoming request", JSON.stringify(incoming.length));
const outgoing = await C.listOutgoingRequests(A);
ok(outgoing.length === 1, "and A sees it outgoing");
ok((await C.listIncomingRequests(A)).length === 0, "A does not see their own as incoming");

const reqId = incoming[0]?.requestId ?? incoming[0]?.id;
const accepted = await C.respondToRequest(B, reqId, "accept");
ok(accepted?.ok === true, "B accepts", JSON.stringify(accepted));
ok(accepted?.requesterAmberId === A,
   "and the requester comes back so the route can notify them");

// ── THE ROW THAT USED TO NEVER APPEAR ───────────────────────────────────────
console.log("\n── the connection exists in the table ──");
const rows = await pairRows();
ok(rows.length === 1, "one row, not two mirrored ones", JSON.stringify(rows));
ok(rows[0].a_amber_id < rows[0].b_amber_id,
   "canonically ordered, which the CHECK enforces rather than the caller",
   JSON.stringify([rows[0].a_amber_id, rows[0].b_amber_id]));
ok(rows[0].status === "active",
   "and ACTIVE — 'pending' is the column default, and an accepted request is not pending",
   rows[0].status);

// ── the predicate the rest of the system authorizes against ─────────────────
console.log("\n── areConnected, which gates the network share leg ──");
ok((await C.areConnected(A, B)) === true, "A and B are connected");
ok((await C.areConnected(B, A)) === true, "in both directions, whatever the argument order");
ok((await C.areConnected(A, D)) === false, "A and D are not");
ok((await C.areConnected(A, A)) === false, "and nobody is connected to themselves");

// ── the lists ───────────────────────────────────────────────────────────────
console.log("\n── the list each side sees ──");
const listA = await C.listConnections(A);
ok(listA.length === 1, "A has one connection", JSON.stringify(listA.length));
ok(listA[0].user.amberId === B, "and it is B, not A", JSON.stringify(listA[0].user));
ok(listA[0].connectedAt != null,
   "with the timestamp — established_at, since created_at never existed",
   String(listA[0].connectedAt));
ok(typeof listA[0].connectionId === "string" && listA[0].connectionId.includes(":"),
   "and an id synthesised from the pair, because the table has no surrogate",
   listA[0].connectionId);
ok((await C.listConnections(D)).length === 0, "D has none");

// ── status shows up in search ────────────────────────────────────────────────
console.log("\n── search reports the relationship ──");
const found = await C.searchUsers(A, "ben");
ok(found.length >= 1, "A can find B", JSON.stringify(found.map((f) => f.username)));
ok(found.find((f) => f.amberId === B)?.status === "connected",
   "and sees them as connected — this is the conn.id IS NOT NULL branch that "
   + "referenced a column the table does not have",
   JSON.stringify(found.find((f) => f.amberId === B)));
const strangers = await C.searchUsers(A, "dana");
ok(strangers.find((f) => f.amberId === D)?.status === "none",
   "a stranger reports none", JSON.stringify(strangers.find((f) => f.amberId === D)));
ok(!found.some((f) => f.amberId === A), "and search never returns the caller");

// ── the reverse-request shortcut ─────────────────────────────────────────────
console.log("\n── a crossing request connects immediately ──");
await C.createRequest(D, A, null);
const cross = await C.createRequest(A, D, null);
ok(cross?.status === "connected",
   "A requesting D, who already requested A, connects them straight away",
   JSON.stringify(cross));
ok((await C.areConnected(A, D)) === true, "and they really are connected");
const twoRows = await pairRows();
ok(twoRows.length === 2, "two connections now", String(twoRows.length));
ok(twoRows.every((r) => r.a_amber_id < r.b_amber_id),
   "both canonically ordered — A sorts after both B and D, so a naive insert "
   + "would have violated the CHECK");

// ── idempotence ─────────────────────────────────────────────────────────────
console.log("\n── connecting twice is not two connections ──");
await query(
  `INSERT INTO connections (a_amber_id, b_amber_id, status)
   VALUES (LEAST($1::uuid,$2::uuid), GREATEST($1::uuid,$2::uuid), 'active')
   ON CONFLICT (a_amber_id, b_amber_id) DO UPDATE SET status = 'active'`, [B, A]);
ok((await pairRows()).length === 2, "the pair primary key holds", String((await pairRows()).length));

// ── a retired connection ────────────────────────────────────────────────────
console.log("\n── status is what 'not deleted' means now ──");
await query(`UPDATE connections SET status = 'blocked'
              WHERE a_amber_id = LEAST($1::uuid,$2::uuid) AND b_amber_id = GREATEST($1::uuid,$2::uuid)`, [A, B]);
ok((await C.areConnected(A, B)) === false, "a blocked pair is not connected");
ok((await C.listConnections(A)).length === 1,
   "and drops out of the list, leaving only the other one",
   JSON.stringify((await C.listConnections(A)).map((c) => c.user.amberId)));
ok((await C.searchUsers(A, "ben")).find((f) => f.amberId === B)?.status !== "connected",
   "and search stops calling them connected");

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await closePool();
process.exit(fail ? 1 : 0);
