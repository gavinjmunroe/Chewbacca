/**
 * Tests for the structured SSE frame builders (Tab 14, items 191 + 199).
 *
 * Run with:  node --test Newton/agent/lib/__tests__/stream-frames.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildStreamError,
  statusToStreamErrorCode,
  toolProgressLabel,
  buildProgressFrame,
  STREAM_ERROR_REGISTRY,
} from "../stream-frames.js";

test("buildStreamError returns the registry copy + retryable for a known code", () => {
  const f = buildStreamError("empty_response");
  assert.equal(f.error, "empty_response");
  assert.equal(f.retryable, true);
  assert.equal(f.message, STREAM_ERROR_REGISTRY.empty_response.message);
});

test("buildStreamError marks mint / upgrade codes as NOT retryable", () => {
  assert.equal(buildStreamError("identity_not_minted").retryable, false);
  assert.equal(buildStreamError("entitlement_required").retryable, false);
});

test("buildStreamError defaults unknown codes to a retryable generic envelope", () => {
  const f = buildStreamError("some_code_we_never_defined");
  assert.equal(f.error, "some_code_we_never_defined");
  assert.equal(f.retryable, true);
  assert.ok(f.message.length > 0);
});

test("buildStreamError falls back to agent_failed for a missing code", () => {
  const f = buildStreamError(undefined);
  assert.equal(f.error, "agent_failed");
  assert.equal(f.retryable, true);
});

test("buildStreamError accepts a message override and truncates detail", () => {
  const f = buildStreamError("agent_failed", {
    message: "custom copy",
    detail: "x".repeat(500),
  });
  assert.equal(f.message, "custom copy");
  assert.equal(f.detail.length, 300);
});

test("no error frame copy ships an em dash or emoji", () => {
  for (const [, v] of Object.entries(STREAM_ERROR_REGISTRY)) {
    assert.ok(!/[—–]/.test(v.message), `em dash in: ${v.message}`);
    // crude emoji check across the common pictograph ranges
    assert.ok(
      !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(v.message),
      `emoji in: ${v.message}`,
    );
  }
});

test("statusToStreamErrorCode maps identity / entitlement / rate / timeout", () => {
  assert.equal(
    statusToStreamErrorCode(424, "caller_not_provisioned"),
    "identity_not_minted",
  );
  assert.equal(
    statusToStreamErrorCode(401, "amber_id_rejected_token"),
    "identity_not_minted",
  );
  assert.equal(
    statusToStreamErrorCode(402, "entitlement_required"),
    "entitlement_required",
  );
  assert.equal(statusToStreamErrorCode(429, "too_many"), "rate_limited");
  assert.equal(statusToStreamErrorCode(504, "timeout"), "timeout");
  assert.equal(
    statusToStreamErrorCode(502, "amber_id_error"),
    "upstream_unavailable",
  );
  assert.equal(statusToStreamErrorCode(500, "boom"), "agent_failed");
});

test("toolProgressLabel maps each tool family to a human phrase", () => {
  assert.equal(toolProgressLabel("gcal_list_events"), "Checking your calendar");
  assert.equal(toolProgressLabel("schedule_event"), "Checking your calendar");
  assert.equal(toolProgressLabel("gmail_search"), "Reading your email");
  assert.equal(toolProgressLabel("drive_search"), "Looking through your Drive");
  assert.equal(toolProgressLabel("web_search"), "Searching the web");
  assert.equal(toolProgressLabel("deep_research"), "Searching the web");
  assert.equal(toolProgressLabel("people_rank"), "Searching your network");
  assert.equal(toolProgressLabel("reminders_add"), "Checking your reminders");
  assert.equal(
    toolProgressLabel("recall_by_dimension"),
    "Looking through what I remember",
  );
});

test("toolProgressLabel never returns an empty string", () => {
  assert.equal(toolProgressLabel("totally_unknown_tool"), "Working on it");
  assert.equal(toolProgressLabel(""), "Working on it");
  assert.equal(toolProgressLabel(undefined), "Working on it");
});

test("buildProgressFrame defaults a missing phase/label safely", () => {
  assert.deepEqual(buildProgressFrame("tool", "Checking your calendar"), {
    phase: "tool",
    label: "Checking your calendar",
  });
  assert.deepEqual(buildProgressFrame(), {
    phase: "thinking",
    label: "Thinking",
  });
});
