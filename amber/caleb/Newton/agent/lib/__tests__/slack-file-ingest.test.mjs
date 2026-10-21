/**
 * Regression tests for Slack file ingest (Tab 8 deferred path).
 *
 * Tab 8 of the 2026-05-28 dispatch shipped iMessage attachment OCR via
 * attachment-ingest.js but explicitly deferred Slack file shares. event.files
 * was silently dropped — Shirley could attach a PDF in Slack and Medha would
 * see an empty bubble. This file pins:
 *
 *   1. ingestSlackFiles downloads each file with Bearer SLACK_BOT_TOKEN,
 *      stores it via the existing image-host helper, and returns a list of
 *      plain public URLs that Mistral OCR can fetch without auth.
 *   2. PDFs and PNGs both round-trip cleanly (image-host now accepts pdf).
 *   3. Failures per file are isolated and degrade silently.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/slack-file-ingest.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ingestSlackFiles } from "../transports/slack/index.js";
import {
  classifyAttachment,
  summarizeAttachmentForPrompt,
} from "../attachments.js";
import { processInboundAttachments } from "../attachment-ingest.js";

// Suppress noisy info logs during the run.
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
console.log = () => {};
console.warn = () => {};

function makeFakeResponse({ status = 200, bytes = Buffer.from("X") } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async arrayBuffer() {
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
    },
  };
}

test("ingestSlackFiles downloads a PDF with bot token auth and returns a hosted URL", async () => {
  const fetchCalls = [];
  const fakeBytes = Buffer.from("%PDF-1.4 fake-bytes-for-test");
  const fakeFetch = async (url, init) => {
    fetchCalls.push({ url, init });
    return makeFakeResponse({ bytes: fakeBytes });
  };
  const stored = [];
  const fakeStore = (buf, mime) => {
    stored.push({ buf, mime });
    return "deadbeef";
  };

  const urls = await ingestSlackFiles(
    [
      {
        id: "F123",
        name: "deck.pdf",
        mimetype: "application/pdf",
        filetype: "pdf",
        url_private: "https://files.slack.com/files-pri/T-U/F123/deck.pdf",
        url_private_download:
          "https://files.slack.com/files-pri/T-U/F123/download/deck.pdf",
        size: fakeBytes.length,
      },
    ],
    {
      botToken: "xoxb-test-token",
      publicBase: "https://medha.example",
      fetch: fakeFetch,
      storeImage: fakeStore,
    },
  );

  assert.equal(urls.length, 1);
  assert.equal(urls[0], "https://medha.example/image/deadbeef.pdf");
  assert.equal(fetchCalls.length, 1);
  // Prefer the download URL so Slack returns the raw bytes, not the HTML shell.
  assert.equal(
    fetchCalls[0].url,
    "https://files.slack.com/files-pri/T-U/F123/download/deck.pdf",
  );
  assert.equal(
    fetchCalls[0].init.headers.Authorization,
    "Bearer xoxb-test-token",
  );
  assert.equal(stored.length, 1);
  assert.equal(stored[0].mime, "application/pdf");
  assert.deepEqual(stored[0].buf, fakeBytes);
});

test("ingestSlackFiles falls back to url_private when url_private_download is missing", async () => {
  const fetchCalls = [];
  const fakeFetch = async (url, init) => {
    fetchCalls.push({ url, init });
    return makeFakeResponse({ bytes: Buffer.from([1, 2, 3]) });
  };
  const urls = await ingestSlackFiles(
    [
      {
        id: "F456",
        name: "photo.png",
        mimetype: "image/png",
        filetype: "png",
        url_private: "https://files.slack.com/files-pri/T-U/F456/photo.png",
        size: 3,
      },
    ],
    {
      botToken: "xoxb-x",
      publicBase: "https://medha.example",
      fetch: fakeFetch,
      storeImage: () => "abc12345",
    },
  );
  assert.equal(urls.length, 1);
  assert.equal(urls[0], "https://medha.example/image/abc12345.png");
  assert.equal(
    fetchCalls[0].url,
    "https://files.slack.com/files-pri/T-U/F456/photo.png",
  );
});

test("ingestSlackFiles isolates per-file failures (download 403 on one, success on the other)", async () => {
  const fakeFetch = async (url) => {
    if (url.includes("FBAD")) return makeFakeResponse({ status: 403 });
    return makeFakeResponse({ bytes: Buffer.from("good") });
  };
  const urls = await ingestSlackFiles(
    [
      {
        id: "FBAD",
        name: "bad.pdf",
        mimetype: "application/pdf",
        url_private: "https://files.slack.com/FBAD",
      },
      {
        id: "FGOOD",
        name: "good.pdf",
        mimetype: "application/pdf",
        url_private: "https://files.slack.com/FGOOD",
      },
    ],
    {
      botToken: "xoxb",
      publicBase: "https://medha.example",
      fetch: fakeFetch,
      storeImage: () => "abcd1234",
    },
  );
  assert.equal(urls.length, 1, "only the successful file becomes a URL");
  assert.match(urls[0], /\/image\/abcd1234\.pdf$/);
});

test("ingestSlackFiles returns empty when SLACK_BOT_TOKEN is unset", async () => {
  const urls = await ingestSlackFiles(
    [
      {
        id: "F",
        url_private: "https://files.slack.com/F",
        mimetype: "application/pdf",
      },
    ],
    {
      botToken: null,
      publicBase: "https://medha.example",
      fetch: async () => makeFakeResponse(),
      storeImage: () => "x",
    },
  );
  assert.deepEqual(urls, []);
});

test("ingestSlackFiles returns empty when PUBLIC_BASE_URL is unset", async () => {
  const urls = await ingestSlackFiles(
    [
      {
        id: "F",
        url_private: "https://files.slack.com/F",
        mimetype: "application/pdf",
      },
    ],
    {
      botToken: "xoxb",
      publicBase: null,
      fetch: async () => makeFakeResponse(),
      storeImage: () => "x",
    },
  );
  assert.deepEqual(urls, []);
});

test("ingestSlackFiles skips unsupported mime types", async () => {
  const urls = await ingestSlackFiles(
    [
      {
        id: "F",
        name: "video.mp4",
        mimetype: "video/mp4",
        url_private: "https://files.slack.com/F",
      },
    ],
    {
      botToken: "xoxb",
      publicBase: "https://medha.example",
      fetch: async () => makeFakeResponse({ bytes: Buffer.from("x") }),
      storeImage: () => "x",
    },
  );
  assert.deepEqual(urls, []);
});

test("classifyAttachment recognizes the hosted /image/<id>.pdf URL as a PDF (round-trip into OCR pipeline)", () => {
  // End-to-end shape: the URL ingestSlackFiles returns is what
  // processInboundAttachments classifies. If this drifts, the OCR call sees
  // kind=unknown and the prompt would carry only the marker, no text.
  const c = classifyAttachment("https://medha.example/image/deadbeef.pdf");
  assert.equal(c.kind, "pdf");
  assert.equal(c.mime, "application/pdf");
});

test("processInboundAttachments + a hosted Slack PDF URL produce the right [attached: ...] marker + OCR text in the prompt prefix", async () => {
  // End-to-end smoke: drop a hosted URL into the same OCR path Loop uses,
  // mock the OCR executor (no Mistral), and assert the prompt prefix shape.
  // This is the contract handleWebhookMessage's attachment block prepends
  // to the user turn.
  const hostedUrl = "https://medha.example/image/deadbeef.pdf";
  const fakeOcr = async (toolName, args, ctx) => {
    assert.equal(toolName, "ocr_extract_text");
    assert.equal(args.url, hostedUrl);
    assert.equal(args.type, "document_url");
    assert.ok(ctx.tenant, "tenant context is passed through to the tool");
    return {
      text: "Q4 results: revenue up 18%, margin steady.",
      page_count: 1,
    };
  };
  const { extractedText, perAttachmentSummary } =
    await processInboundAttachments({
      tenant: { phoneNumber: "+15558675309", contextRepo: null },
      urls: [hostedUrl],
      contact: "slack:T:U",
      messageId: "evt_abc",
      ocrExecutor: fakeOcr,
    });

  assert.equal(perAttachmentSummary.length, 1);
  assert.equal(perAttachmentSummary[0].kind, "pdf");
  assert.equal(perAttachmentSummary[0].ok, true);
  assert.match(extractedText, /\[attached: deadbeef\.pdf — PDF, 1 page\]/);
  assert.match(extractedText, /Q4 results: revenue up 18%/);
});

test("summarizeAttachmentForPrompt produces the marker the agent loop prepends", () => {
  const c = classifyAttachment("https://medha.example/image/abcd1234.png");
  const marker = summarizeAttachmentForPrompt({ ...c, pageCount: null });
  assert.equal(marker, "[attached: abcd1234.png — image]");
});

test.after(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
});
