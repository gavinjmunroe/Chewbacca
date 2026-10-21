/**
 * POST /v1/me/reports — the route.
 *
 * Two things here are security properties rather than features, and both look
 * identical to a working endpoint if they are wrong:
 *
 *   1. A thread id is an INTEGER somebody can type. Without the participation
 *      check, posting 1, 2, 3... reports strangers to each other and the 404 vs
 *      200 tells the prober which threads exist.
 *   2. The block has to land before the report is filed, or a failed insert
 *      leaves somebody who just said "this person is threatening me" with the
 *      door still open.
 *
 * Run with:  node --test src/routes/reports.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerReportRoutes } from "./reports.js";

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
const PHONE = "+13105550100";

/**
 * The route reaches its collaborators through module imports, so the harness
 * injects a whole store. `order` records the sequence across collaborators,
 * which is the only way to assert that the block preceded the insert.
 */
function buildApp(over = {}) {
  const order = [];
  const calls = { block: [], filed: [], listed: [] };
  const store = {
    resolveAmberIdByPhone: async () => ME,
    threadCounterparty: async () => THEM,
    listMessages: async (...a) => {
      calls.listed.push(a);
      return [
        { id: 3, kind: "text", body: "theirs", createdAt: "t3", mine: false },
        { id: 2, kind: "text", body: "mine", createdAt: "t2", mine: true },
      ];
    },
    setBlock: async (...a) => {
      order.push("block");
      calls.block.push(a);
      return true;
    },
    fileReport: async (...a) => {
      order.push("file");
      calls.filed.push(a);
      return { ok: true, id: "1" };
    },
    ...over.store,
  };
  const app = Fastify({ logger: false });
  registerReportRoutes(app, {
    requireAuth: async (request) => {
      if (over.anonymous) return;
      request.privyUser = { userId: "u1", phone: PHONE };
    },
    store,
  });
  return { app, store, calls, order };
}

const post = (app, payload) => app.inject({ method: "POST", url: "/v1/me/reports", payload });

test("A THREAD THAT IS NOT YOURS IS A 404, and nothing is written", async () => {
  const { app, calls } = buildApp({ store: { threadCounterparty: async () => null } });
  const res = await post(app, { threadId: "5", reason: "harassment" });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(calls.block, [], "blocked somebody on a thread that is not theirs");
  assert.deepEqual(calls.filed, []);
  await app.close();
});

test("THE BLOCK LANDS BEFORE THE REPORT IS FILED", async () => {
  /**
   * If the insert fails, they are still protected. Filing first and blocking
   * second reverses which failure the user is left holding, and it is the worse
   * of the two.
   */
  const { app, order, calls } = buildApp();
  const res = await post(app, { threadId: "5", reason: "threat" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, blocked: true });
  assert.deepEqual(order, ["block", "file"]);
  assert.deepEqual(calls.block[0], [ME, THEM, true]);
  await app.close();
});

test("EVIDENCE IS THEIR HALF OF THE THREAD, and it travels with the report", async () => {
  const { app, calls } = buildApp();
  await post(app, { threadId: "5", reason: "harassment", detail: "read this" });
  const [arg] = calls.filed[0];
  assert.equal(arg.reporterId, ME);
  assert.equal(arg.reportedId, THEM);
  assert.equal(arg.threadId, "5");
  assert.equal(arg.detail, "read this");
  assert.deepEqual(
    arg.evidence.map((m) => m.body),
    ["theirs"],
    "the reporter's own messages were attached as the accused's",
  );
  await app.close();
});

test("a report can be filed WITHOUT a thread, because a profile is content too", async () => {
  // An impersonating name and photo never sends a message. An endpoint that can
  // only report a conversation cannot report that at all.
  const { app, calls } = buildApp();
  const res = await post(app, { amberId: THEM, reason: "impersonation" });
  assert.equal(res.statusCode, 200);
  const [arg] = calls.filed[0];
  assert.equal(arg.threadId, null);
  assert.deepEqual(arg.evidence, []);
  assert.deepEqual(calls.listed, [], "went looking for a thread that was not named");
  await app.close();
});

test("REPORTING BLOCKS UNLESS YOU OPT OUT", async () => {
  const { app, calls } = buildApp();
  await post(app, { threadId: "5", reason: "spam", block: false });
  assert.deepEqual(calls.block, [], "blocked somebody who asked not to");
  assert.equal(calls.filed.length, 1, "and did not file the report either");
  assert.deepEqual((await post(app, { threadId: "5", reason: "spam" })).json(), {
    ok: true,
    blocked: true,
  });
  await app.close();
});

