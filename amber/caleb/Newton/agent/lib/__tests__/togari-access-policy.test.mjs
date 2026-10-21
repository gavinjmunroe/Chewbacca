/**
 * Tests for the Togari enterprise access policy helper.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/togari-access-policy.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVATION_SOURCES,
  evaluateActivation,
  assertActivationAllowed,
  tenantHasEnterpriseEntitlement,
  iosAllowedReadPrimitives,
} from "../togari-access-policy.js";

const camber = {
  privyDid: "did:privy:caleb",
  displayName: "Camber",
  phoneNumber: "+15550100002",
  loopSenderId: "loop-camber",
  tier: "amber_imsg",
  entitlements: { peoplerank: true, enrich: true, imessage_concierge: true },
};

const samber = {
  privyDid: "did:privy:sagar",
  displayName: "Samber",
  phoneNumber: "+15550100004",
  loopSenderId: "loop-samber",
  tier: "amber_plus",
  entitlements: { peoplerank: true, enrich: true },
};

test("Loop-verified iMessage with enterprise tenant is allowed", () => {
  const decision = evaluateActivation({
    source: ACTIVATION_SOURCES.IMESSAGE_LOOP,
    tenant: camber,
    loopVerified: true,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "loop_verified_concierge");
});

test("Loop without verified signature is rejected even for enterprise tenant", () => {
  const decision = evaluateActivation({
    source: ACTIVATION_SOURCES.IMESSAGE_LOOP,
    tenant: camber,
    loopVerified: false,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "loop_signature_unverified");
});

test("iOS proxy is never allowed to activate enterprise", () => {
  const decision = evaluateActivation({
    source: ACTIVATION_SOURCES.IOS_PROXY,
    tenant: camber,
    loopVerified: true,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "ios_cannot_activate_enterprise");
});

test("Unknown source is rejected", () => {
  const decision = evaluateActivation({ tenant: camber });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "unknown_source");
});

test("Missing tenant is rejected", () => {
  const decision = evaluateActivation({
    source: ACTIVATION_SOURCES.IMESSAGE_LOOP,
    loopVerified: true,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "tenant_unresolved");
});

test("Tenant without enterprise entitlement is rejected", () => {
  const decision = evaluateActivation({
    source: ACTIVATION_SOURCES.IMESSAGE_LOOP,
    tenant: samber,
    loopVerified: true,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "missing_enterprise_entitlement");
});

test("Scheduled jobs may run for already-entitled tenant but cannot upgrade", () => {
  const ok = evaluateActivation({
    source: ACTIVATION_SOURCES.SCHEDULED_JOB,
    tenant: camber,
  });
  assert.equal(ok.allowed, true);
  assert.equal(ok.reason, "preauthorized_tenant");

  const denied = evaluateActivation({
    source: ACTIVATION_SOURCES.SCHEDULED_JOB,
    tenant: samber,
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "missing_enterprise_entitlement");
});

test("Camber and Samber are evaluated as separate tenants", () => {
  // Camber is enterprise; Samber is not. Activation on one must not
  // implicitly grant activation to the other.
  const camberOk = evaluateActivation({
    source: ACTIVATION_SOURCES.IMESSAGE_LOOP,
    tenant: camber,
    loopVerified: true,
  });
  const samberDenied = evaluateActivation({
    source: ACTIVATION_SOURCES.IMESSAGE_LOOP,
    tenant: samber,
    loopVerified: true,
  });
  assert.equal(camberOk.allowed, true);
  assert.equal(samberDenied.allowed, false);
  assert.notEqual(camber.privyDid, samber.privyDid);
});

test("tenantHasEnterpriseEntitlement reads tier and entitlement bag", () => {
  assert.equal(tenantHasEnterpriseEntitlement(camber), true);
  assert.equal(tenantHasEnterpriseEntitlement(samber), false);
  assert.equal(tenantHasEnterpriseEntitlement(null), false);
  assert.equal(
    tenantHasEnterpriseEntitlement({
      privyDid: "x",
      permissions: { togari_enterprise: true },
    }),
    true,
  );
});

test("assertActivationAllowed throws structured error on denial", () => {
  assert.throws(
    () =>
      assertActivationAllowed({
        source: ACTIVATION_SOURCES.IOS_PROXY,
        tenant: camber,
      }),
    (err) => {
      assert.equal(err.code, "ios_cannot_activate_enterprise");
      assert.equal(err.source, ACTIVATION_SOURCES.IOS_PROXY);
      return true;
    },
  );
});

test("assertActivationAllowed returns decision when allowed", () => {
  const decision = assertActivationAllowed({
    source: ACTIVATION_SOURCES.IMESSAGE_LOOP,
    tenant: camber,
    loopVerified: true,
  });
  assert.equal(decision.allowed, true);
});

test("iosAllowedReadPrimitives gates on entitlement bag", () => {
  const camberSet = iosAllowedReadPrimitives(camber);
  assert.ok(camberSet.has("peoplerank"));
  assert.ok(camberSet.has("enrich"));
  assert.ok(camberSet.has("opportunity"));

  const samberSet = iosAllowedReadPrimitives(samber);
  assert.ok(samberSet.has("peoplerank"));
  assert.ok(samberSet.has("enrich"));

  const noneSet = iosAllowedReadPrimitives({ privyDid: "x", entitlements: {} });
  assert.equal(noneSet.size, 0);
});
