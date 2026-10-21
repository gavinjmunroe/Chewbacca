/**
 * Tests for the refresh-failure alarm.
 *
 * Run: node --test Newton/agent/lib/__tests__/refresh-failure-alarm.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  recordToolError,
  __internals,
} from "../middleware/refresh-failure-alarm.js";

test("detectProvider recognizes <provider>_refresh", () => {
  assert.equal(__internals.detectProvider("twitter_refresh"), "twitter");
  assert.equal(__internals.detectProvider("gcal_token_refresh"), "gcal");
});

test("detectProvider recognizes refresh_<provider>_token", () => {
  assert.equal(__internals.detectProvider("refresh_railway_token"), "railway");
  assert.equal(__internals.detectProvider("refresh_github_token"), "github");
});

test("detectProvider returns null for non-refresh tools", () => {
  assert.equal(__internals.detectProvider("list_events"), null);
  assert.equal(__internals.detectProvider("gmail_search"), null);
  assert.equal(__internals.detectProvider(null), null);
  assert.equal(__internals.detectProvider(""), null);
});

test("does NOT alarm on first few failures", () => {
  __internals.reset();
  for (let i = 0; i < 4; i++) {
    recordToolError("twitter_refresh", "did:test:a", "invalid_request");
  }
  const entry = __internals.state.get("did:test:a::twitter");
  assert.equal(entry.failures.length, 4);
  assert.equal(entry.lastAlertAt, 0, "should not have alerted yet");
});

test("alarm fires exactly once when threshold crossed; cooldown holds", () => {
  __internals.reset();
  // 5th failure trips the alarm
  for (let i = 0; i < 5; i++) {
    recordToolError("twitter_refresh", "did:test:a", "invalid_request");
  }
  const entry = __internals.state.get("did:test:a::twitter");
  assert.ok(entry.lastAlertAt > 0, "alert timestamp should be recorded");

  const firstAlertAt = entry.lastAlertAt;
  // Additional failures during cooldown must not move lastAlertAt
  for (let i = 0; i < 20; i++) {
    recordToolError("twitter_refresh", "did:test:a", "invalid_request");
  }
  assert.equal(
    entry.lastAlertAt,
    firstAlertAt,
    "cooldown should suppress repeat alerts",
  );
});

test("per-(tenant, provider) isolation: A's twitter does not affect B's twitter or A's gcal", () => {
  __internals.reset();
  for (let i = 0; i < 5; i++) {
    recordToolError("twitter_refresh", "did:test:a", "invalid_request");
  }
  // B's twitter bucket should still be empty
  assert.equal(__internals.state.has("did:test:b::twitter"), false);
  // A's gcal bucket should still be empty
  assert.equal(__internals.state.has("did:test:a::gcal"), false);
});

test("disabled when MEDHA_REFRESH_ALARM_DISABLED=1", () => {
  __internals.reset();
  const prev = process.env.MEDHA_REFRESH_ALARM_DISABLED;
  process.env.MEDHA_REFRESH_ALARM_DISABLED = "1";
  try {
    for (let i = 0; i < 50; i++) {
      recordToolError("twitter_refresh", "did:test:a", "invalid_request");
    }
    assert.equal(
      __internals.state.has("did:test:a::twitter"),
      false,
      "no state should accumulate when disabled",
    );
  } finally {
    if (prev === undefined) delete process.env.MEDHA_REFRESH_ALARM_DISABLED;
    else process.env.MEDHA_REFRESH_ALARM_DISABLED = prev;
  }
});

test("non-refresh tool errors do not accumulate state", () => {
  __internals.reset();
  recordToolError("list_events", "did:test:a", "rate limited");
  recordToolError("gmail_search", "did:test:a", "boom");
  assert.equal(__internals.state.size, 0);
});
