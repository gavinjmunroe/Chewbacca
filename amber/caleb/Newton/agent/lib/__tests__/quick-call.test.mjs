/**
 * Tests for the pure quick-call helpers.
 *
 * Run with:  node --test Newton/agent/lib/__tests__/quick-call.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateQuickCallInput,
  buildQuickCallEnvelope,
  fetchCallerIdentity,
  QUICK_CALL_LIMITS,
} from "../quick-call.js";

test("validateQuickCallInput accepts a normal string and trims it", () => {
  const r = validateQuickCallInput({ text: "  hello medha  " });
  assert.equal(r.ok, true);
  assert.equal(r.text, "hello medha");
});

test("validateQuickCallInput rejects missing/empty text", () => {
  assert.equal(validateQuickCallInput({}).ok, false);
  assert.equal(validateQuickCallInput({ text: "" }).ok, false);
  assert.equal(validateQuickCallInput({ text: "   " }).ok, false);
  assert.equal(validateQuickCallInput(null).ok, false);
});

test("validateQuickCallInput rejects non-string text", () => {
  const r = validateQuickCallInput({ text: 42 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.error, "text_required");
});

test("validateQuickCallInput rejects text past the max", () => {
  const big = "a".repeat(QUICK_CALL_LIMITS.MAX_TEXT + 1);
  const r = validateQuickCallInput({ text: big });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.error, "text_too_long");
  assert.equal(r.max, QUICK_CALL_LIMITS.MAX_TEXT);
});

test("buildQuickCallEnvelope mirrors a real Loop inbound shape", () => {
  const env = buildQuickCallEnvelope({
    phoneNumber: "+13105550100",
    loopSenderId: "loop-sender-uuid",
    text: "hello",
    messageId: "qc-test-1",
  });
  assert.equal(env.event, "message_inbound");
  assert.equal(env.contact, "+13105550100"); // caller's own phone
  assert.equal(env.sender, "loop-sender-uuid"); // caller's own Loop sender
  assert.equal(env.text, "hello");
  assert.equal(env.group_id, null);
  assert.equal(env.message_id, "qc-test-1");
  assert.equal(env.source, "quick-call");
});

test("buildQuickCallEnvelope refuses to synthesize without identity", () => {
  assert.throws(
    () =>
      buildQuickCallEnvelope({
        phoneNumber: null,
        loopSenderId: "x",
        text: "y",
      }),
    /phoneNumber required/,
  );
  assert.throws(
    () =>
      buildQuickCallEnvelope({
        phoneNumber: "+1",
        loopSenderId: null,
        text: "y",
      }),
    /loopSenderId required/,
  );
});

test("buildQuickCallEnvelope generates a quick-call-prefixed id when none passed", () => {
  const env = buildQuickCallEnvelope({
    phoneNumber: "+13105550100",
    loopSenderId: "loop-sender",
    text: "hi",
  });
  assert.match(env.message_id, /^quick-call-/);
});

test("fetchCallerIdentity returns 500 when AMBER_ID_API_URL is unset", async () => {
  const r = await fetchCallerIdentity({
    apiUrl: null,
    authorization: "Bearer x",
    fetchImpl: async () => {
      throw new Error("should not call");
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 500);
});

test("fetchCallerIdentity returns 401 when Authorization is absent", async () => {
  const r = await fetchCallerIdentity({
    apiUrl: "http://amber-id.test",
    authorization: "",
    fetchImpl: async () => {
      throw new Error("should not call");
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test("fetchCallerIdentity forwards the Bearer token to /v1/me", async () => {
  let captured = null;
  const fetchImpl = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        phoneNumber: "+13105550100",
        loopSenderId: "loop-sender-uuid",
      }),
    };
  };
  const r = await fetchCallerIdentity({
    apiUrl: "http://amber-id.test",
    authorization: "Bearer abc.def.ghi",
    fetchImpl,
  });
  assert.equal(r.ok, true);
  assert.equal(r.phoneNumber, "+13105550100");
  assert.equal(r.loopSenderId, "loop-sender-uuid");
  assert.equal(captured.url, "http://amber-id.test/v1/me");
  assert.equal(captured.opts.headers.Authorization, "Bearer abc.def.ghi");
});

test("fetchCallerIdentity surfaces the DID for identity assertion", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      phoneNumber: "+13105550100",
      loopSenderId: "loop-sender-uuid",
      did: "did:privy:abc123",
    }),
  });
  const r = await fetchCallerIdentity({
    apiUrl: "http://amber-id.test",
    authorization: "Bearer x",
    fetchImpl,
  });
  assert.equal(r.ok, true);
  assert.equal(r.did, "did:privy:abc123");
});

test("fetchCallerIdentity maps 401 from amber-id to a 401 response", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    json: async () => ({}),
  });
  const r = await fetchCallerIdentity({
    apiUrl: "http://amber-id.test",
    authorization: "Bearer x",
    fetchImpl,
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
  assert.equal(r.error, "amber_id_rejected_token");
});

test("fetchCallerIdentity returns 424 when caller has no phone or sender", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ phoneNumber: null, loopSenderId: null }),
  });
  const r = await fetchCallerIdentity({
    apiUrl: "http://amber-id.test",
    authorization: "Bearer x",
    fetchImpl,
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 424);
  assert.equal(r.error, "caller_not_provisioned");
});

test("fetchCallerIdentity returns 502 when amber-id is unreachable", async () => {
  const fetchImpl = async () => {
    throw new Error("ECONNREFUSED");
  };
  const r = await fetchCallerIdentity({
    apiUrl: "http://amber-id.test",
    authorization: "Bearer x",
    fetchImpl,
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 502);
  assert.equal(r.error, "amber_id_unreachable");
});
