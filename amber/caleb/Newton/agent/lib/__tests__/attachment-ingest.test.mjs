/**
 * Tests for attachment-ingest + attachments helpers.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/attachment-ingest.test.mjs
 *
 * The OCR call is injected via ocrExecutor so we never touch Mistral or
 * any module state from the tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyAttachment,
  summarizeAttachmentForPrompt,
} from "../attachments.js";
import { processInboundAttachments } from "../attachment-ingest.js";

// ── classifyAttachment ────────────────────────────────────────────────────

test("classifyAttachment: PDF by .pdf extension", () => {
  const c = classifyAttachment("https://loop.example/foo/bar.pdf");
  assert.equal(c.kind, "pdf");
  assert.equal(c.ext, "pdf");
  assert.equal(c.mime, "application/pdf");
  assert.equal(c.filename, "bar.pdf");
});

test("classifyAttachment: PNG image", () => {
  const c = classifyAttachment("https://loop.example/x/y/photo.PNG?token=abc");
  assert.equal(c.kind, "image");
  assert.equal(c.mime, "image/png");
  assert.equal(c.filename, "photo.png");
});

test("classifyAttachment: HEIC image (iPhone)", () => {
  const c = classifyAttachment("https://loop.example/IMG_0001.HEIC");
  assert.equal(c.kind, "image");
  assert.equal(c.mime, "image/heic");
});

test("classifyAttachment: docx kind for .docx", () => {
  const c = classifyAttachment("https://loop.example/resume.docx");
  assert.equal(c.kind, "docx");
});

test("classifyAttachment: unknown ext", () => {
  const c = classifyAttachment("https://loop.example/blob.bin");
  assert.equal(c.kind, "unknown");
  assert.equal(c.mime, "application/octet-stream");
});

test("classifyAttachment: bogus URL", () => {
  const c = classifyAttachment("not-a-url");
  assert.equal(c.kind, "unknown");
  assert.equal(c.filename, "");
});

// ── summarizeAttachmentForPrompt ──────────────────────────────────────────

test("summarizeAttachmentForPrompt: PDF with page count", () => {
  const s = summarizeAttachmentForPrompt({
    filename: "report.pdf",
    kind: "pdf",
    pageCount: 12,
  });
  assert.equal(s, "[attached: report.pdf — PDF, 12 pages]");
});

test("summarizeAttachmentForPrompt: image with no page count", () => {
  const s = summarizeAttachmentForPrompt({
    filename: "shot.png",
    kind: "image",
  });
  assert.equal(s, "[attached: shot.png — image]");
});

test("summarizeAttachmentForPrompt: single page", () => {
  const s = summarizeAttachmentForPrompt({
    filename: "memo.pdf",
    kind: "pdf",
    pageCount: 1,
  });
  assert.equal(s, "[attached: memo.pdf — PDF, 1 page]");
});

// ── processInboundAttachments ─────────────────────────────────────────────

test("processInboundAttachments: empty urls returns empty", async () => {
  const r = await processInboundAttachments({ tenant: null, urls: [] });
  assert.equal(r.extractedText, "");
  assert.deepEqual(r.perAttachmentSummary, []);
});

test("processInboundAttachments: non-array urls returns empty", async () => {
  const r = await processInboundAttachments({ tenant: null, urls: null });
  assert.equal(r.extractedText, "");
});

test("processInboundAttachments: routes PDF + image through OCR mock", async () => {
  const calls = [];
  const ocrExecutor = async (name, input) => {
    calls.push({ name, input });
    if (input.url.endsWith(".pdf")) {
      return {
        text: "## Performance summary\n\nQ1 numbers look strong.",
        page_count: 3,
        model: "mistral-ocr-latest",
      };
    }
    if (input.url.endsWith(".png")) {
      return {
        text: "Hello from the screenshot",
        page_count: 1,
        model: "mistral-ocr-latest",
      };
    }
    return { error: "unknown url" };
  };

  const r = await processInboundAttachments({
    tenant: { phoneNumber: "+1555", privyDid: "did:test" },
    urls: [
      "https://loop.example/q1-report.pdf",
      "https://loop.example/screenshot.png",
    ],
    contact: "+15551234567",
    messageId: "m-1",
    ocrExecutor,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, "ocr_extract_text");
  assert.equal(calls[0].input.type, "document_url");
  assert.equal(calls[1].input.type, "image_url");

  assert.match(r.extractedText, /\[attached: q1-report\.pdf — PDF, 3 pages\]/);
  assert.match(r.extractedText, /Performance summary/);
  assert.match(r.extractedText, /\[attached: screenshot\.png — image\]/);
  assert.match(r.extractedText, /Hello from the screenshot/);

  assert.equal(r.perAttachmentSummary.length, 2);
  assert.equal(r.perAttachmentSummary[0].ok, true);
  assert.equal(r.perAttachmentSummary[0].pageCount, 3);
});

test("processInboundAttachments: OCR error per attachment is isolated", async () => {
  const ocrExecutor = async (_name, input) => {
    if (input.url.endsWith(".pdf")) return { error: "mistral ocr 503: down" };
    return { text: "ok", page_count: 1 };
  };
  // When Mistral errors, ingest now tries the Claude-vision fallback. For
  // this isolation test we make the fallback also fail so the bad PDF
  // stays bad, then assert that the good PNG still succeeds independently.
  const claudeVisionExecutor = async () => ({
    error: "ANTHROPIC_API_KEY not configured for tenant",
  });

  const r = await processInboundAttachments({
    tenant: { phoneNumber: "+1555" },
    urls: ["https://loop.example/bad.pdf", "https://loop.example/good.png"],
    ocrExecutor,
    claudeVisionExecutor,
  });

  assert.match(r.extractedText, /\[OCR failed: mistral: mistral ocr 503: down/);
  assert.match(r.extractedText, /ok/);
  assert.equal(r.perAttachmentSummary[0].ok, false);
  assert.equal(r.perAttachmentSummary[1].ok, true);
});

test("processInboundAttachments: unsupported type surfaces a marker but no OCR call", async () => {
  let calls = 0;
  const ocrExecutor = async () => {
    calls++;
    return { text: "should not be called", page_count: 1 };
  };

  const r = await processInboundAttachments({
    tenant: { phoneNumber: "+1555" },
    urls: ["https://loop.example/blob.bin"],
    ocrExecutor,
  });

  assert.equal(calls, 0);
  assert.match(r.extractedText, /\[attached: blob\.bin — file\]/);
  assert.match(r.extractedText, /unsupported type/);
});

test("processInboundAttachments: empty-text payload (caption-less) gets marker prefix", async () => {
  const ocrExecutor = async () => ({
    text: "Receipt: total $42.10",
    page_count: 1,
  });
  const r = await processInboundAttachments({
    tenant: { phoneNumber: "+1555" },
    urls: ["https://loop.example/receipt.png"],
    ocrExecutor,
  });
  assert.match(r.extractedText, /\[attached: receipt\.png — image\]/);
  assert.match(r.extractedText, /Receipt: total \$42\.10/);
});

// ── Claude-vision fallback ────────────────────────────────────────────────

test("processInboundAttachments: falls back to Claude vision when Mistral key is missing", async () => {
  const mistralCalls = [];
  const ocrExecutor = async (_name, input) => {
    mistralCalls.push(input);
    return { error: "MISTRAL_API_KEY not configured for tenant" };
  };
  const cvCalls = [];
  const claudeVisionExecutor = async (name, input) => {
    cvCalls.push({ name, input });
    return {
      ok: true,
      text: "claude saw a PDF and read it",
      model: "claude-sonnet-4-5-20250929",
      source_url: input.url,
      type: input.type,
    };
  };
  const r = await processInboundAttachments({
    tenant: { phoneNumber: "+1555" },
    urls: ["https://loop.example/q1.pdf"],
    ocrExecutor,
    claudeVisionExecutor,
  });
  assert.equal(mistralCalls.length, 1);
  assert.equal(cvCalls.length, 1);
  assert.equal(cvCalls[0].name, "claude_vision_extract");
  assert.equal(cvCalls[0].input.type, "pdf");
  assert.match(r.extractedText, /claude saw a PDF and read it/);
  assert.equal(r.perAttachmentSummary[0].ok, true);
  assert.equal(r.perAttachmentSummary[0].source, "claude_vision");
});

test("processInboundAttachments: falls back to Claude vision for images when Mistral errors", async () => {
  const ocrExecutor = async () => ({ error: "mistral ocr 503: down" });
  const claudeVisionExecutor = async (name, input) => ({
    ok: true,
    text: "extracted via claude",
    type: input.type,
  });
  const r = await processInboundAttachments({
    tenant: { phoneNumber: "+1555" },
    urls: ["https://loop.example/img.png"],
    ocrExecutor,
    claudeVisionExecutor,
  });
  assert.match(r.extractedText, /extracted via claude/);
  assert.equal(r.perAttachmentSummary[0].source, "claude_vision");
});

test("processInboundAttachments: prefers Mistral when it returns text", async () => {
  let cvCalled = false;
  const ocrExecutor = async () => ({
    text: "mistral got it",
    page_count: 1,
  });
  const claudeVisionExecutor = async () => {
    cvCalled = true;
    return { ok: true, text: "should not be used" };
  };
  const r = await processInboundAttachments({
    tenant: { phoneNumber: "+1555" },
    urls: ["https://loop.example/x.png"],
    ocrExecutor,
    claudeVisionExecutor,
  });
  assert.equal(cvCalled, false);
  assert.match(r.extractedText, /mistral got it/);
  assert.equal(r.perAttachmentSummary[0].source, "mistral");
});

test("processInboundAttachments: both providers fail surfaces combined error", async () => {
  const ocrExecutor = async () => ({
    error: "MISTRAL_API_KEY not configured for tenant",
  });
  const claudeVisionExecutor = async () => ({
    error: "ANTHROPIC_API_KEY not configured for tenant",
  });
  const r = await processInboundAttachments({
    tenant: { phoneNumber: "+1555" },
    urls: ["https://loop.example/x.pdf"],
    ocrExecutor,
    claudeVisionExecutor,
  });
  assert.equal(r.perAttachmentSummary[0].ok, false);
  assert.match(r.perAttachmentSummary[0].error, /mistral:/);
  assert.match(r.perAttachmentSummary[0].error, /claude_vision:/);
  assert.match(r.extractedText, /OCR failed/);
});
