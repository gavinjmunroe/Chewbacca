/**
 * Tests for lib/voice/retell — the Retell voice-agent foundation.
 *
 * The Retell SDK is never loaded in this test file. We swap in a fake
 * client factory via setRetellClientFactory so we can assert on the
 * payload the adapter would have sent, without touching the network or
 * the package.
 *
 * Hard properties we prove here:
 *   - Disabled by default (no flag → no call attempted)
 *   - Missing key fails safely with reason "missing_api_key"
 *   - API key never appears in logs
 *   - Dynamic variables are stringified and unknown keys dropped
 *   - createPhoneCall only invokes the SDK when the feature flag is on
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/retell-adapter.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isConfigured,
  describeConfig,
  createPhoneCall,
  createAgent,
  buildDynamicVariables,
  setRetellClientFactory,
  RETELL_KNOWN_VARIABLE_KEYS,
} from "../voice/retell/index.js";
import {
  redactApiKey,
  redactPhone,
  summarizeCallAttempt,
} from "../voice/retell/redact.js";

// ── helpers ──────────────────────────────────────────────────────────────

const RETELL_ENV_KEYS = [
  "AMBER_RETELL_ENABLED",
  "RETELL_API_KEY",
  "RETELL_AGENT_ID",
  "RETELL_LLM_ID",
  "RETELL_FROM_NUMBER",
];

function snapshotEnv() {
  const prev = {};
  for (const k of RETELL_ENV_KEYS) prev[k] = process.env[k];
  return prev;
}

function restoreEnv(prev) {
  for (const k of RETELL_ENV_KEYS) {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k];
  }
}

function clearEnv() {
  for (const k of RETELL_ENV_KEYS) delete process.env[k];
}

function captureLogs() {
  const lines = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...args) => lines.push(args.map((a) => String(a)).join(" "));
  console.warn = (...args) => lines.push(args.map((a) => String(a)).join(" "));
  return {
    lines,
    restore() {
      console.log = origLog;
      console.warn = origWarn;
    },
  };
}

function makeFakeClient(recorder) {
  return async (apiKey) => {
    recorder.builtWith = apiKey;
    return {
      call: {
        async createPhoneCall(payload) {
          recorder.calls.push(payload);
          return { call_id: "call_test_123", ...recorder.responseExtras };
        },
      },
      agent: {
        async create(spec) {
          recorder.agents.push(spec);
          return { agent_id: "agent_test_456" };
        },
      },
    };
  };
}

// ── redact / variables — pure helpers, no env ────────────────────────────

test("redactApiKey never includes the raw key", () => {
  assert.equal(redactApiKey("sk_super_secret_value_123"), "len=25");
  assert.equal(redactApiKey(""), "len=0");
  assert.equal(redactApiKey(null), "len=0");
});

test("redactPhone keeps only last 4 digits", () => {
  assert.equal(redactPhone("+14155550199"), "…0199");
  assert.equal(redactPhone("+1 (415) 555-0199"), "…0199");
  assert.equal(redactPhone(""), "***");
  assert.equal(redactPhone("123"), "***");
});

test("summarizeCallAttempt is structurally safe to log", () => {
  const s = summarizeCallAttempt({
    toNumber: "+14155550199",
    fromNumber: "+14155550100",
    agentId: "agent_x",
    variableNames: ["agent_name", "objective"],
    metadataKeys: ["tenantDid"],
    enabled: true,
    hasKey: true,
  });
  assert.equal(s.to, "…0199");
  assert.equal(s.from, "…0100");
  assert.deepEqual(s.variableNames, ["agent_name", "objective"]);
  assert.deepEqual(s.metadataKeys, ["tenantDid"]);
  // No raw fields should have leaked through.
  assert.ok(!("toNumber" in s));
  assert.ok(!("fromNumber" in s));
});

test("buildDynamicVariables stringifies and drops unknown keys", () => {
  const vars = buildDynamicVariables({
    tenant: {
      firstName: "Caleb",
      phoneNumber: "+14155550100",
      agentName: "camber",
    },
    contact: { firstName: "Mira" },
    role: "scheduler",
    objective: "confirm dinner 7pm",
    safetyMode: "safe",
    calendarSummary: "free until 5",
    extra: {
      // unknown key — must be dropped
      api_key: "should_not_appear",
      // known key but blank in main args, so this should fill it
      role: "scheduler_v2_unused_because_role_already_set",
    },
  });
  assert.equal(vars.agent_name, "camber");
  assert.equal(vars.tenant_name, "Caleb");
  assert.equal(vars.tenant_phone_last4, "0100");
  assert.equal(vars.contact_name, "Mira");
  assert.equal(vars.role, "scheduler");
  assert.equal(vars.objective, "confirm dinner 7pm");
  assert.equal(vars.safety_mode, "safe");
  assert.equal(vars.calendar_summary, "free until 5");
  assert.ok(!("api_key" in vars));
  // All values must be strings — Retell expects a flat string map.
  for (const v of Object.values(vars)) assert.equal(typeof v, "string");
});

test("buildDynamicVariables coerces booleans/numbers to strings", () => {
  const vars = buildDynamicVariables({
    tenant: { firstName: "Sagar" },
    extra: {},
    // pretend a caller mistakenly passed a number for objective
    objective: 42,
    safetyMode: true,
  });
  assert.equal(vars.objective, "42");
  assert.equal(vars.safety_mode, "true");
});

test("buildDynamicVariables refuses nested objects/arrays as variable values", () => {
  // Direct object/array values on top-level inputs aren't shaped to land
  // anywhere — we only check that the builder never returns an object
  // as a variable value.
  const vars = buildDynamicVariables({
    tenant: { firstName: "Caleb" },
    objective: { nested: "no" },
  });
  assert.ok(!("objective" in vars));
});

test("RETELL_KNOWN_VARIABLE_KEYS is the documented allowlist", () => {
  assert.deepEqual(RETELL_KNOWN_VARIABLE_KEYS.slice().sort(), [
    "agent_name",
    "calendar_summary",
    "contact_name",
    "objective",
    "role",
    "safety_mode",
    "tenant_name",
    "tenant_phone_last4",
  ]);
});

// ── isConfigured / describeConfig — env-driven ───────────────────────────

test("isConfigured is false when nothing is set (default safe)", () => {
  const prev = snapshotEnv();
  clearEnv();
  try {
    assert.equal(isConfigured(), false);
  } finally {
    restoreEnv(prev);
  }
});

test("isConfigured is false when key is set but flag is off", () => {
  const prev = snapshotEnv();
  clearEnv();
  process.env.RETELL_API_KEY = "test_secret_value_xyz";
  try {
    assert.equal(isConfigured(), false);
  } finally {
    restoreEnv(prev);
  }
});

test("isConfigured is false when flag is on but no key", () => {
  const prev = snapshotEnv();
  clearEnv();
  process.env.AMBER_RETELL_ENABLED = "true";
  try {
    assert.equal(isConfigured(), false);
  } finally {
    restoreEnv(prev);
  }
});

test("isConfigured is true only with flag + key", () => {
  const prev = snapshotEnv();
  clearEnv();
  process.env.AMBER_RETELL_ENABLED = "true";
  process.env.RETELL_API_KEY = "test_secret_value_xyz";
  try {
    assert.equal(isConfigured(), true);
  } finally {
    restoreEnv(prev);
  }
});

test("describeConfig never exposes the raw key", () => {
  const prev = snapshotEnv();
  clearEnv();
  process.env.AMBER_RETELL_ENABLED = "true";
  process.env.RETELL_API_KEY = "super_duper_secret_abcdef";
  process.env.RETELL_FROM_NUMBER = "+14155550100";
  try {
    const desc = describeConfig();
    assert.equal(desc.enabled, true);
    assert.equal(desc.hasKey, true);
    assert.equal(desc.keyLen, "len=25");
    assert.equal(desc.fromNumber, "…0100");
    const serialized = JSON.stringify(desc);
    assert.ok(!serialized.includes("super_duper_secret_abcdef"));
  } finally {
    restoreEnv(prev);
  }
});

// ── createPhoneCall — disabled / misconfigured paths ─────────────────────

test("createPhoneCall: disabled by default, never calls SDK", async () => {
  const prev = snapshotEnv();
  clearEnv();
  const recorder = { calls: [], agents: [] };
  setRetellClientFactory(makeFakeClient(recorder));
  try {
    const res = await createPhoneCall({ toNumber: "+14155550199" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "feature_flag_off");
    assert.equal(recorder.calls.length, 0);
    assert.equal(recorder.builtWith, undefined);
  } finally {
    setRetellClientFactory(null);
    restoreEnv(prev);
  }
});

test("createPhoneCall: flag on but no key returns missing_api_key", async () => {
  const prev = snapshotEnv();
  clearEnv();
  process.env.AMBER_RETELL_ENABLED = "true";
  const recorder = { calls: [], agents: [] };
  setRetellClientFactory(makeFakeClient(recorder));
  try {
    const res = await createPhoneCall({ toNumber: "+14155550199" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_api_key");
    assert.equal(recorder.calls.length, 0);
  } finally {
    setRetellClientFactory(null);
    restoreEnv(prev);
  }
});

test("createPhoneCall: missing toNumber rejected before SDK", async () => {
  const prev = snapshotEnv();
  clearEnv();
  process.env.AMBER_RETELL_ENABLED = "true";
  process.env.RETELL_API_KEY = "k";
  process.env.RETELL_FROM_NUMBER = "+14155550100";
  const recorder = { calls: [], agents: [] };
  setRetellClientFactory(makeFakeClient(recorder));
  try {
    const res = await createPhoneCall({});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_to_number");
    assert.equal(recorder.calls.length, 0);
  } finally {
    setRetellClientFactory(null);
    restoreEnv(prev);
  }
});

test("createPhoneCall: missing from_number rejected before SDK", async () => {
  const prev = snapshotEnv();
  clearEnv();
  process.env.AMBER_RETELL_ENABLED = "true";
  process.env.RETELL_API_KEY = "k";
  const recorder = { calls: [], agents: [] };
  setRetellClientFactory(makeFakeClient(recorder));
  try {
    const res = await createPhoneCall({ toNumber: "+14155550199" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_from_number");
    assert.equal(recorder.calls.length, 0);
  } finally {
    setRetellClientFactory(null);
    restoreEnv(prev);
  }
});

// ── createPhoneCall — happy path with mocked SDK ────────────────────────

test("createPhoneCall: enabled + key → SDK payload shape is correct", async () => {
  const prev = snapshotEnv();
  clearEnv();
  process.env.AMBER_RETELL_ENABLED = "true";
  process.env.RETELL_API_KEY = "test_secret_value_aaaaaaa";
  process.env.RETELL_FROM_NUMBER = "+14155550100";
  process.env.RETELL_AGENT_ID = "agent_default";
  const recorder = { calls: [], agents: [] };
  setRetellClientFactory(makeFakeClient(recorder));
  const log = captureLogs();
  try {
    const res = await createPhoneCall({
      toNumber: "+14155550199",
      dynamicVariables: {
        tenant: { firstName: "Caleb", phoneNumber: "+14155550100", agentName: "camber" },
        contact: { firstName: "Mira" },
        role: "scheduler",
        objective: "confirm dinner 7pm",
        safetyMode: "safe",
      },
      metadata: { tenantDid: "did:privy:abc" },
    });
    assert.equal(res.ok, true);
    assert.equal(res.callId, "call_test_123");
    assert.equal(recorder.calls.length, 1);
    const payload = recorder.calls[0];
    assert.equal(payload.from_number, "+14155550100");
    assert.equal(payload.to_number, "+14155550199");
    assert.equal(payload.override_agent_id, "agent_default");
    assert.equal(payload.retell_llm_dynamic_variables.role, "scheduler");
    assert.equal(payload.retell_llm_dynamic_variables.contact_name, "Mira");
    assert.equal(payload.metadata.tenantDid, "did:privy:abc");
    // SDK was built with the raw key — that's how the SDK works — but
    // the key must never have hit a log line.
    assert.equal(recorder.builtWith, "test_secret_value_aaaaaaa");
    const blob = log.lines.join("\n");
    assert.ok(!blob.includes("test_secret_value_aaaaaaa"), "raw key leaked into logs");
    // Phone numbers should also be redacted in logs.
    assert.ok(!blob.includes("+14155550199"), "raw to_number leaked into logs");
    assert.ok(!blob.includes("+14155550100"), "raw from_number leaked into logs");
    assert.ok(blob.includes("…0199") || blob.includes("..0199") || blob.includes("0199"));
  } finally {
    log.restore();
    setRetellClientFactory(null);
    restoreEnv(prev);
  }
});

test("createPhoneCall: caller can pass a pre-built flat string map", async () => {
  const prev = snapshotEnv();
  clearEnv();
  process.env.AMBER_RETELL_ENABLED = "true";
  process.env.RETELL_API_KEY = "k";
  process.env.RETELL_FROM_NUMBER = "+14155550100";
  const recorder = { calls: [], agents: [] };
  setRetellClientFactory(makeFakeClient(recorder));
  try {
    const res = await createPhoneCall({
      toNumber: "+14155550199",
      dynamicVariables: {
        agent_name: "samber",
        role: "concierge",
        objective: "remind about dentist",
      },
    });
    assert.equal(res.ok, true);
    const payload = recorder.calls[0];
    assert.deepEqual(payload.retell_llm_dynamic_variables, {
      agent_name: "samber",
      role: "concierge",
      objective: "remind about dentist",
    });
  } finally {
    setRetellClientFactory(null);
    restoreEnv(prev);
  }
});

test("createPhoneCall: SDK error surfaces as ok:false (does not throw)", async () => {
  const prev = snapshotEnv();
  clearEnv();
  process.env.AMBER_RETELL_ENABLED = "true";
  process.env.RETELL_API_KEY = "secret_key_value_qqqqqqq";
  process.env.RETELL_FROM_NUMBER = "+14155550100";
  setRetellClientFactory(async () => ({
    call: {
      async createPhoneCall() {
        // Simulate the SDK echoing the key in an error message — adapter
        // must scrub before logging or returning.
        throw new Error("upstream 401 for key=secret_key_value_qqqqqqq");
      },
    },
    agent: { async create() { throw new Error("nope"); } },
  }));
  const log = captureLogs();
  try {
    const res = await createPhoneCall({ toNumber: "+14155550199" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "api_error");
    assert.ok(res.detail.includes("[redacted]"));
    assert.ok(!res.detail.includes("secret_key_value_qqqqqqq"));
    const blob = log.lines.join("\n");
    assert.ok(!blob.includes("secret_key_value_qqqqqqq"));
  } finally {
    log.restore();
    setRetellClientFactory(null);
    restoreEnv(prev);
  }
});

// ── createAgent — also flag-gated ─────────────────────────────

test("createAgent: disabled by default", async () => {
  const prev = snapshotEnv();
  clearEnv();
  const recorder = { calls: [], agents: [] };
  setRetellClientFactory(makeFakeClient(recorder));
  try {
    const res = await createAgent({ voice_id: "v1" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "feature_flag_off");
    assert.equal(recorder.agents.length, 0);
  } finally {
    setRetellClientFactory(null);
    restoreEnv(prev);
  }
});

test("createAgent: enabled + key → spec is forwarded", async () => {
  const prev = snapshotEnv();
  clearEnv();
  process.env.AMBER_RETELL_ENABLED = "true";
  process.env.RETELL_API_KEY = "k";
  const recorder = { calls: [], agents: [] };
  setRetellClientFactory(makeFakeClient(recorder));
  try {
    const res = await createAgent({ voice_id: "v1", llm_websocket_url: "wss://x" });
    assert.equal(res.ok, true);
    assert.equal(res.agentId, "agent_test_456");
    assert.equal(recorder.agents.length, 1);
    assert.equal(recorder.agents[0].voice_id, "v1");
  } finally {
    setRetellClientFactory(null);
    restoreEnv(prev);
  }
});
