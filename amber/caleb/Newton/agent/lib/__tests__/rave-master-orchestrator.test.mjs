/**
 * Integration tests for the Rave Master orchestrator.
 *
 * Covers the behaviors locked into the build brief:
 *   - Inbound storage: every routed text reaches storeRaveInbound.
 *   - Trusted friend path: latest full plan reply + Sagar notification.
 *   - Unknown sender path: identify-yourself reply + Sagar notification.
 *   - Group messages: draft-only, never auto-sent, drafted to Sagar's DM.
 *   - Procurement guardrail: refuse to draft, still notify Sagar.
 *   - Owner DM is enriched silently (handled=false so the LLM still runs).
 *   - Gate: non-Sagar tenants short-circuit even with RAVE_MASTER_ENABLED.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/rave-master-orchestrator.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { handleRaveInbound } from "../rave-master/index.js";
import { emptyEventCard, updateTrustedHandles } from "../rave-master/event-card.js";

const sagar = {
  id: "did:privy:sagar",
  privyDid: "did:privy:sagar",
  amberId: "did:privy:sagar",
  displayName: "Samber",
  phoneNumber: "+15550100004",
  loopSenderId: "loop-sender-samber",
};
const camber = {
  id: "did:privy:caleb",
  privyDid: "did:privy:caleb",
  displayName: "Camber",
  phoneNumber: "+15550100002",
  loopSenderId: "loop-sender-camber",
};

function makeDeps(initialCard) {
  const sends = [];
  const stores = [];
  let card = initialCard;
  return {
    sends,
    stores,
    getCard: () => card,
    deps: {
      sendMessage: async (contact, body, opts) => {
        sends.push({ contact, body, opts });
        return { ok: true };
      },
      loadEventCard: async () => card,
      saveEventCard: async (_t, next) => {
        card = next;
      },
      storeRaveInbound: async (args) => {
        stores.push(args);
        return { ok: true };
      },
    },
  };
}

function withRaveEnv(fn) {
  return async (t) => {
    const prev = process.env.RAVE_MASTER_ENABLED;
    process.env.RAVE_MASTER_ENABLED = "1";
    try {
      await fn(t);
    } finally {
      if (prev === undefined) delete process.env.RAVE_MASTER_ENABLED;
      else process.env.RAVE_MASTER_ENABLED = prev;
    }
  };
}

test("gate: non-Sagar tenant is skipped even when env enabled",
  withRaveEnv(async () => {
    const { deps, sends } = makeDeps(emptyEventCard(camber));
    const result = await handleRaveInbound({
      tenant: camber,
      fromHandle: "+13105550111",
      text: "meet up at the yellow star",
      isOwner: false,
      isGroup: false,
      groupId: null,
      sendOpts: { tenant: camber },
      _deps: deps,
    });
    assert.equal(result.handled, false);
    assert.equal(sends.length, 0);
  }),
);

test("trusted friend gets latest plan and Sagar is notified",
  withRaveEnv(async () => {
    let card = emptyEventCard(sagar);
    card = updateTrustedHandles(card, "trust", ["+13105550111"]);
    card.next_meetup = { evidence: "yellow star at 9", sourceHandle: null, at: "" };
    const { deps, sends, stores } = makeDeps(card);
    const result = await handleRaveInbound({
      tenant: sagar,
      fromHandle: "+13105550111",
      text: "where are you guys",
      isOwner: false,
      isGroup: false,
      groupId: null,
      sendOpts: { tenant: sagar },
      _deps: deps,
    });
    assert.equal(result.handled, true);

    // Two sends: friend reply + Sagar notification.
    assert.equal(sends.length, 2);
    const [friendSend, sagarSend] = sends;
    assert.equal(friendSend.contact, "+13105550111");
    assert.match(friendSend.body, /next meetup/i);
    assert.match(friendSend.body, /yellow star/i);
    assert.equal(sagarSend.contact, sagar.phoneNumber);
    assert.match(sagarSend.body, /0111/);
    assert.match(sagarSend.body, /latest plan/i);

    // Inbound was stored.
    assert.equal(stores.length, 1);
    assert.equal(stores[0].fromHandle, "+13105550111");
  }),
);

test("unknown sender is asked to identify; Sagar gets notified with handle + snippet",
  withRaveEnv(async () => {
    const { deps, sends, stores } = makeDeps(emptyEventCard(sagar));
    const result = await handleRaveInbound({
      tenant: sagar,
      fromHandle: "+13105559999",
      text: "yo who is this",
      isOwner: false,
      isGroup: false,
      groupId: null,
      sendOpts: { tenant: sagar },
      _deps: deps,
    });
    assert.equal(result.handled, true);
    assert.equal(sends.length, 2);
    const [friendSend, sagarSend] = sends;
    assert.match(friendSend.body, /first name/i);
    // No identity leak in the unknown-sender reply.
    assert.doesNotMatch(friendSend.body, /sagar/i);
    assert.match(sagarSend.body, /9999/);
    assert.match(sagarSend.body, /yo who is this/i);
    assert.match(sagarSend.body, /trust/i);
    assert.equal(stores.length, 1);
  }),
);

test("group message is drafted to Sagar, never sent back to the group",
  withRaveEnv(async () => {
    const { deps, sends, stores, getCard } = makeDeps(emptyEventCard(sagar));
    const result = await handleRaveInbound({
      tenant: sagar,
      fromHandle: "+13105550111",
      text: "meet up at the yellow star at 10",
      isOwner: false,
      isGroup: true,
      groupId: "edc-group-1",
      sendOpts: { tenant: sagar, group: "edc-group-1" },
      _deps: deps,
    });
    assert.equal(result.handled, true);

    // The only outbound is Sagar's DM. NOTHING was sent to the group.
    assert.equal(sends.length, 1);
    assert.equal(sends[0].contact, sagar.phoneNumber);
    assert.doesNotMatch(JSON.stringify(sends[0].opts || {}), /"group"/);
    assert.match(sends[0].body, /draft/i);
    assert.match(sends[0].body, /will not auto-send/i);

    // Draft is persisted on the card for later approval.
    const card = getCard();
    assert.equal(card.pending_group_drafts.length, 1);
    assert.match(card.pending_group_drafts[0].body, /yellow star/i);

    // Inbound stored.
    assert.equal(stores.length, 1);
  }),
);

test("procurement intent in group: refuses to draft, still alerts Sagar",
  withRaveEnv(async () => {
    const { deps, sends, stores, getCard } = makeDeps(emptyEventCard(sagar));
    const result = await handleRaveInbound({
      tenant: sagar,
      fromHandle: "+13105550111",
      text: "anyone know a plug for molly at the airbnb",
      isOwner: false,
      isGroup: true,
      groupId: "edc-group-1",
      sendOpts: { tenant: sagar, group: "edc-group-1" },
      _deps: deps,
    });
    assert.equal(result.handled, true);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].contact, sagar.phoneNumber);
    assert.match(sends[0].body, /won'?t draft a group update/i);
    // The card still has no pending draft (we refused).
    assert.equal(getCard().pending_group_drafts.length, 0);
    // Still stored as audit + context.
    assert.equal(stores.length, 1);
  }),
);

test("owner DM with event content is silently enriched (handled=false)",
  withRaveEnv(async () => {
    const { deps, sends, stores, getCard } = makeDeps(emptyEventCard(sagar));
    const result = await handleRaveInbound({
      tenant: sagar,
      fromHandle: sagar.phoneNumber,
      text: "Just confirmed: meet up at the yellow star at 9",
      isOwner: true,
      isGroup: false,
      groupId: null,
      sendOpts: { tenant: sagar },
      _deps: deps,
    });
    // handled=false so the normal LLM path can still reply to Sagar.
    assert.equal(result.handled, false);
    // No outbound from this path — but the card was enriched.
    assert.equal(sends.length, 0);
    assert.equal(stores.length, 1);
    assert.ok(getCard().next_meetup);
  }),
);

test("RAVE: trust admin command updates the card and confirms",
  withRaveEnv(async () => {
    const { deps, sends, getCard } = makeDeps(emptyEventCard(sagar));
    const result = await handleRaveInbound({
      tenant: sagar,
      fromHandle: sagar.phoneNumber,
      text: "RAVE: trust +13105550111",
      isOwner: true,
      isGroup: false,
      groupId: null,
      sendOpts: { tenant: sagar },
      _deps: deps,
    });
    assert.equal(result.handled, true);
    assert.equal(sends.length, 1);
    assert.match(sends[0].body, /added/i);
    assert.deepEqual(getCard().trusted_handles, ["+13105550111"]);
  }),
);

test("RAVE: approve surfaces the queued draft for copy/paste, never auto-sends",
  withRaveEnv(async () => {
    let card = emptyEventCard(sagar);
    card = {
      ...card,
      pending_group_drafts: [
        { groupId: "g1", body: "Latest from the group: meet at yellow star.", at: "" },
      ],
    };
    const { deps, sends, getCard } = makeDeps(card);
    const result = await handleRaveInbound({
      tenant: sagar,
      fromHandle: sagar.phoneNumber,
      text: "RAVE: approve",
      isOwner: true,
      isGroup: false,
      groupId: null,
      sendOpts: { tenant: sagar },
      _deps: deps,
    });
    assert.equal(result.handled, true);
    assert.equal(sends.length, 1);
    // Approved message goes to Sagar (DM), not the group.
    assert.equal(sends[0].contact, sagar.phoneNumber);
    assert.match(sends[0].body, /copy this into the group chat/i);
    assert.match(sends[0].body, /yellow star/i);
    // Draft was consumed from the queue.
    assert.equal(getCard().pending_group_drafts.length, 0);
  }),
);

test("env flag off: orchestrator is a no-op even for Sagar",
  async () => {
    const prev = process.env.RAVE_MASTER_ENABLED;
    delete process.env.RAVE_MASTER_ENABLED;
    try {
      const { deps, sends } = makeDeps(emptyEventCard(sagar));
      const result = await handleRaveInbound({
        tenant: sagar,
        fromHandle: "+13105550111",
        text: "yo where are you",
        isOwner: false,
        isGroup: false,
        groupId: null,
        sendOpts: { tenant: sagar },
        _deps: deps,
      });
      assert.equal(result.handled, false);
      assert.equal(sends.length, 0);
    } finally {
      if (prev !== undefined) process.env.RAVE_MASTER_ENABLED = prev;
    }
  },
);
