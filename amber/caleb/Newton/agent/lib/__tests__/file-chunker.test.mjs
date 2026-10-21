/**
 * Tests for file-chunker.js — splitting extracted file text into
 * Pinecone-sized chunks (Tab 14).
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/file-chunker.test.mjs
 *
 * Pure module: no network, no mocks. We assert chunk counts, section
 * labels, ordering, overlap, and the metadata contract the ingest layer
 * relies on.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { chunkFileText, windowChunks, __constants } from "../file-chunker.js";

const { TARGET_CHARS, OVERLAP_CHARS, MAX_CHUNKS_PER_FILE } = __constants;

// ─── windowChunks (sliding window primitive) ──────────────────────────────

test("windowChunks returns one chunk when text fits in target", () => {
  const out = windowChunks("short text");
  assert.deepEqual(out, ["short text"]);
});

test("windowChunks splits long text into overlapping windows", () => {
  const text = "a".repeat(TARGET_CHARS * 2 + 500);
  const out = windowChunks(text);
  assert.ok(out.length >= 2, "expected multiple windows");
  // Each window is at most TARGET_CHARS long.
  for (const c of out) assert.ok(c.length <= TARGET_CHARS);
  // Neighboring windows overlap: combined length exceeds the source length
  // by roughly OVERLAP_CHARS per boundary.
  const totalLen = out.reduce((n, c) => n + c.length, 0);
  assert.ok(totalLen > text.length, "windows should overlap");
});

test("windowChunks ignores empty / whitespace input", () => {
  assert.deepEqual(windowChunks(""), []);
  assert.deepEqual(windowChunks("   \n  "), []);
});

// ─── chunkFileText: empty / unknown ────────────────────────────────────────

test("chunkFileText returns [] for empty text", () => {
  assert.deepEqual(chunkFileText({ text: "", kind: "txt" }), []);
  assert.deepEqual(chunkFileText({ text: "   ", kind: "pdf" }), []);
  assert.deepEqual(chunkFileText({}), []);
});

test("chunkFileText returns indexed chunks with text+section", () => {
  const chunks = chunkFileText({ text: "hello world", kind: "txt" });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, "hello world");
  assert.equal(chunks[0].section, "part:1");
  assert.equal(chunks[0].index, 0);
});

// ─── XLSX: per sheet ───────────────────────────────────────────────────────

test("chunkFileText splits XLSX by sheet delimiter", () => {
  const text =
    "--- sheet: Revenue ---\ncol1,col2\n1,2\n\n" +
    "--- sheet: Costs ---\ncolA,colB\n3,4";
  const chunks = chunkFileText({ text, kind: "xlsx" });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].section, "sheet:Revenue");
  assert.equal(chunks[1].section, "sheet:Costs");
  assert.match(chunks[0].text, /col1,col2/);
  assert.match(chunks[1].text, /colA,colB/);
  // Indexes are sequential.
  assert.deepEqual(
    chunks.map((c) => c.index),
    [0, 1],
  );
});

// ─── PPTX: per slide ───────────────────────────────────────────────────────

test("chunkFileText splits PPTX by slide delimiter", () => {
  const text =
    "--- slide 1 ---\nTitle\nClay overview\n\n" + "--- slide 2 ---\nNext steps";
  const chunks = chunkFileText({ text, kind: "pptx" });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].section, "slide:1");
  assert.equal(chunks[1].section, "slide:2");
  assert.match(chunks[0].text, /Clay overview/);
});

// ─── CSV: per row group ────────────────────────────────────────────────────

test("chunkFileText groups CSV rows and repeats the header", () => {
  const header = "name,score";
  const rows = Array.from({ length: 120 }, (_, i) => `row${i},${i}`);
  const text = [header, ...rows].join("\n");
  const chunks = chunkFileText({ text, kind: "csv" });
  // 120 data rows / 50 per chunk = 3 chunks.
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].section, "rows:1-50");
  assert.equal(chunks[1].section, "rows:51-100");
  assert.equal(chunks[2].section, "rows:101-120");
  // Header travels with every chunk so columns stay meaningful in isolation.
  for (const c of chunks) {
    assert.ok(c.text.startsWith(header), "each chunk keeps the header row");
  }
});

// ─── PDF: page delimiters when present, window otherwise ───────────────────

test("chunkFileText splits PDF on explicit page markers", () => {
  const text = "--- page 1 ---\nIntro\n--- page 2 ---\nBody";
  const chunks = chunkFileText({ text, kind: "pdf" });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].section, "page:1");
  assert.equal(chunks[1].section, "page:2");
});

test("chunkFileText windows a PDF blob with no page markers", () => {
  const text = "x".repeat(TARGET_CHARS * 2 + 100);
  const chunks = chunkFileText({ text, kind: "pdf" });
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].section, "part:1");
  assert.equal(chunks[1].section, "part:2");
});

// ─── DOCX: paragraph packing ───────────────────────────────────────────────

test("chunkFileText packs DOCX paragraphs under the target size", () => {
  const para = "p".repeat(800);
  const text = [para, para, para, para].join("\n\n");
  const chunks = chunkFileText({ text, kind: "docx" });
  // 4 x 800-char paragraphs packed into ~2000-char chunks -> 2 chunks.
  assert.ok(chunks.length >= 2);
  for (const c of chunks) assert.ok(c.text.length <= TARGET_CHARS + 4);
  assert.equal(chunks[0].section, "part:1");
});

// ─── Cap ───────────────────────────────────────────────────────────────────

test("chunkFileText caps the number of chunks per file", () => {
  // Build many CSV rows that would otherwise exceed the cap.
  const rows = Array.from(
    { length: 50 * (MAX_CHUNKS_PER_FILE + 10) },
    (_, i) => `r${i}`,
  );
  const text = ["h", ...rows].join("\n");
  const chunks = chunkFileText({ text, kind: "csv" });
  assert.ok(chunks.length <= MAX_CHUNKS_PER_FILE);
});

// ─── Metadata contract ─────────────────────────────────────────────────────

test("every chunk carries text, section, and a sequential index", () => {
  const text = "--- slide 1 ---\nA\n--- slide 2 ---\nB\n--- slide 3 ---\nC";
  const chunks = chunkFileText({ text, kind: "pptx" });
  chunks.forEach((c, i) => {
    assert.equal(typeof c.text, "string");
    assert.ok(c.text.length > 0);
    assert.equal(typeof c.section, "string");
    assert.equal(c.index, i);
  });
});

void OVERLAP_CHARS;
