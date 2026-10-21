/**
 * /v1/me/imessage-link — the arm/disarm switch behind the webhook gate.
 *
 * The store is injected, so what is pinned here is the route's contract, and
 * the contract has exactly one thing in it worth losing sleep over: WHICH PHONE
 * GETS ARMED. Every other property of this file is ordinary CRUD. If a caller
 * can name the number, the webhook gate is not a gate -- I arm your number
 * against my account, or my number against yours, and inbound texts do the
 * rest. So the body is tested for what it is NOT allowed to influence, which is
 * the assertion that is easy to delete and impossible to notice missing.
 *
 * Run with:  node --test src/routes/imessage-link.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerImessageLinkRoutes, linkView } from "./imessage-link.js";

const SESSION_PHONE = "+13105550100";
const AMBER_ID = "amber-uuid-1";
const AMBER_NUMBER = "+15550100008";

function buildApp({ authed = true, phone = SESSION_PHONE, row = null, spy = [] } = {}) {
  const app = Fastify({ logger: false });
  let stored = row;
  registerImessageLinkRoutes(app, {
    requireAuth: async (request, reply) => {
      if (!authed) return reply.code(401).send({ error: "missing_token" });
      request.privyUser = { userId: "did:amber:x", phone };
    },
    resolveAmberIdByPhone: async (p) => (p === phone ? AMBER_ID : null),
    getImessageLink: async (id) => (id === AMBER_ID ? stored : null),
    linkImessageChannel: async (id, p) => {
      spy.push({ op: "link", id, phone: p });
      stored = { phone, imessage_linked_at: new Date("2026-09-12T10:00:00Z"), imessage_linked_phone: p };
      return { imessage_linked_at: stored.imessage_linked_at, imessage_linked_phone: p };
    },
    unlinkImessageChannel: async (id) => {
      spy.push({ op: "unlink", id });
      stored = { phone, imessage_linked_at: null, imessage_linked_phone: null };
      return true;
    },
    senderPhone: () => AMBER_NUMBER,
  });
  return { app, spy };
}

test("THE CALLER CANNOT NAME THE NUMBER, however hard it tries", async () => {
  /**
   * The one that matters. If any of these bodies changes what gets armed, then
   * arming somebody else's number against my account -- or mine against
   * theirs -- is a single POST, and the webhook gate downstream is decoration.
   * The session's phone is the only input.
   */
  const attacks = [
    { phone: "+14155559999" },
    { linkedPhone: "+14155559999" },
    { imessage_linked_phone: "+14155559999" },
    { amberId: "someone-else", phone: "+14155559999" },
    { phone: SESSION_PHONE, linked: true, extra: { phone: "+14155559999" } },
  ];
  for (const payload of attacks) {
    const { app, spy } = buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/me/imessage-link", payload });
    // A schema rejection is a fine outcome too -- what is not fine is a 200
    // that armed a number the caller chose.
    for (const call of spy.filter((c) => c.op === "link")) {
      assert.equal(call.phone, SESSION_PHONE, `body ${JSON.stringify(payload)} chose the number`);
      assert.equal(call.id, AMBER_ID, `body ${JSON.stringify(payload)} chose the account`);
    }
    if (res.statusCode === 200) {
      assert.equal(res.json().linkedPhone, SESSION_PHONE);
    }
    await app.close();
  }
});

test("arming reports the state the settings screen renders", async () => {
  const { app } = buildApp();
  const res = await app.inject({ method: "POST", url: "/v1/me/imessage-link" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.linked, true);
  assert.equal(body.linkedPhone, SESSION_PHONE);
  assert.equal(body.amberNumber, AMBER_NUMBER, "the screen has no number to tell the user to text");
  assert.equal(body.linkedAt, "2026-09-12T10:00:00.000Z");
  await app.close();
});

test("an account that never armed it reads as off, not as missing", async () => {
  // Day one. A GET that errored or returned nothing would leave the settings
  // screen unable to render the switch at all, which is worse than off.
  const { app } = buildApp({ row: { phone: SESSION_PHONE, imessage_linked_at: null, imessage_linked_phone: null } });
  const res = await app.inject({ method: "GET", url: "/v1/me/imessage-link" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().linked, false);
  assert.equal(res.json().amberNumber, AMBER_NUMBER);
  await app.close();
});

test("DISARMING ACTUALLY DISARMS, because this is the undo for a mistake", async () => {
  const { app, spy } = buildApp({
    row: { phone: SESSION_PHONE, imessage_linked_at: new Date(), imessage_linked_phone: SESSION_PHONE },
  });
  const res = await app.inject({ method: "DELETE", url: "/v1/me/imessage-link" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().linked, false);
  assert.deepEqual(spy, [{ op: "unlink", id: AMBER_ID }]);
  await app.close();
});

test("every verb is behind the session, including the read", async () => {
  for (const method of ["GET", "POST", "DELETE"]) {
    const { app, spy } = buildApp({ authed: false });
    const res = await app.inject({ method, url: "/v1/me/imessage-link" });
    assert.equal(res.statusCode, 401, `${method} answered an unauthenticated caller`);
    assert.deepEqual(spy, [], `${method} touched the store before checking the session`);
    await app.close();
  }
});

test("a session with no phone is told why, not quietly ignored", async () => {
  /**
   * Apple sign-in carries no phone claim. A no-op 200 here would leave the app
   * showing a switch in the on position with nothing armed behind it -- the
   * user believes texting works, and it silently does not.
   */
  const { app, spy } = buildApp({ phone: null });
  const res = await app.inject({ method: "POST", url: "/v1/me/imessage-link" });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "no_phone_on_session");
  assert.deepEqual(spy, []);
  await app.close();
});

test("a session phone that is not E.164 is refused rather than armed into a dead switch", async () => {
  // An armed value the inbound sender can never equal is a switch that reads on
  // and admits nothing. Refusing is the only honest answer.
  const { app, spy } = buildApp({ phone: "someone@example.com" });
  const res = await app.inject({ method: "POST", url: "/v1/me/imessage-link" });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "phone_not_e164");
  assert.deepEqual(spy, []);
  await app.close();
});

test("a store that cannot write says so, instead of reporting success", async () => {
  const app = Fastify({ logger: false });
  registerImessageLinkRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = { phone: SESSION_PHONE };
    },
    resolveAmberIdByPhone: async () => AMBER_ID,
    getImessageLink: async () => null,
    linkImessageChannel: async () => null,
    unlinkImessageChannel: async () => false,
    senderPhone: () => AMBER_NUMBER,
  });
  const armed = await app.inject({ method: "POST", url: "/v1/me/imessage-link" });
  assert.equal(armed.statusCode, 500);
  assert.equal(armed.json().error, "link_failed");
  const off = await app.inject({ method: "DELETE", url: "/v1/me/imessage-link" });
  assert.equal(off.statusCode, 500);
  assert.equal(off.json().error, "unlink_failed");
  await app.close();
});

test("linkView reads a half-written row as off", () => {
  // The database CHECK forbids it, so this is what the response looks like if
  // that constraint is ever dropped. Off is the only safe reading.
  assert.equal(linkView({ imessage_linked_at: new Date() }).linked, false);
  assert.equal(linkView({ imessage_linked_phone: SESSION_PHONE }).linked, false);
  assert.equal(linkView(null).linked, false);
  assert.equal(linkView(null).phone, null);
});
