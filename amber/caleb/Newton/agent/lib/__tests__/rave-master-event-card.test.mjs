/**
 * Tests for the Rave Master event-card pure-update functions.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/rave-master-event-card.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyEventMessage } from "../rave-master/classifier.js";
import {
  emptyEventCard,
  applyClassificationToCard,
  updateTrustedHandles,
  queueGroupDraft,
  popLatestGroupDraft,
} from "../rave-master/event-card.js";

const sagar = {
  id: "did:privy:sagar",
  privyDid: "did:privy:sagar",
  phoneNumber: "+15550100004",
  displayName: "Samber",
};

test("emptyEventCard scopes event_id to tenant", () => {
  const card = emptyEventCard(sagar);
  assert.equal(card.event_id, "event:did:privy:sagar:edc:2026");
  assert.equal(card.owner_did, "did:privy:sagar");
  assert.equal(card.title, "EDC 2026");
  assert.equal(card.visibility, "private");
  assert.deepEqual(card.trusted_handles, []);
});

test("applyClassificationToCard records ticket evidence into the ledger", () => {
  const card = emptyEventCard(sagar);
  const c = classifyEventMessage("StubHub finally sent the Friday GA ticket");
  const next = applyClassificationToCard(card, c, "+13105550111");
  assert.equal(next.ticket_ledger.length, 1);
  assert.match(next.ticket_ledger[0].evidence, /ticket/i);
  assert.equal(next.ticket_ledger[0].sourceHandle, "+13105550111");
  assert.ok(next.last_scanned_at);
  assert.equal(next.open_loops.length, 1);
});

test("applyClassificationToCard sets next_meetup on meetup primary", () => {
  const card = emptyEventCard(sagar);
  const c = classifyEventMessage("meet up at the yellow star by main stage at 9");
  const next = applyClassificationToCard(card, c, "+13105550111");
  assert.ok(next.next_meetup);
  assert.match(next.next_meetup.evidence, /yellow star/i);
});

test("applyClassificationToCard sets safety_status on safety primary", () => {
  const card = emptyEventCard(sagar);
  const c = classifyEventMessage("got separated from the group and my phone is dying");
  const next = applyClassificationToCard(card, c, "+13105550111");
  assert.ok(next.safety_status);
});

test("applyClassificationToCard with null classification is a no-op", () => {
  const card = emptyEventCard(sagar);
  const next = applyClassificationToCard(card, null, "+13105550111");
  assert.deepEqual(next, card);
});

test("updateTrustedHandles adds and removes handles", () => {
  const card = emptyEventCard(sagar);
  const added = updateTrustedHandles(card, "trust", ["+13105550111", "+13105550112"]);
  assert.deepEqual(added.trusted_handles.sort(), ["+13105550111", "+13105550112"]);
  const removed = updateTrustedHandles(added, "untrust", ["+13105550111"]);
  assert.deepEqual(removed.trusted_handles, ["+13105550112"]);
});

test("queueGroupDraft and popLatestGroupDraft round trip", () => {
  const card = emptyEventCard(sagar);
  const draft = { body: "Latest from the group: X", at: "2026-05-12T00:00:00Z" };
  const queued = queueGroupDraft(card, draft);
  assert.equal(queued.pending_group_drafts.length, 1);
  const { card: after, draft: popped } = popLatestGroupDraft(queued);
  assert.equal(after.pending_group_drafts.length, 0);
  assert.equal(popped.body, draft.body);
});
