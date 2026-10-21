/**
 * Tests for the pure tenant-shape helpers in routes/tenants.js.
 *
 * The wire shape returned by /tenants/* endpoints carries the owner
 * identity for a given Amber account. Downstream services (notably
 * amber-imessage) must NEVER confuse this with an inbound contact's
 * identity — the `kind: "tenant_owner"` discriminator is the boundary
 * marker that prevents the regression where Maggie was answered as
 * "Sagar" because the owner profile bled into contact identity.
 *
 * Run with:  node --test src/routes/tenants.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { userToTenant, encodeMetadata } from "./tenants.js";

const sampleUser = (overrides = {}) => ({
  id: "did:privy:abc123",
  createdAt: "2026-04-01T00:00:00Z",
  phone: { number: "+13105550100" },
  customMetadata: encodeMetadata({
    displayName: "Sagar",
    agentName: "Camber",
    ownerName: "Sagar",
    phoneNumber: "+13105550100",
    loopSenderId: "loop-sender-uuid",
    loopSenderPhone: "+12135550100",
    contextRepo: "sagar/context",
    onboardingProfile: { step: "complete" },
    permissions: { calendar: true },
  }),
  ...overrides,
});

test("userToTenant carries kind=tenant_owner discriminator", () => {
  const t = userToTenant(sampleUser());
  assert.equal(t.kind, "tenant_owner");
});

test("userToTenant surfaces owner identity (displayName/ownerName/agentName)", () => {
  const t = userToTenant(sampleUser());
  assert.equal(t.displayName, "Sagar");
  assert.equal(t.ownerName, "Sagar");
  assert.equal(t.agentName, "Camber");
  assert.equal(t.privyDid, "did:privy:abc123");
});

test("userToTenant falls back agentName to displayName when only displayName is set", () => {
  const u = sampleUser({
    customMetadata: encodeMetadata({ displayName: "Sagar" }),
  });
  const t = userToTenant(u);
  assert.equal(t.agentName, "Sagar");
});

test("userToTenant decodes nested JSON-marker metadata", () => {
  const t = userToTenant(sampleUser());
  assert.deepEqual(t.onboardingProfile, { step: "complete" });
  assert.deepEqual(t.permissions, { calendar: true });
});

test("userToTenant returns nulls when metadata is empty — never falls back to fabricated owner name", () => {
  // The regression we're guarding against: a tenant with no displayName
  // must NOT silently produce an owner identity that downstream callers
  // could mistake for the contact's name. Every owner-identity field
  // should be explicitly null instead of borrowing from another source.
  const u = {
    id: "did:privy:empty",
    customMetadata: {},
    createdAt: "2026-04-01T00:00:00Z",
  };
  const t = userToTenant(u);
  assert.equal(t.kind, "tenant_owner");
  assert.equal(t.displayName, null);
  assert.equal(t.ownerName, null);
  assert.equal(t.agentName, null);
});
