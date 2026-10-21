/**
 * Integration tests for attachment-ingest's new file-extract path.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/attachment-ingest-files.test.mjs
 *
 * Both `ocrExecutor` and `fileExtractor` are injected so the test never
 * touches Mistral or the network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { processInboundAttachments } from "../attachment-ingest.js";

test("processInboundAttachments: docx routes through file-extract and inlines text", async () => {
  let extractorCalls = 0;
  const fileExtractor = async ({ url, kind }) => {
    extractorCalls++;
    assert.equal(kind, "docx");
    assert.match(url, /\.docx$/);
    return {
      text: "DOCX contents: hello from mammoth",
      source: "mammoth",
    };
  };
  const ocrExecutor = async () => {
    throw new Error("OCR should not be called for docx");
  };

  const r = await processInboundAttachments({
    tenant: { phoneNumber: "+1555", privyDid: "did:test" },
    urls: ["https://loop.example/resume.docx"],
    ocrExecutor,
    fileExtractor,
  });

  assert.equal(extractorCalls, 1);
  assert.match(r.extractedText, /\[attached: resume\.docx — DOCX\]/);
  assert.match(r.extractedText, /DOCX contents: hello from mammoth/);
  assert.equal(r.perAttachmentSummary.length, 1);
  assert.equal(r.perAttachmentSummary[0].ok, true);
  assert.equal(r.perAttachmentSummary[0].source, "mammoth");
});

test("processInboundAttachments: indexes extracted file content as chunks (Tab 14)", async () => {
  const fileExtractor = async () => ({
    text:
      "--- sheet: Q3 ---\nmetric,value\nrevenue,1200000\n\n" +
      "--- sheet: Q4 ---\nmetric,value\nrevenue,1500000",
    pageCount: 2,
    source: "xlsx",
  });
  const ocrExecutor = async () => {
    throw new Error("OCR should not be called for xlsx");
  };

  let savedItems = null;
  let savedTenant = null;
  const saveMemoriesFn = async (items, tenant) => {
    savedItems = items;
    savedTenant = tenant;
  };

  const tenant = { phoneNumber: "+1555", privyDid: "did:test" };
  const r = await processInboundAttachments({
    tenant,
    urls: ["https://loop.example/financials.xlsx"],
    contact: "+13105551234",
    messageId: "msg-abc",
    ocrExecutor,
    fileExtractor,
    saveMemoriesFn,
  });

  // One chunk per sheet.
  assert.equal(r.chunksIndexed, 2);
  assert.ok(Array.isArray(savedItems));
  assert.equal(savedItems.length, 2);
  assert.equal(savedTenant, tenant);

  const first = savedItems[0];
  assert.equal(first.category, "file_content");
  assert.deepEqual(first.dimensions, ["intellectual"]);
  assert.equal(first.source, "https://loop.example/financials.xlsx");
  assert.equal(first.extra.extractor, "xlsx");
  assert.equal(first.extra.file_kind, "xlsx");
  assert.equal(first.extra.filename, "financials.xlsx");
  assert.equal(first.extra.page_or_section, "sheet:Q3");
  assert.equal(first.extra.chunk_count, 2);
  assert.equal(first.extra.contact, "+13105551234");
  assert.equal(first.extra.messageId, "msg-abc");
  assert.match(first.content, /revenue,1200000/);
  assert.equal(savedItems[1].extra.page_or_section, "sheet:Q4");
});

test("processInboundAttachments: does not index when extraction yields no text", async () => {
  const fileExtractor = async () => ({
    error: "Legacy .doc not supported; please re-save as .docx",
    source: "legacy_office_unsupported",
  });
  let saveCalled = false;
  const saveMemoriesFn = async () => {
    saveCalled = true;
  };

  const r = await processInboundAttachments({
    tenant: { phoneNumber: "+1555" },
    urls: ["https://loop.example/old.doc"],
    ocrExecutor: async () => {
      throw new Error("no OCR for .doc");
    },
    fileExtractor,
    saveMemoriesFn,
  });

  assert.equal(r.chunksIndexed, 0);
  assert.equal(saveCalled, false);
});

test("processInboundAttachments: legacy .doc surfaces error marker with re-save hint", async () => {
  let extractorCalls = 0;
  const fileExtractor = async ({ kind }) => {
    extractorCalls++;
    assert.equal(kind, "doc");
    return {
      error: "Legacy .doc not supported; please re-save as .docx",
      source: "legacy_office_unsupported",
    };
  };
  const ocrExecutor = async () => {
    throw new Error("OCR should not be called for .doc");
  };

  const r = await processInboundAttachments({
    tenant: { phoneNumber: "+1555" },
    urls: ["https://loop.example/oldresume.doc"],
    ocrExecutor,
    fileExtractor,
  });

  assert.equal(extractorCalls, 1);
  assert.match(r.extractedText, /\[attached: oldresume\.doc — DOC\]/);
  assert.match(r.extractedText, /\[error: Legacy \.doc not supported/);
  // No inlined body text beyond the marker + error.
  assert.doesNotMatch(r.extractedText, /hello from mammoth/);
  assert.equal(r.perAttachmentSummary[0].ok, false);
  assert.match(r.perAttachmentSummary[0].error, /re-save as \.docx/);
});
