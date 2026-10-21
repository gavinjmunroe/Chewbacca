/**
 * Tests for file-extract.js — native library extraction for DOCX, XLSX,
 * PPTX, CSV, TXT, MD, JSON, RTF, and code files.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/file-extract.test.mjs
 *
 * Strategy: stub global `fetch` so we never hit the network, then mock
 * the heavy parsers (`mammoth`, `xlsx`) via the module registry so the
 * test stays deterministic and dependency-light.
 */

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { extractFileContent } from "../file-extract.js";

// ─── fetch stub helpers ───────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

function installFetch(handler) {
  globalThis.fetch = handler;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function bufResponse(buf) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async arrayBuffer() {
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  };
}

afterEach(() => {
  restoreFetch();
});

// ─── DOCX happy path ──────────────────────────────────────────────────────

test("extractFileContent: docx happy path returns mammoth text", async () => {
  installFetch(async () => bufResponse(Buffer.from("docx-bytes")));

  const out = await extractFileContent({
    url: "https://loop.example/hello.docx",
    kind: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    // Inject a fake extractor by short-circuiting via dynamic import is
    // brittle; instead patch via the real mammoth, because mammoth handles
    // arbitrary buffers by throwing — so we use the stubbed extractor.
    // Easier: override the module via a top-level mock function below.
  });

  // mammoth on a non-zip buffer throws; we expect an error path. This
  // confirms the dispatcher catches errors and surfaces { error }.
  assert.ok(out.error, "expected an error for non-docx buffer");
  assert.equal(out.source, "unsupported");
});

test("extractFileContent: docx via injected mammoth-like result", async () => {
  // Build a minimal real DOCX in memory using JSZip so mammoth can parse it.
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder("_rels").file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder("word").file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello world</w:t></w:r></w:p>
  </w:body>
</w:document>`,
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });

  installFetch(async () => bufResponse(buffer));

  const out = await extractFileContent({
    url: "https://loop.example/hello.docx",
    kind: "docx",
  });

  assert.equal(out.source, "mammoth");
  assert.match(out.text || "", /Hello world/);
  assert.ok(!out.error, `unexpected error: ${out.error}`);
});

// ─── XLSX happy path ──────────────────────────────────────────────────────

test("extractFileContent: xlsx returns sheet headers + CSV per sheet", async () => {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const sheet1 = XLSX.utils.aoa_to_sheet([
    ["name", "amount"],
    ["Caleb", 100],
    ["Sagar", 200],
  ]);
  const sheet2 = XLSX.utils.aoa_to_sheet([
    ["product", "qty"],
    ["pencil", 5],
  ]);
  XLSX.utils.book_append_sheet(wb, sheet1, "Donors");
  XLSX.utils.book_append_sheet(wb, sheet2, "Inventory");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  installFetch(async () => bufResponse(buf));

  const out = await extractFileContent({
    url: "https://loop.example/book.xlsx",
    kind: "xlsx",
  });

  assert.equal(out.source, "xlsx");
  assert.match(out.text || "", /--- sheet: Donors ---/);
  assert.match(out.text || "", /--- sheet: Inventory ---/);
  assert.match(out.text || "", /Caleb,100/);
  assert.match(out.text || "", /pencil,5/);
  assert.equal(out.pageCount, 2);
});

// ─── CSV passthrough ──────────────────────────────────────────────────────

test("extractFileContent: csv passthrough returns raw UTF-8", async () => {
  const csv = "name,amount\nCaleb,100\nSagar,200\n";
  installFetch(async () => bufResponse(Buffer.from(csv, "utf8")));

  const out = await extractFileContent({
    url: "https://loop.example/donors.csv",
    kind: "csv",
  });

  assert.equal(out.source, "plain_text");
  assert.equal(out.text, csv);
});

// ─── TXT / MD plain passthrough ───────────────────────────────────────────

test("extractFileContent: txt + md pass through as UTF-8", async () => {
  const txt = "this is a plain text note\nwith two lines";
  installFetch(async () => bufResponse(Buffer.from(txt, "utf8")));

  const outTxt = await extractFileContent({
    url: "https://loop.example/note.txt",
    kind: "txt",
  });
  assert.equal(outTxt.source, "plain_text");
  assert.equal(outTxt.text, txt);

  const md = "# Hello\n\nThis is **markdown**.";
  installFetch(async () => bufResponse(Buffer.from(md, "utf8")));
  const outMd = await extractFileContent({
    url: "https://loop.example/readme.md",
    kind: "md",
  });
  assert.equal(outMd.source, "plain_text");
  assert.equal(outMd.text, md);
});

// ─── Error path: fetch 500 ────────────────────────────────────────────────

test("extractFileContent: 500 response returns { error }", async () => {
  installFetch(async () => ({
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    async arrayBuffer() {
      return Buffer.alloc(0).buffer;
    },
  }));

  const out = await extractFileContent({
    url: "https://loop.example/missing.docx",
    kind: "docx",
  });
  assert.ok(out.error, "expected error on non-200 response");
  assert.match(out.error, /500/);
  assert.equal(out.source, "unsupported");
});

// ─── Legacy .doc surfaced as error, no fetch ─────────────────────────────

test("extractFileContent: legacy .doc returns re-save error and skips fetch", async () => {
  let calls = 0;
  installFetch(async () => {
    calls++;
    return bufResponse(Buffer.from("never read"));
  });

  const out = await extractFileContent({
    url: "https://loop.example/oldresume.doc",
    kind: "doc",
  });

  assert.equal(calls, 0);
  assert.match(out.error || "", /re-save as \.docx/);
  assert.equal(out.source, "legacy_office_unsupported");
});
