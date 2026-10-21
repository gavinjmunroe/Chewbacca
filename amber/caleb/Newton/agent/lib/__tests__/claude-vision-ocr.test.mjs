/**
 * Tests for the Claude-vision OCR fallback tool.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/claude-vision-ocr.test.mjs
 *
 * We mock global fetch so we never make a real Anthropic call, and we
 * patch process.env.ANTHROPIC_API_KEY (which the per-tenant secret lookup
 * falls back to when no tenant is provided).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { executeClaudeVisionOcrTool } from "../tools/claude-vision-ocr.js";

function makeAnthropicResponse(text) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-5-20250929",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
    }),
    text: async () => "",
  };
}

function withEnv(key, value, fn) {
  const prev = process.env[key];
  process.env[key] = value;
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  });
}

function withoutEnv(key, fn) {
  const prev = process.env[key];
  delete process.env[key];
  return Promise.resolve(fn()).finally(() => {
    if (prev !== undefined) process.env[key] = prev;
  });
}

test("claude_vision_extract: image URL returns ok+text", async () => {
  await withEnv("ANTHROPIC_API_KEY", "test-anthropic-key", async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return makeAnthropicResponse("Hello from a screenshot");
    };
    try {
      const r = await executeClaudeVisionOcrTool(
        "claude_vision_extract",
        { url: "https://loop.example/screenshot.png" },
        { tenant: null },
      );
      assert.equal(r.ok, true);
      assert.equal(r.text, "Hello from a screenshot");
      assert.equal(r.model, "claude-sonnet-4-5-20250929");
      assert.equal(r.source_url, "https://loop.example/screenshot.png");
      assert.equal(r.type, "image");
      // Verify the request sent an `image` content block.
      assert.equal(calls.length, 1);
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.model, "claude-sonnet-4-5-20250929");
      const content = body.messages[0].content;
      assert.equal(content[0].type, "image");
      assert.equal(content[0].source.type, "url");
      assert.equal(
        content[0].source.url,
        "https://loop.example/screenshot.png",
      );
      assert.equal(content[1].type, "text");
      assert.match(content[1].text, /Extract all text/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

test("claude_vision_extract: PDF URL returns ok+text with document block", async () => {
  await withEnv("ANTHROPIC_API_KEY", "test-anthropic-key", async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return makeAnthropicResponse(
        "--- page 1 ---\nQ1 revenue summary\n--- page 2 ---\nMargins improving",
      );
    };
    try {
      const r = await executeClaudeVisionOcrTool(
        "claude_vision_extract",
        { url: "https://loop.example/q1-report.pdf", type: "pdf" },
        { tenant: null },
      );
      assert.equal(r.ok, true);
      assert.match(r.text, /Q1 revenue summary/);
      assert.match(r.text, /Margins improving/);
      assert.equal(r.type, "pdf");
      const body = JSON.parse(calls[0].init.body);
      const content = body.messages[0].content;
      assert.equal(content[0].type, "document");
      assert.equal(content[0].source.type, "url");
      assert.equal(content[0].source.url, "https://loop.example/q1-report.pdf");
      assert.match(content[1].text, /Preserve page boundaries/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

test("claude_vision_extract: missing ANTHROPIC_API_KEY returns error", async () => {
  await withoutEnv("ANTHROPIC_API_KEY", async () => {
    const realFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return makeAnthropicResponse("should not be called");
    };
    try {
      const r = await executeClaudeVisionOcrTool(
        "claude_vision_extract",
        { url: "https://loop.example/x.png" },
        { tenant: null },
      );
      assert.equal(r.ok, undefined);
      assert.match(r.error, /ANTHROPIC_API_KEY/);
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

test("claude_vision_extract: auto-detects PDF from .pdf extension", async () => {
  await withEnv("ANTHROPIC_API_KEY", "test-key", async () => {
    const realFetch = globalThis.fetch;
    let capturedBody = null;
    globalThis.fetch = async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return makeAnthropicResponse("pdf text");
    };
    try {
      const r = await executeClaudeVisionOcrTool(
        "claude_vision_extract",
        { url: "https://loop.example/file.pdf", type: "auto" },
        { tenant: null },
      );
      assert.equal(r.ok, true);
      assert.equal(r.type, "pdf");
      assert.equal(capturedBody.messages[0].content[0].type, "document");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

test("claude_vision_extract: forwards focus into prompt", async () => {
  await withEnv("ANTHROPIC_API_KEY", "test-key", async () => {
    const realFetch = globalThis.fetch;
    let capturedBody = null;
    globalThis.fetch = async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return makeAnthropicResponse("ok");
    };
    try {
      await executeClaudeVisionOcrTool(
        "claude_vision_extract",
        { url: "https://loop.example/x.png", focus: "numerical data" },
        { tenant: null },
      );
      const promptText = capturedBody.messages[0].content[1].text;
      assert.match(promptText, /Focus on: numerical data/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

test("claude_vision_extract: unknown tool name returns error", async () => {
  const r = await executeClaudeVisionOcrTool(
    "claude_vision_explode",
    { url: "https://loop.example/x.png" },
    { tenant: null },
  );
  assert.match(r.error, /unknown claude-vision tool/);
});

test("claude_vision_extract: missing url returns error", async () => {
  await withEnv("ANTHROPIC_API_KEY", "test-key", async () => {
    const r = await executeClaudeVisionOcrTool(
      "claude_vision_extract",
      {},
      { tenant: null },
    );
    assert.match(r.error, /url is required/);
  });
});

test("claude_vision_extract: anthropic non-200 returns error", async () => {
  await withEnv("ANTHROPIC_API_KEY", "test-key", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 429,
      text: async () => "rate limited",
      json: async () => ({}),
    });
    try {
      const r = await executeClaudeVisionOcrTool(
        "claude_vision_extract",
        { url: "https://loop.example/x.png" },
        { tenant: null },
      );
      assert.match(r.error, /anthropic vision 429/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
