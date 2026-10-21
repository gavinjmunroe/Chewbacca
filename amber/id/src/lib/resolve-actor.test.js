/**
 * THE RESOLVER THAT REPLACES THIRTY COPIES OF ITSELF.
 *
 * What is pinned here is everything the thirty copies either got wrong or never
 * had to answer:
 *
 *   - PHONE FIRST, THEN DID. Every existing token carries a phone; an
 *     email-only org member's token carries none, and resolving it is the
 *     difference between that account working and 401ing forever.
 *   - A CONSUMER ACCOUNT IS NOT AN ERROR. kind "individual" with no org, not a
 *     403 -- most accounts in this service are that, and the website asks this
 *     question before it knows which fork to render.
 *   - A SUSPENDED MEMBER IS REFUSED IN ONE PLACE. If this check lived in the
 *     routes it would apply to the ones somebody remembered.
 *   - THE ORG IS NEVER TAKEN FROM THE REQUEST. There is no input here a client
 *     can set, which is the property that makes the thirty-copy problem go away
 *     instead of multiplying.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  makeResolveActor,
  requireOrgAdmin,
  requireOrgMember,
  resolveActorFor,
  resolveActorOutcome,
} from "./resolve-actor.js";

const AMBER = "11111111-2222-3333-4444-555555555555";
const ORG = "99999999-8888-7777-6666-555555555555";

function deps({ byPhone = null, byDid = null, membership = null } = {}) {
  return {
    resolveByPhone: async () => byPhone,
    resolveByDid: async () => byDid,
    getMembership: async () => membership,
  };
}

function fakeReply() {
  const sent = {};
  return {
    sent,
    code(c) {
      sent.status = c;
      return this;
    },
    send(body) {
      sent.body = body;
      return this;
    },
  };
}

test("the phone resolves the account when there is one", async () => {
  const actor = await resolveActorFor({ userId: "did:amber:x", phone: "+13105550100" }, deps({ byPhone: AMBER }));
  assert.equal(actor.amberId, AMBER);
  assert.equal(actor.kind, "individual");
});

test("AN EMAIL-ONLY MEMBER HAS NO PHONE, so the DID has to resolve them", async () => {
  const actor = await resolveActorFor(
    { userId: `did:amber:${AMBER}`, phone: null },
    deps({ byDid: AMBER, membership: { orgId: ORG, role: "member", status: "active", orgName: "Paychex" } }),
  );
  assert.equal(actor.amberId, AMBER);
  assert.equal(actor.kind, "org");
  assert.equal(actor.orgId, ORG);
});

test("a phone that resolves to nothing falls through to the DID rather than failing", async () => {
  const actor = await resolveActorFor(
    { userId: `did:amber:${AMBER}`, phone: "+13105550100" },
    deps({ byPhone: null, byDid: AMBER }),
  );
  assert.equal(actor.amberId, AMBER);
});

test("a resolver that throws is a miss, not a crash", async () => {
  const actor = await resolveActorFor(
    { userId: "did:amber:x", phone: "+13105550100" },
    {
      resolveByPhone: async () => {
        throw new Error("cloud sql down");
      },
      resolveByDid: async () => null,
      getMembership: async () => null,
    },
  );
  assert.equal(actor, null);
});

/**
 * A DATABASE THAT DID NOT ANSWER IS NOT AN ACCOUNT THAT DOES NOT EXIST.
 *
 * This pair is the fix for a signed-in admin being shown "Account not found"
 * on a console already displaying his company's name: both lookups were
 * wrapped in `.catch(() => null)`, so one refused connection and one missing
 * account produced the same value and the same 401.
 */
test("a lookup that THREW is unavailable, not not_found", async () => {
  const out = await resolveActorOutcome(
    { userId: "did:amber:x", phone: "+13105550100" },
    {
      resolveByPhone: async () => {
        throw new Error("cloud sql down");
      },
      resolveByDid: async () => null,
      getMembership: async () => null,
    },
  );
  assert.deepEqual(out, { ok: false, reason: "unavailable" });
});

test("a lookup that ran cleanly and found nobody is genuinely not_found", async () => {
  const out = await resolveActorOutcome(
    { userId: "did:amber:x", phone: "+13105550100" },
    { resolveByPhone: async () => null, resolveByDid: async () => null, getMembership: async () => null },
  );
  assert.deepEqual(out, { ok: false, reason: "not_found" });
});

