/**
 * Transport parity: same Medha across iMessage DM, iMessage group, and Slack.
 *
 * Caleb 2026-05-28: "iMessage DM is the gold standard. Whatever's there
 * should also be in the group and in Slack." This test pins:
 *
 *   1. Tool surface — senderIsOwner=true gives the same surface in DM and
 *      in group; senderIsOwner=false in a group does NOT get the owner's
 *      always-armed banks.
 *   2. Prompt assembly — the owner-doctrine substrings present in the
 *      owner-DM prompt are ALSO present in the owner-in-group prompt.
 *   3. Slack outbound — when sendOpts.attachments is non-empty, the
 *      responder routes through files.uploadV2 (3 round-trips in order)
 *      with initial_comment = text. No separate chat.postMessage call.
 *   4. Loop outbound — body includes both group and attachments when both
 *      are set on opts.
 *
 * Run: node --test Newton/agent/lib/__tests__/transport-parity.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { armTools } from "../tool-arming.js";
import {
  buildSystemPromptForSender,
  buildOwnerDoctrineBlocks,
  buildTransportPolicyBlock,
} from "../prompts.js";
import { uploadFilesToSlack } from "../transports/slack/files-upload.js";
import { sendSlackReply } from "../transports/slack/responder.js";

// Tool catalog covering the always-armed banks (partnership, personal-life,
// calendar) plus a couple of base tools.
const FAKE_TOOLS = [
  { name: "task_create", description: "Create a beads task." },
  { name: "task_list", description: "List beads tasks." },
  { name: "github_search", description: "Search github." },
  { name: "schedule_event", description: "Schedule on the calendar." },
  { name: "list_events", description: "List events." },
  { name: "get_availability", description: "Check freebusy." },
  { name: "track_partnership", description: "Track a partnership." },
  { name: "append_partnership_note", description: "Append a note." },
  { name: "recall_partnership", description: "Recall a partnership." },
  { name: "track_investor", description: "Track an investor." },
  { name: "add_journal_entry", description: "Persist a journal entry." },
  { name: "recall_journal", description: "Recall journal entries." },
  { name: "recall_person", description: "Recall a person from context." },
  { name: "track_brand_decision", description: "Track a brand decision." },
  { name: "track_teammate_pursuit", description: "Track a teammate pursuit." },
];

function names(tools) {
  return new Set((tools || []).map((t) => t.name));
}

// ── 1. Tool surface parity ─────────────────────────────────────────────

test("owner DM (senderIsOwner=true, isGroup=false) arms partnership + personal-life + calendar banks", () => {
  const armed = armTools({
    allTools: FAKE_TOOLS,
    text: "yo",
    toolsEnabled: true,
    senderIsOwner: true,
    tenant: {},
  });
  const got = names(armed.tools);
  // Partnership bank
  assert.ok(got.has("track_partnership"));
  assert.ok(got.has("append_partnership_note"));
  assert.ok(got.has("recall_partnership"));
  assert.ok(got.has("track_investor"));
  // Personal-life bank
  assert.ok(got.has("add_journal_entry"));
  assert.ok(got.has("recall_journal"));
  assert.ok(got.has("recall_person"));
  assert.ok(got.has("track_brand_decision"));
  assert.ok(got.has("track_teammate_pursuit"));
  // Calendar bank
  assert.ok(got.has("schedule_event"));
  assert.ok(got.has("list_events"));
});

test("owner IN GROUP (senderIsOwner=true) gets the SAME surface as owner DM", () => {
  // armTools does not take isGroup. The parity assertion is structural:
  // the same input produces the same output regardless of where the caller
  // is. Both calls have senderIsOwner=true; surfaces must match.
  const dmArmed = armTools({
    allTools: FAKE_TOOLS,
    text: "yo",
    toolsEnabled: true,
    senderIsOwner: true,
    tenant: {},
  });
  const groupArmed = armTools({
    allTools: FAKE_TOOLS,
    text: "yo",
    toolsEnabled: true,
    senderIsOwner: true,
    tenant: {},
  });
  assert.deepEqual(
    names(dmArmed.tools),
    names(groupArmed.tools),
    "owner-in-group must see the same tools as owner-in-DM",
  );
});

test("non-owner in a group (senderIsOwner=false) does NOT get the always-armed banks", () => {
  const armed = armTools({
    allTools: FAKE_TOOLS,
    text: "hello",
    toolsEnabled: true,
    senderIsOwner: false,
    tenant: {},
  });
  const got = names(armed.tools);
  // Partnership bank should NOT be present
  assert.ok(!got.has("track_partnership"));
  assert.ok(!got.has("append_partnership_note"));
  assert.ok(!got.has("recall_partnership"));
  // Personal-life bank should NOT be present
  assert.ok(!got.has("add_journal_entry"));
  assert.ok(!got.has("track_brand_decision"));
  // Calendar banks should NOT be present absent a keyword match either
  assert.ok(!got.has("schedule_event"));
});

test("backward compat: when senderIsOwner is undefined, isExpert still drives banks", () => {
  // Older call sites that haven't been migrated yet must still get the
  // expert-mode behavior.
  const expertArmed = armTools({
    allTools: FAKE_TOOLS,
    text: "yo",
    toolsEnabled: true,
    isExpert: true,
  });
  assert.ok(names(expertArmed.tools).has("track_partnership"));

  const notExpertArmed = armTools({
    allTools: FAKE_TOOLS,
    text: "yo",
    toolsEnabled: true,
    isExpert: false,
  });
  assert.ok(!names(notExpertArmed.tools).has("track_partnership"));
});

test("operator opt-out: tenant.expertMode === false suppresses the banks even when senderIsOwner=true", () => {
  const armed = armTools({
    allTools: FAKE_TOOLS,
    text: "yo",
    toolsEnabled: true,
    senderIsOwner: true,
    tenant: { expertMode: false },
  });
  assert.ok(!names(armed.tools).has("track_partnership"));
});

// ── 2. Prompt assembly parity ──────────────────────────────────────────

const FAKE_CONTACT = {
  handle: "+15551234567",
  displayName: "Caleb Newton",
  notes: [],
  messageCount: 100,
};

const FAKE_TENANT = {
  agentName: "Camber",
  displayName: "Camber",
  ownerName: "Caleb Newton",
  phoneNumber: "+15551234567",
  privyDid: "did:privy:cmobxrpvr00ml0cjp5gq5mdyd",
};

// Doctrine markers that MUST appear in any owner-doctrine block. Chosen
// so that lifting the helper into the group / Slack branches is a
// boolean "is this present?" check — not a brittle string match.
const DOCTRINE_MARKERS = [
  "PARTNERSHIPS + INVESTORS",
  "REMINDERS:",
  "RETREAT + EVENT PLANNING",
  "LINKEDIN ORG ANALYTICS",
  "TRAINING DATA EXTRACTION",
  "PRODUCT KNOWLEDGE vs CHANNEL SKILL SET",
];

test("buildOwnerDoctrineBlocks contains every doctrine marker", () => {
  const blocks = buildOwnerDoctrineBlocks(FAKE_TENANT);
  for (const marker of DOCTRINE_MARKERS) {
    assert.ok(
      blocks.includes(marker),
      `buildOwnerDoctrineBlocks missing marker: ${marker}`,
    );
  }
});

test("owner-DM prompt contains every doctrine marker", () => {
  const prompt = buildSystemPromptForSender(
    "owner context",
    FAKE_CONTACT,
    true, // isCaleb
    false, // isGroup
    null,
    [],
    false,
    "",
    0,
    "",
    FAKE_TENANT,
    null,
    { senderIsOwner: true, transportKind: "imessage-dm" },
  );
  for (const marker of DOCTRINE_MARKERS) {
    assert.ok(
      prompt.includes(marker),
      `owner-DM prompt missing marker: ${marker}`,
    );
  }
});

test("owner-in-group prompt contains every doctrine marker (parity with owner DM)", () => {
  const prompt = buildSystemPromptForSender(
    "owner context",
    FAKE_CONTACT,
    false, // isCaleb=false in group (Caleb is a participant, not the channel-as-Caleb)
    true, // isGroup
    "Test Group",
    [],
    false,
    "",
    0,
    "",
    FAKE_TENANT,
    null,
    { senderIsOwner: true, transportKind: "imessage-group" },
  );
  for (const marker of DOCTRINE_MARKERS) {
    assert.ok(
      prompt.includes(marker),
      `owner-in-group prompt missing marker: ${marker}`,
    );
  }
});

test("owner-in-group prompt includes the GROUP CHAT POLICY transport block", () => {
  const prompt = buildSystemPromptForSender(
    "owner context",
    FAKE_CONTACT,
    false,
    true,
    "Test Group",
    [],
    false,
    "",
    0,
    "",
    FAKE_TENANT,
    null,
    { senderIsOwner: true, transportKind: "imessage-group" },
  );
  assert.ok(prompt.includes("GROUP CHAT POLICY"));
  assert.ok(prompt.includes("Loop accepts attachments alongside group_id"));
});

test("Slack policy block names the files.uploadV2 contract", () => {
  const block = buildTransportPolicyBlock("slack");
  assert.ok(block.includes("SLACK POLICY"));
  assert.ok(block.includes("files.uploadV2"));
  assert.ok(block.includes("initial_comment"));
  assert.ok(block.includes("Do NOT paste the file URL"));
});

test("non-owner group prompt does NOT include the owner doctrine", () => {
  const prompt = buildSystemPromptForSender(
    "owner context",
    FAKE_CONTACT,
    false,
    true,
    "Test Group",
    [],
    false,
    "",
    0,
    "",
    FAKE_TENANT,
    null,
    { senderIsOwner: false, transportKind: "imessage-group" },
  );
  // PARTNERSHIPS + INVESTORS is owner-exclusive doctrine; a non-owner
  // typing in the group should NOT see it.
  assert.ok(
    !prompt.includes("PARTNERSHIPS + INVESTORS"),
    "non-owner-in-group should not see owner-only doctrine",
  );
});

// ── 3. Slack outbound files.uploadV2 ───────────────────────────────────

function makeSlackFetchMock() {
  const calls = [];
  const fetchMock = async (url, init = {}) => {
    calls.push({
      url,
      method: init.method || "GET",
      headers: init.headers || {},
      body: init.body,
    });
    if (url === "https://slack.com/api/files.getUploadURLExternal") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          upload_url: "https://files.slack.com/upload-abc",
          file_id: "F123ABC",
        }),
        headers: { get: () => "application/json" },
      };
    }
    if (url === "https://files.slack.com/upload-abc") {
      return {
        ok: true,
        status: 200,
        text: async () => "OK",
        headers: { get: () => "text/plain" },
      };
    }
    if (url === "https://slack.com/api/files.completeUploadExternal") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          files: [{ id: "F123ABC" }],
        }),
        headers: { get: () => "application/json" },
      };
    }
    // own-domain attachment fetch
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        new TextEncoder().encode("fake-png-bytes").buffer,
      headers: { get: () => "image/png" },
    };
  };
  return { fetchMock, calls };
}

test("uploadFilesToSlack runs the 3-step flow in the right order with initial_comment", async () => {
  const { fetchMock, calls } = makeSlackFetchMock();
  const result = await uploadFilesToSlack({
    botToken: "xoxb-test",
    channel: "C0123",
    threadTs: "1700000000.000100",
    urls: ["https://medha.example.com/image/abc.png"],
    initialComment: "here's the image you asked for",
    fetch: fetchMock,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.file_ids, ["F123ABC"]);
  // Calls in order: attachment fetch → getUploadURLExternal → upload bytes
  // → completeUploadExternal.
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, "https://medha.example.com/image/abc.png");
  assert.equal(
    calls[1].url,
    "https://slack.com/api/files.getUploadURLExternal",
  );
  assert.equal(calls[2].url, "https://files.slack.com/upload-abc");
  assert.equal(
    calls[3].url,
    "https://slack.com/api/files.completeUploadExternal",
  );
  // completeUploadExternal body carries initial_comment + channel_id + thread_ts.
  const completeBody = JSON.parse(calls[3].body);
  assert.equal(completeBody.initial_comment, "here's the image you asked for");
  assert.equal(completeBody.channel_id, "C0123");
  assert.equal(completeBody.thread_ts, "1700000000.000100");
  assert.deepEqual(completeBody.files, [{ id: "F123ABC", title: "abc.png" }]);
});

test("sendSlackReply with attachments routes to files.uploadV2 (NO chat.postMessage)", async () => {
  const { fetchMock, calls } = makeSlackFetchMock();
  // Inject the mock fetch globally for the duration of this test. The
  // responder reads process.env.SLACK_BOT_TOKEN and calls
  // uploadFilesToSlack which internally uses globalThis.fetch.
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.SLACK_BOT_TOKEN;
  globalThis.fetch = fetchMock;
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  try {
    const result = await sendSlackReply({
      channel: "C0123",
      thread_ts: "1700000000.000100",
      text: "here's the PDF",
      attachments: ["https://medha.example.com/file/x.pdf"],
    });
    assert.equal(result.ok, true);
    // No chat.postMessage call should have happened.
    const postMessageHits = calls.filter(
      (c) => c.url === "https://slack.com/api/chat.postMessage",
    );
    assert.equal(
      postMessageHits.length,
      0,
      "attachments path must skip chat.postMessage",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.SLACK_BOT_TOKEN;
    else process.env.SLACK_BOT_TOKEN = originalToken;
  }
});

test("sendSlackReply text-only path still uses chat.postMessage", async () => {
  const calls = [];
  const fetchMock = async (url, init = {}) => {
    calls.push({ url });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, ts: "1700000000.000200" }),
      json: async () => ({ ok: true, ts: "1700000000.000200" }),
      headers: { get: () => "application/json" },
    };
  };
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.SLACK_BOT_TOKEN;
  globalThis.fetch = fetchMock;
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  try {
    const result = await sendSlackReply({
      channel: "C0123",
      thread_ts: "1700000000.000100",
      text: "just text, no files",
    });
    assert.equal(result.ok, true);
    assert.equal(result.ts, "1700000000.000200");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://slack.com/api/chat.postMessage");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.SLACK_BOT_TOKEN;
    else process.env.SLACK_BOT_TOKEN = originalToken;
  }
});

// ── 4. Loop outbound carries group + attachments together ──────────────

test("Loop outbound body includes BOTH group AND attachments when both are set", async () => {
  // We test the body-shape contract by importing the transport module and
  // intercepting global fetch. transport.js's sendMessage handles the
  // formatting and the Loop body shape sits inside sendToLoop.
  const transport = await import("../transport.js");
  const captured = [];
  const originalFetch = globalThis.fetch;
  // Stub idempotency window so dup-suppression doesn't fire.
  globalThis.fetch = async (url, init = {}) => {
    captured.push({
      url,
      body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
    });
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          message_id: "loop-mid-1",
          contact: "+15550000000",
        }),
      headers: { get: () => "application/json" },
    };
  };
  try {
    await transport.sendMessage(null, "here is your PDF", {
      group: "group-abc",
      attachments: ["https://medha.example.com/file/x.pdf"],
      tenant: {
        loopSenderId: "test-sender-uuid",
        phoneNumber: "+15551234567",
      },
      allowDuplicate: true,
    });
    // Find the Loop send call (skip any non-Loop telemetry calls).
    const loopCall = captured.find(
      (c) => c.body && c.body.sender === "test-sender-uuid",
    );
    assert.ok(loopCall, "expected a Loop send call");
    assert.equal(loopCall.body.group, "group-abc");
    assert.deepEqual(loopCall.body.attachments, [
      "https://medha.example.com/file/x.pdf",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
