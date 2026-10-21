// conversation-index.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  maybeIndexConversation,
  isTrivialTurn,
  classifyDimension,
  buildCompositeContent,
  _resetBuffers,
} from "../conversation-index.js";

const MEDHA_TENANT = {
  privyDid: "did:privy:cmobxrpvr00ml0cjp5gq5mdyd",
  phoneNumber: "+15550100005",
  preferences: { embedConversations: true },
};

function captureIngest() {
  const calls = [];
  return {
    calls,
    fn: async (payload) => {
      calls.push(payload);
      return { ok: true };
    },
  };
}

beforeEach(() => _resetBuffers());

test("embeds a real exchange as a composite conversation chunk", async () => {
  const ingest = captureIngest();
  const res = await maybeIndexConversation({
    userText: "What did Sagar say about the tax credit pitch yesterday?",
    finalText: "He said the angle was strong but the timing needs work.",
    contact: "+15551234567",
    channel: "imessage",
    messageId: "m1",
    tenant: MEDHA_TENANT,
    _ingest: ingest.fn,
  });
  assert.equal(res.ok, true);
  assert.equal(ingest.calls.length, 1);
  const payload = ingest.calls[0];
  assert.equal(payload.pipe, "agent");
  assert.equal(payload.phone, "+15550100005");
  const item = payload.items[0];
  assert.equal(item.kind, "conversation");
  assert.match(item.text, /USER: /);
  assert.match(item.text, /MEDHA: /);
  assert.equal(item.source, "m1");
  assert.ok(item.healthDimension, "healthDimension should be set");
  assert.equal(item.extra.channel, "imessage");
  assert.equal(item.extra.replyToId, "m1");
  assert.equal(item.extra.contact, "+15551234567");
  assert.equal(item.extra.bufferedTurns, 2);
});

test("respects the embedConversations opt-out without calling ingest", async () => {
  const ingest = captureIngest();
  const res = await maybeIndexConversation({
    userText: "This is a long enough message that would otherwise embed fine.",
    finalText: "And here is a substantive agent reply to go with it.",
    tenant: { preferences: { embedConversations: false } },
    _ingest: ingest.fn,
  });
  assert.equal(res.ok, false);
  assert.equal(res.skipped, "disabled");
  assert.equal(ingest.calls.length, 0);
});

test("skips trivial turns without calling ingest", async () => {
  const ingest = captureIngest();
  const res = await maybeIndexConversation({
    userText: "ok",
    finalText: "yep",
    tenant: MEDHA_TENANT,
    _ingest: ingest.fn,
  });
  assert.equal(res.ok, false);
  assert.equal(res.skipped, "trivial");
  assert.equal(ingest.calls.length, 0);
});

test("buffers context: a later turn carries the earlier turn", async () => {
  const ingest = captureIngest();
  await maybeIndexConversation({
    userText: "I am thinking about the Rytual retreat in Joshua Tree.",
    finalText: "Sounds grounding. What dates are you considering?",
    contact: "+15551234567",
    channel: "imessage",
    tenant: MEDHA_TENANT,
    _ingest: ingest.fn,
  });
  await maybeIndexConversation({
    userText: "Probably the second weekend of June, can you hold it?",
    finalText: "Got it, penciling June 13 to 15 for the retreat.",
    contact: "+15551234567",
    channel: "imessage",
    tenant: MEDHA_TENANT,
    _ingest: ingest.fn,
  });
  assert.equal(ingest.calls.length, 2);
  const second = ingest.calls[1].items[0];
  assert.match(second.text, /Joshua Tree/);
  assert.equal(second.extra.bufferedTurns, 4);
});

test("isTrivialTurn flags short, ack, and emoji-only turns", () => {
  assert.equal(isTrivialTurn("ok", "yep"), true);
  assert.equal(isTrivialTurn("thanks", "no problem"), true);
  assert.equal(isTrivialTurn("hi", "hey"), true); // combined < 30 chars
  assert.equal(
    isTrivialTurn(
      "Can you summarize the deck Shirley sent?",
      "Sure, it covers Q3 revenue and the migration plan.",
    ),
    false,
  );
});

test("classifyDimension matches whole tokens, not substrings", () => {
  assert.equal(
    classifyDimension("we need to raise our valuation and revenue"),
    "financial",
  );
  assert.equal(
    classifyDimension("please pray for me, my faith feels low"),
    "spiritual",
  );
  // "great" and "interest" must NOT match the "eat"/"rest" keywords.
  assert.equal(
    classifyDimension("that is a great point and an interesting angle"),
    "emotional",
  );
});

test("buildCompositeContent keeps at most the last 5 turns", () => {
  const turns = [
    { label: "USER", text: "one" },
    { label: "MEDHA", text: "two" },
    { label: "USER", text: "three" },
    { label: "MEDHA", text: "four" },
    { label: "USER", text: "five" },
    { label: "MEDHA", text: "six" },
  ];
  const content = buildCompositeContent(turns);
  const blocks = content.split("\n\n");
  assert.equal(blocks.length, 5);
  assert.equal(blocks[blocks.length - 1], "MEDHA: six");
  assert.ok(!content.includes("one"));
});
