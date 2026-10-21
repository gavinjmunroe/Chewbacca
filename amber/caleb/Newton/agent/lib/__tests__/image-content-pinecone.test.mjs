/**
 * Tests for Tab 15 — image content -> Pinecone.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/image-content-pinecone.test.mjs
 *
 * Covers:
 *   - buildGeneratedImageMemory  (image-gen.js)  — record shape
 *   - buildImageContentMemory    (attachment-ingest.js) — record shape
 *   - memoryToPineconeItem       (memory.js) — extra-field forwarding so
 *     the records stay filterable by filename / extractor / tool / contact
 *   - processInboundAttachments  — inbound IMAGES are saved, PDFs are not
 *
 * No network: the OCR call and the memory saver are both injected.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildGeneratedImageMemory } from "../tools/image-gen.js";
import {
  buildImageContentMemory,
  processInboundAttachments,
} from "../attachment-ingest.js";
import { memoryToPineconeItem } from "../memory.js";

// ── buildGeneratedImageMemory ─────────────────────────────────────────────

test("buildGeneratedImageMemory: core shape", () => {
  const m = buildGeneratedImageMemory({
    prompt: "a golden retriever puppy in a field",
    revisedPrompt: "a fluffy golden retriever puppy in a sunny meadow",
    imageUrl: "https://medha.example/image/abc123.png",
    contact: "+15551234567",
    filename: "abc123.png",
    generatedAt: "2026-05-29T12:00:00.000Z",
  });
  assert.equal(m.category, "generated_image");
  assert.deepEqual(m.dimensions, ["intellectual"]);
  assert.equal(m.source, "https://medha.example/image/abc123.png");
  assert.equal(m.handle, "+15551234567");
  assert.match(m.content, /golden retriever puppy in a field/);
  assert.match(m.content, /revised: a fluffy golden retriever/);
  assert.equal(m.extra.tool, "gpt-image-1");
  assert.equal(m.extra.sourceUrl, "https://medha.example/image/abc123.png");
  assert.equal(m.extra.contact, "+15551234567");
  assert.equal(m.extra.filename, "abc123.png");
});

test("buildGeneratedImageMemory: no revised prompt leaves content clean", () => {
  const m = buildGeneratedImageMemory({
    prompt: "a cat wearing a tiny hat",
    imageUrl: "https://medha.example/image/cat.png",
  });
  assert.equal(m.content, "a cat wearing a tiny hat");
  assert.equal(m.handle, undefined);
});

// ── buildImageContentMemory ───────────────────────────────────────────────

test("buildImageContentMemory: core shape", () => {
  const m = buildImageContentMemory({
    text: "Clay table: 42 leads, 8 replied, 3 booked",
    url: "https://loop.example/screenshot.png",
    extractor: "claude_vision",
    contact: "+15557654321",
    filename: "screenshot.png",
    messageId: "m-99",
  });
  assert.equal(m.category, "image_content");
  assert.deepEqual(m.dimensions, ["intellectual"]);
  assert.equal(m.content, "Clay table: 42 leads, 8 replied, 3 booked");
  assert.equal(m.source, "https://loop.example/screenshot.png");
  assert.equal(m.extra.extractor, "claude_vision");
  assert.equal(m.extra.sourceUrl, "https://loop.example/screenshot.png");
  assert.equal(m.extra.messageId, "m-99");
});

// ── memoryToPineconeItem forwarding (filterability) ───────────────────────

test("memoryToPineconeItem: forwards visual metadata into extra", () => {
  const item = memoryToPineconeItem(
    buildImageContentMemory({
      text: "a screenshot",
      url: "https://loop.example/x.png",
      extractor: "mistral",
      contact: "+1555",
      filename: "x.png",
      messageId: "m-1",
    }),
  );
  assert.equal(item.kind, "image_content");
  assert.equal(item.healthDimension, "intellectual");
  assert.equal(item.source, "https://loop.example/x.png");
  // These become top-level queryable metadata in pinecone.js, which is what
  // makes kind/extractor/filename filtering work on the read side.
  assert.equal(item.extra.extractor, "mistral");
  assert.equal(item.extra.filename, "x.png");
  assert.equal(item.extra.contact, "+1555");
  assert.equal(item.extra.sourceUrl, "https://loop.example/x.png");
  assert.equal(item.extra.messageId, "m-1");
});

test("memoryToPineconeItem: forwards generated-image tool field", () => {
  const item = memoryToPineconeItem(
    buildGeneratedImageMemory({
      prompt: "a logo",
      imageUrl: "https://medha.example/image/logo.png",
      contact: "+1555",
    }),
  );
  assert.equal(item.kind, "generated_image");
  assert.equal(item.extra.tool, "gpt-image-1");
  assert.equal(item.extra.sourceUrl, "https://medha.example/image/logo.png");
});

// ── processInboundAttachments: image saved, pdf not ───────────────────────

test("processInboundAttachments: inbound image is indexed, PDF is not", async () => {
  const ocrExecutor = async (_name, input) => {
    if (input.url.endsWith(".pdf")) {
      return { text: "Q3 revenue grew", page_count: 2, model: "mistral" };
    }
    return { text: "screenshot of a Clay table", page_count: 1 };
  };

  const saved = [];
  const memorySaver = async (memory, tenant) => {
    saved.push({ memory, tenant });
  };

  const r = await processInboundAttachments({
    tenant: { privyDid: "did:test", phoneNumber: "+1555" },
    urls: ["https://loop.example/deck.pdf", "https://loop.example/clay.png"],
    contact: "+15551234567",
    messageId: "m-7",
    ocrExecutor,
    memorySaver,
  });

  // Both extracted into the prompt block.
  assert.match(r.extractedText, /Q3 revenue grew/);
  assert.match(r.extractedText, /screenshot of a Clay table/);

  // Only the image was saved to Pinecone (PDF is Tab 14's file_content).
  assert.equal(saved.length, 1);
  assert.equal(saved[0].memory.category, "image_content");
  assert.equal(saved[0].memory.source, "https://loop.example/clay.png");
  assert.equal(saved[0].memory.content, "screenshot of a Clay table");
  assert.equal(saved[0].memory.extra.contact, "+15551234567");
  assert.equal(saved[0].memory.extra.messageId, "m-7");
  assert.equal(saved[0].memory.extra.extractor, "mistral");
  assert.equal(saved[0].tenant.privyDid, "did:test");
});

test("processInboundAttachments: failed image OCR is not indexed", async () => {
  const ocrExecutor = async () => ({ error: "mistral 503" });
  const claudeVisionExecutor = async () => ({ error: "no anthropic key" });

  const saved = [];
  const memorySaver = async (memory) => saved.push(memory);

  const r = await processInboundAttachments({
    tenant: { privyDid: "did:test" },
    urls: ["https://loop.example/broken.png"],
    ocrExecutor,
    claudeVisionExecutor,
    memorySaver,
  });

  assert.match(r.extractedText, /OCR failed/);
  assert.equal(saved.length, 0);
});

test("processInboundAttachments: memory saver failure never breaks ingest", async () => {
  const ocrExecutor = async () => ({ text: "a photo", page_count: 1 });
  const memorySaver = async () => {
    throw new Error("amber-id down");
  };

  const r = await processInboundAttachments({
    tenant: { privyDid: "did:test" },
    urls: ["https://loop.example/photo.png"],
    ocrExecutor,
    memorySaver,
  });

  // Ingest still returns the extracted text despite the save throwing.
  assert.match(r.extractedText, /a photo/);
  assert.equal(r.perAttachmentSummary[0].ok, true);
});
