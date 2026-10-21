/**
 * PR-I outbound audit tests.
 *
 * Verifies that every sendMessage call emits a structured
 * `[outbound-audit]` line, that sends targeting neither the resolved
 * tenant owner nor the current webhook contact escalate to a
 * `[outbound-audit][cross-tenant]` WARN, and that the per-minute counter
 * fires the `[outbound-audit][alert]` ERROR when 5+ cross-tenant sends
 * happen in any rolling 60 s window.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/outbound-audit.test.mjs
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Stub the network sender BEFORE importing transport.js so we never make
// a real Loop request. We swap the fetch global for the duration of the
// test and restore it after.
const originalFetch = globalThis.fetch;

async function fakeFetchOk() {
  return new Response(JSON.stringify({ ok: true, message_id: "msg-test" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Capture console output so assertions can inspect the audit lines.
function makeCapture() {
  const log = [];
  const warn = [];
  const error = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args) => log.push(args.join(" "));
  console.warn = (...args) => warn.push(args.join(" "));
  console.error = (...args) => error.push(args.join(" "));
  return {
    log,
    warn,
    error,
    restore() {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    },
  };
}

// Force loop transport (default). LOOP_API_KEY just needs to be set so
// the module's constants resolve; we stub fetch so no network goes out.
process.env.LOOP_API_KEY = process.env.LOOP_API_KEY || "test-loop-key";

const { sendMessage, _resetOutboundAuditState } =
  await import("../transport.js");

const tenant = {
  id: "did:privy:owner-1",
  phoneNumber: "+15550100002", // Caleb in the real-world incident
  loopSenderId: "sender-uuid-1",
};

beforeEach(() => {
  globalThis.fetch = fakeFetchOk;
  _resetOutboundAuditState();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("sendMessage to tenant.phoneNumber logs SAFE match_owner=true and no WARN", async () => {
  const cap = makeCapture();
  try {
    await sendMessage(tenant.phoneNumber, "hello owner", {
      tenant,
      auditOrigin: "scheduled",
    });
  } finally {
    cap.restore();
  }
  const auditLine = cap.log.find((l) => l.startsWith("[outbound-audit]"));
  assert.ok(auditLine, "expected an [outbound-audit] info log line");
  assert.match(auditLine, /match_owner=true/);
  assert.match(auditLine, /origin=scheduled/);
  const crossTenantWarn = cap.warn.find((l) =>
    l.includes("[outbound-audit][cross-tenant]"),
  );
  assert.equal(crossTenantWarn, undefined, "should not emit cross-tenant WARN");
});

test("sendMessage to inbound webhook contact logs SAFE match_webhook_contact=true and no WARN", async () => {
  const cap = makeCapture();
  const webhookContact = "+14155551234"; // stranger who texted us
  try {
    await sendMessage(webhookContact, "got your message", {
      tenant,
      auditOrigin: "webhook",
      webhookContact,
    });
  } finally {
    cap.restore();
  }
  const auditLine = cap.log.find((l) => l.startsWith("[outbound-audit]"));
  assert.ok(auditLine, "expected an [outbound-audit] info log line");
  assert.match(auditLine, /match_webhook_contact=true/);
  assert.match(auditLine, /origin=webhook/);
  const crossTenantWarn = cap.warn.find((l) =>
    l.includes("[outbound-audit][cross-tenant]"),
  );
  assert.equal(crossTenantWarn, undefined, "should not emit cross-tenant WARN");
});

test("sendMessage to a phone matching neither owner nor webhook contact emits cross-tenant WARN", async () => {
  const cap = makeCapture();
  const webhookContact = "+14155551234";
  const unrelatedThirdParty = "+15550100004"; // Sagar in the real-world incident
  try {
    await sendMessage(unrelatedThirdParty, "leak target", {
      tenant,
      auditOrigin: "webhook",
      webhookContact,
    });
  } finally {
    cap.restore();
  }
  const crossTenantWarn = cap.warn.find((l) =>
    l.includes("[outbound-audit][cross-tenant]"),
  );
  assert.ok(crossTenantWarn, "expected cross-tenant WARN");
  assert.match(crossTenantWarn, /match_owner=false/);
  assert.match(crossTenantWarn, /match_webhook_contact=false/);
  assert.match(crossTenantWarn, /to=\+15550100004/);
});

test("6 cross-tenant sends within one minute fire the [outbound-audit][alert] ERROR", async () => {
  const cap = makeCapture();
  try {
    for (let i = 0; i < 6; i++) {
      await sendMessage("+1888000" + String(1000 + i).padStart(4, "0"), "x", {
        tenant,
        auditOrigin: "unknown",
        // Force uniqueness so the transport idempotency 60 s window
        // doesn't suppress these as duplicates.
        idempotencyKey: `audit-test-${i}-${Math.random()}`,
      });
    }
  } finally {
    cap.restore();
  }
  const alertLine = cap.error.find((l) =>
    l.includes("[outbound-audit][alert]"),
  );
  assert.ok(alertLine, "expected an [outbound-audit][alert] ERROR line");
  assert.match(alertLine, /cross-tenant send rate elevated/);
});
