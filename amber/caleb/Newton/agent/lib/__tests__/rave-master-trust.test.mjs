/**
 * Tests for trust resolution and the RAVE: admin command parser.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/rave-master-trust.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isTrustedForEvent,
  parseRaveAdminCommand,
} from "../rave-master/trust.js";
import { emptyEventCard, updateTrustedHandles } from "../rave-master/event-card.js";

const sagar = {
  id: "did:privy:sagar",
  privyDid: "did:privy:sagar",
  phoneNumber: "+15550100004",
};

test("untrusted handle is rejected", () => {
  const card = emptyEventCard(sagar);
  assert.equal(isTrustedForEvent("+13105559999", card, { isOwner: false }), false);
});

test("explicit trust handle is accepted", () => {
  let card = emptyEventCard(sagar);
  card = updateTrustedHandles(card, "trust", ["+13105550111"]);
  assert.equal(isTrustedForEvent("+13105550111", card, { isOwner: false }), true);
  // Different number is still untrusted.
  assert.equal(isTrustedForEvent("+13105550112", card, { isOwner: false }), false);
});

test("owner is always trusted", () => {
  const card = emptyEventCard(sagar);
  assert.equal(isTrustedForEvent("+15550100004", card, { isOwner: true }), true);
});

test("parseRaveAdminCommand recognizes trust/untrust with phone", () => {
  const p1 = parseRaveAdminCommand("RAVE: trust +13105550111");
  assert.equal(p1.cmd, "trust");
  assert.deepEqual(p1.handles, ["+13105550111"]);

  const p2 = parseRaveAdminCommand("rave: untrust +13105550111, +13105550112");
  assert.equal(p2.cmd, "untrust");
  assert.equal(p2.handles.length, 2);
});

test("parseRaveAdminCommand recognizes plan/approve/status/reset", () => {
  for (const cmd of ["plan", "approve", "status", "reset"]) {
    const p = parseRaveAdminCommand(`RAVE: ${cmd}`);
    assert.equal(p.cmd, cmd);
  }
});

test("parseRaveAdminCommand returns null for non-admin text", () => {
  assert.equal(parseRaveAdminCommand("hey what's the plan"), null);
  assert.equal(parseRaveAdminCommand(""), null);
  assert.equal(parseRaveAdminCommand(null), null);
});
