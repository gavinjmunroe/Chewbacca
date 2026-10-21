/**
 * anthropic-chat: the client that replaced Perplexity on /ask and the Q&A
 * threads. These tests pin the two things a swap like this gets wrong -- the
 * WIRE FORMAT (Anthropic is not OpenAI-shaped in either direction) and the
 * null-on-every-failure contract the callers' fallbacks depend on.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { callChat, streamChat, toAnthropicShape } from "./anthropic-chat.js";

// ── toAnthropicShape ──────────────────────────────────────────────────────────

test("toAnthropicShape: lifts system out of the messages array", () => {
  const { system, messages } = toAnthropicShape([
    { role: "system", content: "You are Amber." },
    { role: "user", content: "Who runs?" },
  ]);
  // Anthropic 400s on an inline system role, so this MUST be lifted.
  assert.equal(system, "You are Amber.");
  assert.deepEqual(messages, [{ role: "user", content: "Who runs?" }]);
});

test("toAnthropicShape: merges consecutive same-role turns", () => {
  // Anthropic requires strictly alternating roles; a sanitised transcript can
  // legitimately hold two user turns in a row.
  const { messages } = toAnthropicShape([
    { role: "user", content: "a" },
    { role: "user", content: "b" },
    { role: "assistant", content: "c" },
  ]);
  assert.deepEqual(messages, [
    { role: "user", content: "a\n\nb" },
    { role: "assistant", content: "c" },
  ]);
});

test("toAnthropicShape: drops empty content and never returns an empty array", () => {
  const { messages } = toAnthropicShape([
    { role: "user", content: "   " },
    null,
    { role: "user", content: "" },
  ]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "user");
});

test("toAnthropicShape: guarantees a leading user turn", () => {
  const { messages } = toAnthropicShape([{ role: "assistant", content: "hi" }]);
  assert.equal(messages[0].role, "user");
});

test("toAnthropicShape: joins multiple system messages", () => {
  const { system } = toAnthropicShape([
    { role: "system", content: "one" },
    { role: "system", content: "two" },
    { role: "user", content: "q" },
  ]);
  assert.equal(system, "one\n\ntwo");
});

// ── callChat ──────────────────────────────────────────────────────────────────

test("callChat: no key -> null and no request", async () => {
  let called = false;
  const out = await callChat({
    messages: [{ role: "user", content: "x" }],
    apiKey: undefined,
    fetchImpl: async () => {
      called = true;
      return { ok: true, json: async () => ({}) };
    },
  });
  assert.equal(out, null);
  assert.equal(called, false);
});

test("callChat: sends the Anthropic wire format with a cached system block", async () => {
  let captured = null;
  const out = await callChat({
    messages: [
      { role: "system", content: "SYS" },
      { role: "user", content: "hello" },
    ],
    apiKey: "k",
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return { ok: true, json: async () => ({ content: [{ type: "text", text: " hi " }] }) };
    },
  });
  assert.equal(out, "hi");
  assert.equal(captured.url, "https://api.anthropic.com/v1/messages");
  // x-api-key + version header, NOT an Authorization bearer.
  assert.equal(captured.init.headers["x-api-key"], "k");
  assert.equal(captured.init.headers["anthropic-version"], "2023-06-01");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, "claude-haiku-4-5");
  assert.equal(body.stream, undefined);
  assert.deepEqual(body.system, [
    { type: "text", text: "SYS", cache_control: { type: "ephemeral" } },
  ]);
  assert.deepEqual(body.messages, [{ role: "user", content: "hello" }]);
});

test("callChat: omits system entirely when there is none", async () => {
  let body = null;
  await callChat({
    messages: [{ role: "user", content: "hello" }],
    apiKey: "k",
    fetchImpl: async (_u, init) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ content: [{ type: "text", text: "x" }] }) };
    },
  });
  assert.equal("system" in body, false);
});

test("callChat: concatenates text blocks and ignores non-text ones", async () => {
  const out = await callChat({
    messages: [{ role: "user", content: "x" }],
    apiKey: "k",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        content: [
          { type: "thinking", thinking: "nope" },
          { type: "text", text: "one " },
          { type: "text", text: "two" },
        ],
      }),
    }),
  });
  assert.equal(out, "one two");
});

test("callChat: no text blocks -> null, not an empty string", async () => {
  // Callers branch on falsiness to reach their fallback; "" would pass through
  // as a real answer in some and not others.
  const out = await callChat({
    messages: [{ role: "user", content: "x" }],
    apiKey: "k",
    fetchImpl: async () => ({ ok: true, json: async () => ({ content: [] }) }),
  });
  assert.equal(out, null);
});

test("callChat: non-2xx, bad JSON and a thrown fetch all -> null", async () => {
  const nonOk = await callChat({
    messages: [{ role: "user", content: "x" }],
    apiKey: "k",
    fetchImpl: async () => ({ ok: false, status: 429, text: async () => "slow down" }),
  });
  assert.equal(nonOk, null);

  const badJson = await callChat({
    messages: [{ role: "user", content: "x" }],
    apiKey: "k",
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        throw new Error("not json");
      },
    }),
  });
  assert.equal(badJson, null);

  const threw = await callChat({
    messages: [{ role: "user", content: "x" }],
    apiKey: "k",
    fetchImpl: async () => {
      throw new Error("network");
    },
  });
  assert.equal(threw, null);
});

// ── streamChat ────────────────────────────────────────────────────────────────

/** A fetch whose body replays the given SSE frames. */
function sseBody(frames) {
  const chunks = frames.map((f) => new TextEncoder().encode(f));
  let i = 0;
  return {
    getReader: () => ({
      read: async () =>
        i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true },
      cancel: async () => {},
    }),
  };
}

