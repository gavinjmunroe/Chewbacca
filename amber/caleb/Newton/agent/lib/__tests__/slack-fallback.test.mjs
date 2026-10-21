/**
 * Regression tests for the Slack outbound files.uploadV2 fallback path.
 *
 * Background: live Slack test on 2026-05-28 showed files.uploadV2 returning
 * `missing_scope` (bot token lacked `files:write`). The responder logged
 * "all-uploads-failed" and the text reply ALSO dropped, so the user saw
 * nothing. This file pins:
 *
 *   1. missing_scope failure -> fallback chat.postMessage fires with the
 *      original text PLUS the URLs appended PLUS the admin hint (only when
 *      the URL is a Medha image-host URL, since the hint is only actionable
 *      for our own workspace admins).
 *   2. non-scope failure (rate_limited) -> fallback fires with text + URLs
 *      but WITHOUT the admin hint (we don't know what the admin can fix).
 *   3. successful upload -> no fallback chat.postMessage is sent.
 *   4. files-upload.js tags missing_scope with scope_needed: "files:write"
 *      so the responder can decide whether to surface the admin hint.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/slack-fallback.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Stub the bot token BEFORE importing the responder.
process.env.SLACK_BOT_TOKEN = "xoxb-test-token";

const { sendSlackReply } = await import("../transports/slack/responder.js");
const { uploadFilesToSlack } =
  await import("../transports/slack/files-upload.js");

const originalFetch = globalThis.fetch;
const originalConsoleWarn = console.warn;
console.warn = () => {};

function setUploadMock(uploadResult, sendResult) {
  // We intercept both files.uploadV2 round-trips AND the fallback
  // chat.postMessage. The responder calls uploadFilesToSlack first; we
  // make every Slack-API URL it hits return the failure code we want,
  // then make chat.postMessage succeed.
  const calls = { uploadHits: 0, postMessage: [] };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("files.getUploadURLExternal")) {
      // Pretend Slack rejected the upload at step 1 with the specified
      // error code. The responder branches on this.
      calls.uploadHits += 1;
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ ok: false, error: uploadResult.error });
        },
        async json() {
          return { ok: false, error: uploadResult.error };
        },
      };
    }
    if (u.includes("chat.postMessage")) {
      const body = JSON.parse(opts.body || "{}");
      calls.postMessage.push(body);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ ok: true, ts: "1700000000.000100" });
        },
        async json() {
          return { ok: true, ts: "1700000000.000100" };
        },
      };
    }
    if (u.includes("/image/")) {
      // The attachment-bytes fetch — must succeed for files-upload.js to
      // reach the getUploadURLExternal step.
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/pdf" },
        async arrayBuffer() {
          return new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
        },
      };
    }
    throw new Error(`unexpected fetch url=${u}`);
  };
  return calls;
}

function setSuccessMock() {
  const calls = { postMessage: [], complete: 0 };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/image/")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/pdf" },
        async arrayBuffer() {
          return new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
        },
      };
    }
    if (u.includes("files.getUploadURLExternal")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            upload_url: "https://slack.upload/x",
            file_id: "F1",
          };
        },
      };
    }
    if (u.includes("slack.upload")) {
      return { ok: true, status: 200 };
    }
    if (u.includes("files.completeUploadExternal")) {
      calls.complete += 1;
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, files: [{ id: "F1" }] };
        },
      };
    }
    if (u.includes("chat.postMessage")) {
      const body = JSON.parse(opts.body || "{}");
      calls.postMessage.push(body);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ ok: true, ts: "1700000000.000100" });
        },
      };
    }
    throw new Error(`unexpected fetch url=${u}`);
  };
  return calls;
}

test("missing_scope failure falls back to chat.postMessage with text + URLs + admin hint (medha-hosted URL)", async () => {
  const calls = setUploadMock({ error: "missing_scope" });

  const result = await sendSlackReply({
    channel: "C123",
    thread_ts: "1700000000.000099",
    text: "Here's your PDF.",
    attachments: [
      "https://medha-platform-production.up.railway.app/image/abc.pdf",
    ],
  });

  assert.ok(calls.uploadHits >= 1, "upload was attempted");
  assert.equal(
    calls.postMessage.length,
    1,
    "fallback chat.postMessage fired once",
  );

  const body = calls.postMessage[0];
  assert.match(body.text, /Here's your PDF\./, "preserves original text");
  assert.match(
    body.text,
    /https:\/\/medha-platform-production\.up\.railway\.app\/image\/abc\.pdf/,
    "appends the URL for Slack auto-unfurl",
  );
  assert.match(body.text, /files:write/, "includes the admin hint");
  assert.match(body.text, /api\.slack\.com\/apps/, "hint points at app config");

  assert.equal(body.channel, "C123");
  assert.equal(body.thread_ts, "1700000000.000099");
  assert.equal(result.fallback, true);
  assert.equal(result.uploadError, "missing_scope");
  assert.equal(result.ok, true);
});

test("rate_limited failure falls back without the admin hint", async () => {
  const calls = setUploadMock({ error: "rate_limited" });

  const result = await sendSlackReply({
    channel: "C123",
    text: "Here's your PDF.",
    attachments: [
      "https://medha-platform-production.up.railway.app/image/xyz.pdf",
    ],
  });

  assert.equal(
    calls.postMessage.length,
    1,
    "fallback chat.postMessage still fires",
  );
  const body = calls.postMessage[0];
  assert.match(body.text, /Here's your PDF\./);
  assert.match(body.text, /xyz\.pdf/);
  assert.doesNotMatch(
    body.text,
    /files:write/,
    "no admin hint for non-scope errors",
  );
  assert.doesNotMatch(body.text, /api\.slack\.com\/apps/);
  assert.equal(result.fallback, true);
  assert.equal(result.uploadError, "rate_limited");
});

test("successful upload does not trigger the chat.postMessage fallback", async () => {
  const calls = setSuccessMock();

  const result = await sendSlackReply({
    channel: "C123",
    text: "Here's your PDF.",
    attachments: [
      "https://medha-platform-production.up.railway.app/image/ok.pdf",
    ],
  });

  assert.equal(calls.complete, 1, "completeUploadExternal called");
  assert.equal(
    calls.postMessage.length,
    0,
    "no fallback chat.postMessage on success",
  );
  assert.equal(result.ok, true);
  assert.notEqual(result.fallback, true);
});

test("missing_scope on a non-medha-hosted URL does NOT include the admin hint", async () => {
  // The admin hint is only actionable for workspaces we host. If a tool
  // returned a third-party URL, omit the hint.
  const calls = setUploadMock({ error: "missing_scope" });

  await sendSlackReply({
    channel: "C123",
    text: "Here's that file.",
    attachments: ["https://example.com/some.pdf"],
  });

  assert.equal(calls.postMessage.length, 1);
  assert.doesNotMatch(calls.postMessage[0].text, /files:write/);
});

test("uploadFilesToSlack tags missing_scope with scope_needed: files:write", async () => {
  setUploadMock({ error: "missing_scope" });
  const result = await uploadFilesToSlack({
    botToken: "xoxb-test",
    channel: "C123",
    urls: ["https://medha-platform-production.up.railway.app/image/a.pdf"],
    initialComment: "hello",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "missing_scope");
  assert.equal(result.scope_needed, "files:write");
});

test("uploadFilesToSlack does NOT tag scope_needed for non-scope errors", async () => {
  setUploadMock({ error: "rate_limited" });
  const result = await uploadFilesToSlack({
    botToken: "xoxb-test",
    channel: "C123",
    urls: ["https://medha-platform-production.up.railway.app/image/a.pdf"],
    initialComment: "hello",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "rate_limited");
  assert.equal(result.scope_needed, null);
});

test("teardown: restore globals", () => {
  globalThis.fetch = originalFetch;
  console.warn = originalConsoleWarn;
});
