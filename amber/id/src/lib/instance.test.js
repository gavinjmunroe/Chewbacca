/**
 * Tests for the multi-instance env-seam helpers.
 *
 * Run with:  node --test src/lib/instance.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  instanceId,
  collectionName,
  namedApiKeys,
  _resetNamedApiKeysCache,
} from "./instance.js";

function withEnv(patch, fn) {
  const before = {};
  for (const k of Object.keys(patch)) before[k] = process.env[k];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetNamedApiKeysCache();
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetNamedApiKeysCache();
  }
}

test("instanceId defaults to 'default' and respects AMBER_INSTANCE_ID", () => {
  withEnv({ AMBER_INSTANCE_ID: undefined }, () => {
    assert.equal(instanceId(), "default");
  });
  // AMBER_INSTANCE_ID labels deployments (e.g. staging, per-PR preview),
  // not users. amber-id is a single shared multi-tenant backend.
  withEnv({ AMBER_INSTANCE_ID: "staging" }, () => {
    assert.equal(instanceId(), "staging");
  });
});

test("collectionName is a no-op when the prefix is unset", () => {
  withEnv(
    {
      TABLE_PREFIX: undefined,
          },
    () => {
      assert.equal(collectionName("users"), "users");
    },
  );
});

test("collectionName applies TABLE_PREFIX (env-isolation only)", () => {
  // Used to share a GCP project between prod + staging without colliding.
  // Never used to carve out a single user — DIDs handle that already.
  withEnv({ TABLE_PREFIX: "staging_" }, () => {
    assert.equal(collectionName("users"), "staging_users");
    assert.equal(collectionName("secrets"), "staging_secrets");
  });
});

test("namespaceWithPrefix applies PINECONE_NAMESPACE_PREFIX (env-isolation only)", () => {
  withEnv({ PINECONE_NAMESPACE_PREFIX: "staging:" }, () => {
  });
});

test("namedApiKeys returns [] when env unset or empty", () => {
  withEnv({ AMBER_ID_API_KEYS: undefined }, () => {
    assert.deepEqual(namedApiKeys(), []);
  });
  withEnv({ AMBER_ID_API_KEYS: "" }, () => {
    assert.deepEqual(namedApiKeys(), []);
  });
});

test("namedApiKeys parses JSON form (named SERVICE callers, not users)", () => {
  // Named keys identify upstream SERVICES authenticating into the shared
  // multi-tenant amber-id (today: amber-imessage, amber-ios-dev, amber-agent),
  // never end users — end users use Privy JWTs.
  withEnv(
    {
      AMBER_ID_API_KEYS: JSON.stringify([
        { name: "amber-imessage", key: "sk_imessage_xxx" },
        { name: "amber-agent", key: "sk_agent_yyy" },
      ]),
    },
    () => {
      assert.deepEqual(namedApiKeys(), [
        { name: "amber-imessage", key: "sk_imessage_xxx", did: null },
        { name: "amber-agent", key: "sk_agent_yyy", did: null },
      ]);
    },
  );
});

test("namedApiKeys parses an optional per-key owner DID (JSON form)", () => {
  // A key bound to a DID lets a non-technical caller (e.g. a CEO) use the
  // identity/CRM tools without ever passing their own DID.
  withEnv(
    {
      AMBER_ID_API_KEYS: JSON.stringify([
        { name: "ceo", key: "sk_ceo_xxx", did: "did:privy:ceo123" },
        { name: "amber-agent", key: "sk_agent_yyy" },
      ]),
    },
    () => {
      assert.deepEqual(namedApiKeys(), [
        { name: "ceo", key: "sk_ceo_xxx", did: "did:privy:ceo123" },
        { name: "amber-agent", key: "sk_agent_yyy", did: null },
      ]);
    },
  );
});

test("namedApiKeys parses compact 'name:key,name:key' form", () => {
  withEnv(
    { AMBER_ID_API_KEYS: "amber-imessage:sk_aaa,amber-agent:sk_bbb" },
    () => {
      assert.deepEqual(namedApiKeys(), [
        { name: "amber-imessage", key: "sk_aaa", did: null },
        { name: "amber-agent", key: "sk_bbb", did: null },
      ]);
    },
  );
});

test("namedApiKeys keys with colons in the value parse correctly", () => {
  // Compact form splits on the FIRST colon; the value can contain more.
  withEnv({ AMBER_ID_API_KEYS: "amber-imessage:sk:has:colons" }, () => {
    assert.deepEqual(namedApiKeys(), [
      { name: "amber-imessage", key: "sk:has:colons", did: null },
    ]);
  });
});

test("namedApiKeys ignores malformed entries", () => {
  withEnv({ AMBER_ID_API_KEYS: ",,bare,no:value:," }, () => {
    // "no:value:" → name="no", key="value:" — valid
    assert.deepEqual(namedApiKeys(), [
      { name: "no", key: "value:", did: null },
    ]);
  });
  withEnv({ AMBER_ID_API_KEYS: "[not valid json" }, () => {
    assert.deepEqual(namedApiKeys(), []);
  });
});