const delta = (t) =>
  `event: content_block_delta\ndata: ${JSON.stringify({
    type: "content_block_delta",
    delta: { type: "text_delta", text: t },
  })}\n\n`;

test("streamChat: assembles content_block_delta frames and stops at message_stop", async () => {
  const seen = [];
  const out = await streamChat({
    messages: [{ role: "user", content: "x" }],
    apiKey: "k",
    onToken: (t) => seen.push(t),
    fetchImpl: async () => ({
      ok: true,
      body: sseBody([
        delta("Hello"),
        delta(", world"),
        `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
      ]),
    }),
  });
  assert.deepEqual(seen, ["Hello", ", world"]);
  assert.equal(out, "Hello, world");
});

test("streamChat: ignores pings and non-delta events", async () => {
  const out = await streamChat({
    messages: [{ role: "user", content: "x" }],
    apiKey: "k",
    onToken: () => {},
    fetchImpl: async () => ({
      ok: true,
      body: sseBody([
        `event: ping\ndata: ${JSON.stringify({ type: "ping" })}\n\n`,
        `event: message_start\ndata: ${JSON.stringify({ type: "message_start" })}\n\n`,
        delta("only this"),
        `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
      ]),
    }),
  });
  assert.equal(out, "only this");
});

test("streamChat: an error frame returns what was already emitted", async () => {
  // A stream can end in `error` rather than message_stop. Throwing away the
  // text the user already watched appear is worse than returning it.
  const out = await streamChat({
    messages: [{ role: "user", content: "x" }],
    apiKey: "k",
    onToken: () => {},
    fetchImpl: async () => ({
      ok: true,
      body: sseBody([
        delta("partial"),
        `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "overloaded_error" } })}\n\n`,
      ]),
    }),
  });
  assert.equal(out, "partial");
});

test("streamChat: error frame with nothing emitted yet -> null", async () => {
  const out = await streamChat({
    messages: [{ role: "user", content: "x" }],
    apiKey: "k",
    onToken: () => {},
    fetchImpl: async () => ({
      ok: true,
      body: sseBody([
        `event: error\ndata: ${JSON.stringify({ type: "error", error: {} })}\n\n`,
      ]),
    }),
  });
  assert.equal(out, null);
});

test("streamChat: frames split across chunk boundaries still parse", async () => {
  // The reader hands back arbitrary byte slices, not whole events.
  const whole = delta("split me");
  const cut = Math.floor(whole.length / 2);
  const out = await streamChat({
    messages: [{ role: "user", content: "x" }],
    apiKey: "k",
    onToken: () => {},
    fetchImpl: async () => ({
      ok: true,
      body: sseBody([
        whole.slice(0, cut),
        whole.slice(cut),
        `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
      ]),
    }),
  });
  assert.equal(out, "split me");
});

test("streamChat: non-ok and missing body -> null", async () => {
  const nonOk = await streamChat({
    messages: [{ role: "user", content: "x" }],
    apiKey: "k",
    onToken: () => {},
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => "boom" }),
  });
  assert.equal(nonOk, null);
});

test("streamChat: requires an onToken callback", async () => {
  const out = await streamChat({
    messages: [{ role: "user", content: "x" }],
    apiKey: "k",
    fetchImpl: async () => {
      throw new Error("should not be called");
    },
  });
  assert.equal(out, null);
});