test("a block that fails does not swallow the report", async () => {
  // Two independent writes. Losing the report because the block failed would
  // mean the worst reports -- the ones filed during an outage -- are the ones
  // that vanish.
  const { app, calls } = buildApp({ store: { setBlock: async () => false } });
  const res = await post(app, { threadId: "5", reason: "threat" });
  assert.deepEqual(res.json(), { ok: true, blocked: false });
  assert.equal(calls.filed.length, 1);
  await app.close();
});

test("A REPORT THAT DID NOT LAND SAYS SO", async () => {
  /**
   * The one failure worth admitting. Somebody told "reported" who was not will
   * never report again, and whatever they were reporting keeps happening. The
   * block still stands and the response says which half worked.
   */
  const { app } = buildApp({
    store: { fileReport: async () => ({ ok: false, error: "report_failed" }) },
  });
  const res = await post(app, { threadId: "5", reason: "threat" });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { error: "report_failed", blocked: true });
  await app.close();
});

test("AN UNKNOWN ACCOUNT IS NOT AN ORACLE", async () => {
  // A report against an amber_id that does not exist reads exactly like one that
  // does, or this endpoint becomes a way to test which ids are real.
  const { app } = buildApp({
    store: { fileReport: async () => ({ ok: false, error: "bad_party" }) },
  });
  const res = await post(app, { amberId: THEM, reason: "spam" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, blocked: true });
  await app.close();
});

test("reporting yourself is refused", async () => {
  const { app, calls } = buildApp();
  const res = await post(app, { amberId: ME, reason: "spam" });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "bad_target");
  assert.deepEqual(calls.block, [], "blocked themselves");
  await app.close();
});

test("A REASON THE DATABASE WOULD REFUSE NEVER REACHES IT", async () => {
  // The schema enum and the CHECK in migration 054 hold the same list, sourced
  // from REPORT_REASONS. An invented reason is a 400, not a 500 from Postgres.
  const { app, calls } = buildApp();
  for (const payload of [{}, { reason: "vibes", amberId: THEM }, { reason: "", amberId: THEM }]) {
    const res = await post(app, payload);
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
  }
  assert.deepEqual(calls.filed, []);
  await app.close();
});

test("a target that is neither a thread nor a person is a 400, not a crash", async () => {
  const { app, calls } = buildApp();
  for (const payload of [
    { reason: "spam" },
    { reason: "spam", amberId: "not-a-uuid" },
    // A thread id that is not an integer is not a thread. It must fall through
    // to the person path rather than being handed to threadCounterparty, where
    // Number("abc") is NaN and the store's own guard is the only thing standing.
    { reason: "spam", threadId: "abc" },
  ]) {
    const res = await post(app, payload);
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    assert.equal(res.json().error, "bad_target");
  }
  assert.deepEqual(calls.block, []);
  assert.deepEqual(calls.listed, []);
  await app.close();
});

test("an unauthenticated caller reports nobody", async () => {
  const { app, calls } = buildApp({ anonymous: true });
  const res = await post(app, { amberId: THEM, reason: "spam" });
  assert.equal(res.statusCode, 401);
  /**
   * `no_user`, specifically. Deleting the handler's own auth check still yields
   * a 401 -- an absent phone resolves to no account -- so asserting only the
   * status makes this test unable to notice the check going away. Under the
   * real preHandler an anonymous request never gets this far; this is the
   * second lock, and a second lock nothing tests is a decoration.
   */
  assert.equal(res.json().error, "no_user");
  assert.deepEqual(calls.block, []);
  assert.deepEqual(calls.filed, []);
  await app.close();
});

test("an authenticated phone with no Amber account is a 401, not a null reporter", async () => {
  // A report row whose reporter is null is a report from nobody, and the unique
  // index that collapses duplicates would stop collapsing them.
  const { app, calls } = buildApp({ store: { resolveAmberIdByPhone: async () => null } });
  const res = await post(app, { amberId: THEM, reason: "spam" });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, "no_amber_id");
  assert.deepEqual(calls.filed, []);
  await app.close();
});

test("the detail is capped by the schema before it reaches the store", async () => {
  const { app } = buildApp();
  const res = await post(app, { amberId: THEM, reason: "spam", detail: "z".repeat(4000) });
  assert.equal(res.statusCode, 400);
  await app.close();
});
