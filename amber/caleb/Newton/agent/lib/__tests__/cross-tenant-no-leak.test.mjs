/**
 * PR-I cross-tenant regression: the Caleb-vs-Sagar concern.
 *
 * Background: Caleb reported a possible cross-tenant leak in May 2026 —
 * a message intended for Caleb at +15550100002 may have also reached
 * Sagar at +15550100004. Static review showed no live path that could
 * deliver to a different phone, but rave-master had previously held a
 * hardcoded SAGAR_PHONE constant. This test pins the current safe
 * shape so a future refactor can't regress without the test catching
 * it.
 *
 * Two scenarios:
 *
 *   1. Rave-master is OFF by default (RAVE_MASTER_ENABLED != "1"). An
 *      inbound from Caleb to the Caleb tenant must produce
 *      `handled: false` from handleRaveInbound, meaning no rave-master
 *      send fires AT ALL — let alone to Sagar.
 *
 *   2. A direct sendMessage to Caleb's phone for the Caleb tenant
 *      logs the structured audit line with `to=+15550100002` and
 *      `match_owner=true`, with no cross-tenant WARN. If a future code
 *      path ever passed `to=+15550100004` while the Caleb tenant was
 *      resolved, the same audit pass would emit a cross-tenant WARN
 *      and the regression would surface immediately in Railway logs.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/cross-tenant-no-leak.test.mjs
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const CALEB_PHONE = "+15550100002";
const SAGAR_PHONE = "+15550100004";

// Ensure rave-master is OFF for this test regardless of the shell env.
const priorRaveEnabled = process.env.RAVE_MASTER_ENABLED;
delete process.env.RAVE_MASTER_ENABLED;

// Force loop transport. We never let it make a real Loop call because
// the test injects its own deps.sendMessage into handleRaveInbound and
// stubs fetch for the transport test.
process.env.LOOP_API_KEY = process.env.LOOP_API_KEY || "test-loop-key";

const { handleRaveInbound } = await import("../rave-master/index.js");
const { sendMessage, _resetOutboundAuditState } =
  await import("../transport.js");

const calebTenant = {
  id: "did:privy:caleb",
  phoneNumber: CALEB_PHONE,
  loopSenderId: "sender-uuid-camber",
  displayName: "Camber",
};

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

beforeEach(() => {
  _resetOutboundAuditState();
});

afterEach(() => {
  if (priorRaveEnabled !== undefined) {
    process.env.RAVE_MASTER_ENABLED = priorRaveEnabled;
  } else {
    delete process.env.RAVE_MASTER_ENABLED;
  }
});

test("rave-master pre-LLM gate: Caleb inbound to Caleb tenant returns handled=false (no send fires)", async () => {
  // Inject sendMessage so any attempted send is observable. We expect
  // zero calls because the gate short-circuits before any rave-master
  // branch runs.
  const sends = [];
  const fakeSend = async (to, body, opts) => {
    sends.push({ to, body, opts });
    return { ok: true };
  };

  const result = await handleRaveInbound({
    tenant: calebTenant,
    fromHandle: CALEB_PHONE,
    text: "Here is your cat",
    isOwner: true,
    isGroup: false,
    groupId: null,
    sendOpts: {
      tenant: calebTenant,
      auditOrigin: "webhook",
      webhookContact: CALEB_PHONE,
    },
    _deps: {
      sendMessage: fakeSend,
      loadEventCard: async () => ({}),
      saveEventCard: async () => {},
      storeRaveInbound: async () => {},
    },
  });

  assert.equal(
    result?.handled,
    false,
    "rave-master must not claim the turn when disabled",
  );
  assert.equal(
    sends.length,
    0,
    `rave-master must not fire any send (got ${sends.length} sends to: ${sends
      .map((s) => s.to)
      .join(", ")})`,
  );
});

test("transport audit pins the only safe target: a reply to Caleb logs match_owner=true and no WARN to Sagar", async () => {
  // Stub fetch so the transport doesn't try to reach Loop. The audit
  // pass runs BEFORE the fetch, so the assertions still hold even if
  // the fake fetch returns ok.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true, message_id: "msg" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const cap = makeCapture();
  try {
    await sendMessage(CALEB_PHONE, "Here is your cat", {
      tenant: calebTenant,
      auditOrigin: "webhook",
      webhookContact: CALEB_PHONE,
    });
  } finally {
    cap.restore();
    globalThis.fetch = originalFetch;
  }

  const auditLine = cap.log.find((l) => l.startsWith("[outbound-audit]"));
  assert.ok(auditLine, "expected an [outbound-audit] info log line");
  assert.match(auditLine, new RegExp(`to=\\${CALEB_PHONE}`));
  assert.match(auditLine, /match_owner=true/);

  // The canary: no WARN to Sagar's phone should appear anywhere in this
  // turn. If a future code path were to also fire a sendMessage to
  // SAGAR_PHONE for the Caleb tenant, that send would produce a
  // [outbound-audit][cross-tenant] WARN with to=+15550100004 and the
  // assertion below would fail loudly.
  const sagarLeak = cap.warn.find(
    (l) =>
      l.includes("[outbound-audit][cross-tenant]") && l.includes(SAGAR_PHONE),
  );
  assert.equal(
    sagarLeak,
    undefined,
    "regression: a send to Sagar's phone leaked while replying to Caleb",
  );
});
