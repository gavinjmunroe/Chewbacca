/**
 * Tests for createSlackCanvas, the canvases.* Web API helper behind the
 * slack_create_canvas tool (Tab 30). The helper must:
 *   - create a canvas from markdown and return its canvas_id
 *   - best-effort resolve a clickable permalink via files.info, degrading
 *     gracefully when that call fails (canvas still created)
 *   - share the canvas with a channel via canvases.access.set ONLY when a
 *     channel is supplied
 *   - surface missing_scope as scope_needed: "canvases:write"
 *   - fail closed on no token / empty markdown without any network call
 *
 * Run with:  node --test Newton/agent/lib/transports/slack/canvas.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createSlackCanvas } from "./canvas.js";

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

/**
 * Build a fetch stub that routes by URL substring and records every call.
 */
function mockFetch(routes) {
  const calls = [];
  const impl = async (url, opts) => {
    const u = String(url);
    calls.push({ url: u, opts });
    for (const [match, responder] of Object.entries(routes)) {
      if (u.includes(match)) {
        if (responder instanceof Error) throw responder;
        return typeof responder === "function" ? responder(opts) : responder;
      }
    }
    throw new Error(`no mock for ${u}`);
  };
  impl.calls = calls;
  return impl;
}

test("happy path: creates canvas, resolves permalink, shares with channel", async () => {
  const fetchImpl = mockFetch({
    "canvases.create": jsonResponse({ ok: true, canvas_id: "F_CANVAS_1" }),
    "files.info": jsonResponse({
      ok: true,
      file: { permalink: "https://acme.slack.com/docs/T1/F_CANVAS_1" },
    }),
    "canvases.access.set": jsonResponse({ ok: true }),
  });

  const result = await createSlackCanvas({
    botToken: "xoxb-test",
    title: "The Rave: Issue 12",
    markdown: "# Stories We're Watching\n\n- One\n- Two",
    channel: "C12345",
    fetch: fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.canvas_id, "F_CANVAS_1");
  assert.equal(result.permalink, "https://acme.slack.com/docs/T1/F_CANVAS_1");
  assert.equal(result.shared, true);
  assert.equal(fetchImpl.calls.length, 3);

  // create body carries the markdown document_content + title
  const createBody = JSON.parse(fetchImpl.calls[0].opts.body);
  assert.deepEqual(createBody.document_content, {
    type: "markdown",
    markdown: "# Stories We're Watching\n\n- One\n- Two",
  });
  assert.equal(createBody.title, "The Rave: Issue 12");

  // access.set defaults to write and targets the channel
  const accessBody = JSON.parse(fetchImpl.calls[2].opts.body);
  assert.equal(accessBody.canvas_id, "F_CANVAS_1");
  assert.equal(accessBody.access_level, "write");
  assert.deepEqual(accessBody.channel_ids, ["C12345"]);
});

test("no channel: skips access.set, returns ok with shared=false", async () => {
  const fetchImpl = mockFetch({
    "canvases.create": jsonResponse({ ok: true, canvas_id: "F_CANVAS_2" }),
    "files.info": jsonResponse({
      ok: true,
      file: { permalink: "https://acme.slack.com/docs/T1/F_CANVAS_2" },
    }),
  });

  const result = await createSlackCanvas({
    botToken: "xoxb-test",
    markdown: "body",
    fetch: fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.shared, false);
  // only create + files.info, NO access.set
  assert.equal(fetchImpl.calls.length, 2);
  assert.ok(
    !fetchImpl.calls.some((c) => c.url.includes("canvases.access.set")),
  );
});

test("files.info failure degrades gracefully: canvas still created, no permalink", async () => {
  const fetchImpl = mockFetch({
    "canvases.create": jsonResponse({ ok: true, canvas_id: "F_CANVAS_3" }),
    "files.info": jsonResponse({ ok: false, error: "missing_scope" }),
  });

  const result = await createSlackCanvas({
    botToken: "xoxb-test",
    markdown: "body",
    fetch: fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.canvas_id, "F_CANVAS_3");
  assert.equal(result.permalink, undefined);
});

test("access.set failure does not fail the call: canvas still created", async () => {
  const fetchImpl = mockFetch({
    "canvases.create": jsonResponse({ ok: true, canvas_id: "F_CANVAS_4" }),
    "files.info": jsonResponse({
      ok: true,
      file: { permalink: "https://x/y" },
    }),
    "canvases.access.set": jsonResponse({
      ok: false,
      error: "channel_not_found",
    }),
  });

  const result = await createSlackCanvas({
    botToken: "xoxb-test",
    markdown: "body",
    channel: "C_BAD",
    fetch: fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.shared, false);
});

test("read access_level is honored", async () => {
  const fetchImpl = mockFetch({
    "canvases.create": jsonResponse({ ok: true, canvas_id: "F5" }),
    "files.info": jsonResponse({ ok: true, file: { permalink: "p" } }),
    "canvases.access.set": jsonResponse({ ok: true }),
  });

  await createSlackCanvas({
    botToken: "xoxb-test",
    markdown: "body",
    channel: "C1",
    accessLevel: "read",
    fetch: fetchImpl,
  });

  const accessBody = JSON.parse(
    fetchImpl.calls.find((c) => c.url.includes("access.set")).opts.body,
  );
  assert.equal(accessBody.access_level, "read");
});

test("canvases.create missing_scope surfaces scope_needed", async () => {
  const fetchImpl = mockFetch({
    "canvases.create": jsonResponse({ ok: false, error: "missing_scope" }),
  });

  const result = await createSlackCanvas({
    botToken: "xoxb-test",
    markdown: "body",
    fetch: fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "missing_scope");
  assert.equal(result.scope_needed, "canvases:write");
  assert.equal(fetchImpl.calls.length, 1);
});

test("no bot token fails closed with no network call", async () => {
  const fetchImpl = mockFetch({});
  const result = await createSlackCanvas({
    markdown: "body",
    fetch: fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "no-bot-token");
  assert.equal(fetchImpl.calls.length, 0);
});

test("empty markdown fails closed with no network call", async () => {
  const fetchImpl = mockFetch({});
  const result = await createSlackCanvas({
    botToken: "xoxb-test",
    markdown: "   ",
    fetch: fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "missing-markdown");
  assert.equal(fetchImpl.calls.length, 0);
});

test("create network throw is caught and returned as error", async () => {
  const fetchImpl = mockFetch({
    "canvases.create": new Error("ECONNRESET"),
  });
  const result = await createSlackCanvas({
    botToken: "xoxb-test",
    markdown: "body",
    fetch: fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "ECONNRESET");
});
