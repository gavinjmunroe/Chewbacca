/**
 * Tests for the Rave Master copy generators.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/rave-master-drafts.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildLatestPlanReply,
  buildUnknownSenderReply,
  buildSagarNotifyTrustedReply,
  buildSagarNotifyUnknown,
  buildGroupUpdateDraft,
  maskHandle,
} from "../rave-master/drafts.js";
import { emptyEventCard, applyClassificationToCard } from "../rave-master/event-card.js";
import { classifyEventMessage } from "../rave-master/classifier.js";

const sagar = {
  id: "did:privy:sagar",
  privyDid: "did:privy:sagar",
  phoneNumber: "+15550100004",
};

test("buildLatestPlanReply mentions meetup and rally number when populated", () => {
  let card = emptyEventCard(sagar);
  card = applyClassificationToCard(
    card,
    classifyEventMessage("meet up at the north brown lot by 8"),
    "+13105550111",
  );
  card = applyClassificationToCard(
    card,
    classifyEventMessage("driving the white SUV from the airbnb"),
    "+13105550111",
  );
  const reply = buildLatestPlanReply(card);
  assert.match(reply, /next meetup/i);
  assert.match(reply, /630/); // rally number echo
});

test("buildLatestPlanReply on empty card still produces a safe response", () => {
  const reply = buildLatestPlanReply(emptyEventCard(sagar));
  assert.match(reply, /nothing locked in/i);
  // Identity-leak: empty plan must not mention owner names.
  assert.doesNotMatch(reply, /sagar/i);
  assert.doesNotMatch(reply, /caleb/i);
});

test("buildUnknownSenderReply asks who they are and offers SAFE", () => {
  const r = buildUnknownSenderReply();
  assert.match(r, /first name/i);
  assert.match(r, /safe/i);
  // Must not name the owner.
  assert.doesNotMatch(r, /sagar/i);
  assert.doesNotMatch(r, /caleb/i);
});

test("buildSagarNotifyTrustedReply masks handle and summarizes reply", () => {
  const r = buildSagarNotifyTrustedReply({
    friendLabel: maskHandle("+13105550111"),
    replySummary: "the latest plan",
  });
  assert.match(r, /0111/);
  assert.match(r, /latest plan/i);
});

test("buildSagarNotifyUnknown includes masked number and snippet", () => {
  const r = buildSagarNotifyUnknown({
    handle: "+13105550111",
    text: "hi who is this",
  });
  assert.match(r, /0111/);
  assert.match(r, /hi who is this/i);
  assert.match(r, /trust/i);
});

test("buildGroupUpdateDraft signals not-sent and approval path", () => {
  let card = emptyEventCard(sagar);
  card = applyClassificationToCard(
    card,
    classifyEventMessage("meet up at the yellow star at 10"),
    "+13105550111",
  );
  const draft = buildGroupUpdateDraft(card);
  assert.match(draft, /draft \(not sent\)/i);
  assert.match(draft, /approve/i);
  assert.match(draft, /yellow star/i);
});

test("buildGroupUpdateDraft surfaces guardrail note when given", () => {
  const draft = buildGroupUpdateDraft(emptyEventCard(sagar), {
    guardrailNote: "won't draft procurement",
  });
  assert.match(draft, /won't draft procurement/i);
});

test("maskHandle preserves last 4 digits", () => {
  assert.equal(maskHandle("+13105550111"), "***-***-0111");
  assert.equal(maskHandle(""), "unknown");
  assert.equal(maskHandle(null), "unknown");
});
