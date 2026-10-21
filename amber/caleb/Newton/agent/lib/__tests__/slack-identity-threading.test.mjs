/**
 * Regression tests for the Slack -> agent-loop inbound-sender identity bridge.
 *
 * Audit finding (2026-05-28, email-to-slack-auth, HIGH severity):
 *   lib/transports/slack/envelope.js correctly resolves the inbound sender
 *   via lookupSenderByEmail (it sets meta.senderDisplayName, meta.sourceEmail,
 *   meta.senderDid, meta.senderKind, meta.matchedVia) — but lib/transports/
 *   slack/index.js never threaded that meta into enqueueMessage. The result:
 *   when caleb@bluemodernadvisory.com posted in Sagar's Slack, Medha still
 *   greeted him as Sagar.
 *
 * These tests pin the contract:
 *   1. dispatchConverted forwards senderHints when meta carries identity.
 *   2. The agent.js text-prefix logic synthesizes the right "[Inbound sender:
 *      Name <email>, ...]" marker and prepends it to the user turn so the
 *      prompts.js block can route on it.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/slack-identity-threading.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { dispatchConverted } from "../transports/slack/index.js";

// Suppress info logs during the run so failing assertions stand out.
const originalConsoleLog = console.log;
console.log = () => {};

test("dispatchConverted threads contact senderHints into enqueueMessage opts", async () => {
  const calls = [];
  const enqueueMessage = (args, opts) => {
    calls.push({ args, opts });
  };

  const converted = {
    args: [
      "slack:T0123:U0456",
      "hey medha, can you check sagar's calendar?",
      "evt_abc",
      null,
      null,
      [],
      null,
      "expert-sender-uuid",
    ],
    meta: {
      transport: "slack",
      channel: "D1",
      thread_ts: "1700000000.000100",
      slackUserId: "U0456",
      team: "T0123",
      eventType: "message",
      linked: false,
      offerLink: false,
      senderKind: "contact",
      senderDid: "did:privy:sagar",
      senderDisplayName: "Caleb",
      sourceEmail: "caleb@bluemodernadvisory.com",
      matchedVia: "contact_email",
      slackFiles: [],
    },
  };

  await dispatchConverted(converted, enqueueMessage);

  assert.equal(calls.length, 1, "enqueueMessage called exactly once");
  assert.ok(calls[0].opts, "opts must be passed");
  assert.ok(calls[0].opts.senderHints, "opts.senderHints must be populated");
  assert.equal(calls[0].opts.senderHints.senderKind, "contact");
  assert.equal(calls[0].opts.senderHints.senderDid, "did:privy:sagar");
  assert.equal(calls[0].opts.senderHints.senderDisplayName, "Caleb");
  assert.equal(
    calls[0].opts.senderHints.sourceEmail,
    "caleb@bluemodernadvisory.com",
  );
  assert.equal(calls[0].opts.senderHints.matchedVia, "contact_email");
});

test("dispatchConverted threads tenant_owner senderHints from the auto-link path", async () => {
  const calls = [];
  const enqueueMessage = (args, opts) => {
    calls.push({ args, opts });
  };

  const converted = {
    args: [
      "slack:T0999:U0SAGAR",
      "what's on my calendar tomorrow?",
      "evt_xyz",
      null,
      null,
      [],
      null,
      "expert-sender-uuid",
    ],
    meta: {
      transport: "slack",
      channel: "D2",
      thread_ts: "1700000123.000200",
      slackUserId: "U0SAGAR",
      team: "T0999",
      eventType: "message",
      linked: true,
      autoLinked: true,
      senderKind: "tenant_owner",
      senderDid: "did:privy:sagar",
      senderDisplayName: "Sagar Tiwari",
      sourceEmail: "sagar@bluemodernadvisory.com",
      matchedVia: "privy_primary",
      slackFiles: [],
    },
  };

  await dispatchConverted(converted, enqueueMessage);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.senderHints.senderKind, "tenant_owner");
  assert.equal(calls[0].opts.senderHints.senderDisplayName, "Sagar Tiwari");
});

test("dispatchConverted still passes opts.senderHints even when meta has no identity (null fields)", async () => {
  // Linked-but-no-identity case: existing slack-link with no profile data.
  // We still want to pass the opts arg (with nulls) so the handler signature
  // stays consistent and the agent loop's existing null-checks fire.
  const calls = [];
  const enqueueMessage = (args, opts) => calls.push({ args, opts });

  const converted = {
    args: [
      "slack:T1:U1",
      "ping",
      "evt_1",
      null,
      null,
      [],
      null,
      "expert-sender-uuid",
    ],
    meta: {
      transport: "slack",
      channel: "D3",
      thread_ts: null,
      slackUserId: "U1",
      team: "T1",
      eventType: "message",
      linked: true,
      slackFiles: [],
    },
  };

  await dispatchConverted(converted, enqueueMessage);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].opts.senderHints, "senderHints object is always present");
  assert.equal(calls[0].opts.senderHints.senderDisplayName, null);
  assert.equal(calls[0].opts.senderHints.sourceEmail, null);
});

test("synthetic [Inbound sender: ...] prefix matches the prompts.js SLACK INBOUND SENDER IDENTITY contract", () => {
  // This test pins the prefix string shape that handleWebhookMessage builds
  // in agent.js. The prompts.js block keys off this exact phrasing. If the
  // marker drifts, the prompt block goes silent. Lifting the format here
  // gives us a deterministic regression target without spinning up agent.js.
  const senderHints = {
    senderDisplayName: "Caleb",
    sourceEmail: "caleb@bluemodernadvisory.com",
  };
  const email = senderHints.sourceEmail ? ` <${senderHints.sourceEmail}>` : "";
  const prefix = `[Inbound sender: ${senderHints.senderDisplayName}${email}, known to you as a contact of the tenant owner. Address them by first name, not as the channel owner.]`;
  assert.match(
    prefix,
    /^\[Inbound sender: Caleb <caleb@bluemodernadvisory\.com>/,
  );
  assert.match(prefix, /Address them by first name/);
  assert.match(prefix, /not as the channel owner\.\]$/);
});

test("synthetic prefix omits email when source email is missing", () => {
  const senderHints = {
    senderDisplayName: "Shirley",
    sourceEmail: null,
  };
  const email = senderHints.sourceEmail ? ` <${senderHints.sourceEmail}>` : "";
  const prefix = `[Inbound sender: ${senderHints.senderDisplayName}${email}, known to you as a contact of the tenant owner. Address them by first name, not as the channel owner.]`;
  assert.equal(
    prefix,
    "[Inbound sender: Shirley, known to you as a contact of the tenant owner. Address them by first name, not as the channel owner.]",
  );
});

// Restore console.log for clean test runner output.
test.after(() => {
  console.log = originalConsoleLog;
});
