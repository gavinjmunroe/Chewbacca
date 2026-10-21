import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveScope,
  filterEnvelopeByScope,
  getAgent,
  isKnownAgent,
  parseScopeHeader,
  SCOPE_KEYS,
  SECTION_SCOPE,
} from "./agents.js";

test("known agents resolve and unknown ones do not", () => {
  assert.equal(isKnownAgent("medha"), true);
  assert.equal(isKnownAgent("togari"), true);
  assert.equal(isKnownAgent("internal-cron"), true);
  assert.equal(isKnownAgent("does-not-exist"), false);
  assert.equal(isKnownAgent(""), false);
  assert.equal(isKnownAgent(null), false);
  assert.equal(isKnownAgent(undefined), false);
  assert.equal(getAgent("medha")?.id, "medha");
  assert.equal(getAgent("missing"), null);
});

test("effectiveScope without narrowing returns the agent's default scope", () => {
  const scope = effectiveScope("medha", null);
  assert.ok(scope.includes("profile.read"));
  assert.ok(scope.includes("memory.write"));
});

test("effectiveScope intersects defaultScope with requestedScope", () => {
  const scope = effectiveScope("medha", ["profile.read", "memory.write"]);
  assert.deepEqual([...scope].sort(), ["memory.write", "profile.read"]);
});

test("effectiveScope drops requested scopes the agent does not have", () => {
  // togari's defaultScope does not include memory.write
  const scope = effectiveScope("togari", ["memory.write", "profile.read"]);
  assert.deepEqual([...scope], ["profile.read"]);
});

test("effectiveScope returns empty array for unknown agents", () => {
  const scope = effectiveScope("not-an-agent", ["profile.read"]);
  assert.deepEqual([...scope], []);
});

test("effectiveScope tolerates non-array requestedScope", () => {
  const scope = effectiveScope("medha", "profile.read"); // not an array
  // falls through to defaultScope
  assert.ok(scope.length > 0);
});

test("effectiveScope returns frozen arrays", () => {
  const scope = effectiveScope("medha", null);
  assert.throws(() => scope.push("new.scope"));
});

test("filterEnvelopeByScope strips unauthorized sections", () => {
  const envelope = {
    user: { did: "did:privy:abc" },
    immutable: { birthday: "1990-01-01" },
    personality: [],
    preferences: { tone: "warm" },
    relationships: { summary: "0 contacts" },
    permissions: { privacy_tier: "selective_cloud" },
    memory: { pinecone_namespace: "tenant-did:privy:abc" },
  };
  // Only profile.read and memory.query authorized
  const stripped = filterEnvelopeByScope(envelope, [
    "profile.read",
    "memory.query",
  ]);
  assert.ok(envelope.user);
  assert.ok(envelope.memory);
  assert.equal(envelope.immutable, undefined);
  assert.equal(envelope.personality, undefined);
  assert.equal(envelope.preferences, undefined);
  assert.equal(envelope.relationships, undefined);
  assert.equal(envelope.permissions, undefined);
  assert.deepEqual([...stripped].sort(), [
    "immutable",
    "permissions",
    "personality",
    "preferences",
    "relationships",
  ]);
});

test("filterEnvelopeByScope strips nothing when scope is full", () => {
  const envelope = {
    user: {},
    immutable: {},
    personality: [],
    preferences: {},
    relationships: {},
    permissions: {},
    memory: {},
  };
  const stripped = filterEnvelopeByScope(envelope, [...SCOPE_KEYS]);
  assert.deepEqual([...stripped], []);
  assert.equal(Object.keys(envelope).length, 7);
});

test("parseScopeHeader handles comma and space separators", () => {
  assert.deepEqual(parseScopeHeader("profile.read,memory.query"), [
    "profile.read",
    "memory.query",
  ]);
  assert.deepEqual(parseScopeHeader("profile.read memory.query"), [
    "profile.read",
    "memory.query",
  ]);
  assert.deepEqual(parseScopeHeader("profile.read, memory.query"), [
    "profile.read",
    "memory.query",
  ]);
});

test("parseScopeHeader returns null for empty / non-string input", () => {
  assert.equal(parseScopeHeader(""), null);
  assert.equal(parseScopeHeader("   "), null);
  assert.equal(parseScopeHeader(null), null);
  assert.equal(parseScopeHeader(undefined), null);
  assert.equal(parseScopeHeader(42), null);
});

test("SECTION_SCOPE covers every envelope section we expose", () => {
  const expectedSections = [
    "user",
    "immutable",
    "personality",
    "preferences",
    "relationships",
    "permissions",
    "memory",
  ];
  for (const section of expectedSections) {
    assert.ok(
      SECTION_SCOPE[section],
      `SECTION_SCOPE missing required section: ${section}`,
    );
  }
});