test("THE PREHANDLER ANSWERS 503 WHEN THE LOOKUP FAILED, NEVER 401", async () => {
  const handler = makeResolveActor({
    resolveByPhone: async () => {
      throw new Error("cloud sql down");
    },
    resolveByDid: async () => null,
    getMembership: async () => null,
  });
  const sent = [];
  const reply = {
    code(c) {
      sent.push(c);
      return this;
    },
    header() {
      return this;
    },
    send(body) {
      sent.push(body);
      return this;
    },
  };
  await handler({ privyUser: { userId: "did:amber:x", phone: "+13105550100" } }, reply);
  assert.equal(sent[0], 503);
  assert.equal(sent[1].error, "lookup_unavailable");
  // The word that sent somebody to check their password must not appear.
  assert.doesNotMatch(sent[1].message, /not found/i);
});

/**
 * A MEMBERSHIP LOOKUP THAT THREW MUST NOT PRODUCE "individual".
 *
 * That is not an error, it is a different confident answer: the console shows
 * an org admin the "you are not in a company" path while their company sits
 * there intact. Unavailable is the only honest value.
 */
test("a membership lookup that throws is unavailable, never an individual", async () => {
  const out = await resolveActorOutcome(
    { userId: "did:amber:x", phone: "+13105550100" },
    {
      resolveByPhone: async () => AMBER,
      resolveByDid: async () => null,
      getMembership: async () => {
        throw new Error("boom");
      },
    },
  );
  assert.deepEqual(out, { ok: false, reason: "unavailable" });
});

test("a membership lookup that cleanly returns nothing IS an individual", async () => {
  const out = await resolveActorOutcome(
    { userId: "did:amber:x", phone: "+13105550100" },
    {
      resolveByPhone: async () => AMBER,
      resolveByDid: async () => null,
      getMembership: async () => null,
    },
  );
  assert.equal(out.ok, true);
  assert.equal(out.actor.kind, "individual");
  assert.equal(out.actor.orgId, null);
});

test("the preHandler 401s on no session and on an unresolvable one, with different codes", async () => {
  const handler = makeResolveActor(deps({}));
  const noSession = fakeReply();
  await handler({ privyUser: null }, noSession);
  assert.equal(noSession.sent.status, 401);
  assert.equal(noSession.sent.body.error, "no_user");

  const unresolvable = fakeReply();
  await handler({ privyUser: { userId: "did:amber:x", phone: "+1" } }, unresolvable);
  assert.equal(unresolvable.sent.status, 401);
  assert.equal(unresolvable.sent.body.error, "no_amber_id");
});

test("the preHandler stamps the request and nothing on it came from the client", async () => {
  const handler = makeResolveActor(
    deps({ byPhone: AMBER, membership: { orgId: ORG, role: "admin", status: "active", orgName: "Paychex" } }),
  );
  // An org_id the caller tried to supply. It must not appear anywhere in what
  // the handler stamps.
  const request = { privyUser: { userId: "did:amber:x", phone: "+13105550100" }, body: { orgId: "attacker-org" } };
  await handler(request, fakeReply());
  assert.equal(request.amberId, AMBER);
  assert.equal(request.actor.orgId, ORG);
  assert.equal(request.actor.orgRole, "admin");
});

test("A SUSPENDED MEMBER IS REFUSED, and an individual is refused differently", async () => {
  const suspended = fakeReply();
  await requireOrgMember({ actor: { kind: "org", orgStatus: "suspended" } }, suspended);
  assert.equal(suspended.sent.status, 403);
  assert.equal(suspended.sent.body.error, "membership_suspended");

  const individual = fakeReply();
  await requireOrgMember({ actor: { kind: "individual" } }, individual);
  assert.equal(individual.sent.body.error, "not_in_org");

  const ok = fakeReply();
  const passed = await requireOrgMember({ actor: { kind: "org", orgStatus: "active" } }, ok);
  assert.equal(passed, undefined);
  assert.deepEqual(ok.sent, {});
});

test("requireOrgAdmin refuses a member and never runs after a membership refusal", async () => {
  const member = fakeReply();
  await requireOrgAdmin({ actor: { kind: "org", orgStatus: "active", orgRole: "member" } }, member);
  assert.equal(member.sent.body.error, "not_admin");

  // A suspended ADMIN must fail on the suspension, not fall through to the
  // role check and pass.
  const suspendedAdmin = fakeReply();
  await requireOrgAdmin({ actor: { kind: "org", orgStatus: "suspended", orgRole: "admin" } }, suspendedAdmin);
  assert.equal(suspendedAdmin.sent.body.error, "membership_suspended");

  const ok = fakeReply();
  assert.equal(
    await requireOrgAdmin({ actor: { kind: "org", orgStatus: "active", orgRole: "admin" } }, ok),
    undefined,
  );
});
