/**
 * THE GATE AS THE WEBHOOK ACTUALLY CALLS IT.
 *
 * lib/imessage-link.test.js pins the decision. This pins the wiring, which is a
 * separate thing and historically the one that breaks: a correct policy that
 * the handler consults and then ignores looks identical in a policy test, and
 * this service has already shipped one bug of exactly that shape -- 1379 green
 * tests, none of which ever booted the app, while two routes collided at boot.
 *
 * So every assertion here is about a side effect: what was written, what was
 * sent, and what came back to the caller. The verdicts themselves are somebody
 * else's test.
 *
 * Run with:  node --test src/routes/photon-webhook-admission.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { admitDmSender } from "./photon-webhook.js";

const MINE = "+16175551234";
const OWNER = "11111111-1111-4111-8111-111111111111";

const armed = { amber_id: OWNER, phone: MINE, status: "active", imessage_linked_at: new Date(), imessage_linked_phone: MINE };
const unarmed = { amber_id: OWNER, phone: MINE, status: "active", imessage_linked_at: null, imessage_linked_phone: null };

function harness({ user = null, enrolled = null, dmOpen = true } = {}) {
  const sent = [];
  const enrolls = [];
  return {
    sent,
    enrolls,
    deps: {
      dmOpen,
      allowlist: new Set(),
      getUserByPhone: async () => user,
      enrollImessageUser: async (args) => {
        enrolls.push(args);
        return enrolled;
      },
      sendReply: async (spaceId, spacePhone, text) => {
        sent.push({ spaceId, text });
      },
      told: new Set(),
    },
  };
}

const call = (h, over = {}) =>
  admitDmSender({ senderE164: MINE, spaceId: "spc-1", spacePhone: null, log: null, ...over }, h.deps);

test("AN UNARMED ACCOUNT NEVER REACHES THE PIPELINE", async () => {
  // The regression. A non-null return here is an ownerId downstream, and an
  // ownerId downstream is the contact graph.
  const h = harness({ user: unarmed });
  assert.equal(await call(h), null);
  assert.deepEqual(h.enrolls, [], "an existing account was re-enrolled instead of gated");
});

test("an unarmed account is told what to do, exactly once per space", async () => {
  const h = harness({ user: unarmed });
  await call(h);
  await call(h);
  await call(h);
  assert.equal(h.sent.length, 1, `told them ${h.sent.length} times`);
  assert.match(h.sent[0].text, /Connections > Amber/);
  // A different thread with the same person is a different conversation and
  // has not seen the instruction.
  await call(h, { spaceId: "spc-2" });
  assert.equal(h.sent.length, 2);
});

test("an armed account is handed straight through", async () => {
  const h = harness({ user: armed });
  const out = await call(h);
  assert.equal(out?.user?.amber_id, OWNER);
  assert.deepEqual(h.sent, [], "an admitted sender was sent the link instruction");
});

test("a new number is enrolled, armed, and never told to go turn anything on", async () => {
  const fresh = { amber_id: "new-id", phone: MINE, status: "awaiting_name" };
  const h = harness({ user: null, enrolled: fresh });
  const out = await call(h);
  assert.equal(out?.user?.amber_id, "new-id");
  assert.deepEqual(h.enrolls, [{ phone: MINE }]);
  assert.deepEqual(h.sent, [], "a brand-new number was asked to open an app it has never installed");
});

test("A STORE OUTAGE IS NOT AN OPEN DOOR", async () => {
  /**
   * getUserByPhone throwing is the interesting one. If the lookup failure were
   * swallowed into "no gate to apply", every account in the service would be
   * reachable by phone claim for the duration of a database blip -- the exact
   * behavior this change removed, restored by an error path.
   *
   * It reads as a new number instead: enrollment is attempted, and since the
   * store is down that fails too, so the turn ends with no owner. A duplicate
   * account on recovery is the worst case, and that is the right worst case.
   */
  const sent = [];
  const out = await admitDmSender(
    { senderE164: MINE, spaceId: "spc-1", spacePhone: null, log: null },
    {
      dmOpen: true,
      allowlist: new Set(),
      getUserByPhone: async () => {
        throw new Error("ECONNREFUSED");
      },
      enrollImessageUser: async () => {
        throw new Error("ECONNREFUSED");
      },
      sendReply: async (...a) => sent.push(a),
      told: new Set(),
    },
  );
  assert.equal(out?.user, null, "a database outage produced a user");
  assert.equal(out?.user?.amber_id, undefined, "a database outage produced an owner id");
});

test("a failed send does not take the process down with it", async () => {
  // sendPhotonReply resets the gRPC app and rethrows on any transport error.
  // This runs after the 200 ACK, fire and forget, so a throw here is an
  // unhandled rejection rather than an error anybody sees.
  const h = harness({ user: unarmed });
  h.deps.sendReply = async () => {
    throw new Error("UNAVAILABLE");
  };
  assert.equal(await call(h), null);
});

test("the told-once set cannot grow without bound", async () => {
  const told = new Set();
  for (let i = 0; i < 10_050; i++) told.add(`spc-old-${i}`);
  const h = harness({ user: unarmed });
  h.deps.told = told;
  await call(h, { spaceId: "spc-new" });
  assert.ok(told.size < 10_000, `the set kept growing: ${told.size}`);
  assert.ok(told.has("spc-new"), "the clear dropped the entry it was making room for");
});

test("the gate closed still closes here, not just in the policy", async () => {
  const h = harness({ user: armed, dmOpen: false });
  assert.equal(await call(h), null);
  assert.deepEqual(h.sent, [], "a sender we refuse to talk to was talked to");
});

test("an Apple ID handle is dropped without minting an account for it", async () => {
  const h = harness({ user: null, enrolled: { amber_id: "x" } });
  assert.equal(await call(h, { senderE164: "someone@example.com" }), null);
  assert.deepEqual(h.enrolls, [], "an email address was written into users.phone");
});
