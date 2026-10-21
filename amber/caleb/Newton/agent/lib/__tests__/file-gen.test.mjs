/**
 * file-gen.test.mjs — Smoke tests for the PR-G file-generation surface.
 *
 * Validates that each executor:
 *   - builds the right byte format (ZIP magic for docx/xlsx; UTF-8 round
 *     trip for csv/md/txt/json/code)
 *   - returns the correct `<kind>_url` shape and mime type
 *   - round-trips through the image-host (getImage by id pulls back the
 *     same bytes with the right mime)
 *
 * Run: cd Newton/agent && node --test lib/__tests__/file-gen.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// resolvePublicBase reads process.env at call time, not module-load, so we
// just need this set before the first executor call.
process.env.PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://test.local";

const { executeFileGenTool } = await import("../tools/file-gen.js");
const { getImage } = await import("../image-host.js");
const XLSX = await import("xlsx");

// ZIP local-file-header magic: 0x50 0x4B 0x03 0x04 ("PK\x03\x04")
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function extractId(url, ext) {
  const re = new RegExp(`/image/([a-f0-9]+)\\.${ext}$`);
  const m = url.match(re);
  return m ? m[1] : null;
}

test("generate_docx produces a real DOCX (ZIP) stored under docx_url", async () => {
  const result = await executeFileGenTool("generate_docx", {
    content: "Hello world\n\nSecond paragraph.",
    title: "My Doc",
  });
  assert.equal(result.ok, true, "expected ok=true");
  assert.equal(typeof result.docx_url, "string");
  assert.match(
    result.docx_url,
    /^https:\/\/test\.local\/image\/[a-f0-9]+\.docx$/,
  );
  assert.ok(
    result.byteLength > 100,
    `byteLength too small: ${result.byteLength}`,
  );
  assert.equal(
    result.mime_type,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(result.filename, "document.docx");

  const id = extractId(result.docx_url, "docx");
  assert.ok(id, "docx_url should contain an id");
  const entry = getImage(id);
  assert.ok(entry, "image-host should return an entry for the id");
  assert.equal(
    entry.mimeType,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  // DOCX is a ZIP; verify the local-file-header magic.
  assert.deepEqual(
    entry.buffer.subarray(0, 4),
    ZIP_MAGIC,
    "expected ZIP magic",
  );
});

test("generate_xlsx produces a real XLSX (ZIP) stored under xlsx_url", async () => {
  const result = await executeFileGenTool("generate_xlsx", {
    rows: [
      ["a", "b", "c"],
      [1, 2, 3],
      [4, 5, 6],
    ],
    sheet_name: "Numbers",
    filename: "my_sheet",
  });
  assert.equal(result.ok, true);
  assert.equal(typeof result.xlsx_url, "string");
  assert.match(
    result.xlsx_url,
    /^https:\/\/test\.local\/image\/[a-f0-9]+\.xlsx$/,
  );
  assert.ok(result.byteLength > 100);
  assert.equal(
    result.mime_type,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.equal(result.filename, "my_sheet.xlsx");

  const id = extractId(result.xlsx_url, "xlsx");
  const entry = getImage(id);
  assert.ok(entry);
  assert.deepEqual(
    entry.buffer.subarray(0, 4),
    ZIP_MAGIC,
    "expected ZIP magic",
  );

  // Re-read with SheetJS to confirm the sheet name landed.
  const wb = XLSX.read(entry.buffer, { type: "buffer" });
  assert.deepEqual(wb.SheetNames, ["Numbers"]);
});

test("generate_xlsx multi-sheet produces both sheets in workbook", async () => {
  const result = await executeFileGenTool("generate_xlsx", {
    sheets: [
      {
        name: "Alpha",
        rows: [
          ["x", "y"],
          [1, 2],
        ],
      },
      {
        name: "Beta",
        rows: [
          ["p", "q"],
          [3, 4],
        ],
      },
    ],
  });
  assert.equal(result.ok, true);
  const id = extractId(result.xlsx_url, "xlsx");
  const entry = getImage(id);
  assert.ok(entry);
  const wb = XLSX.read(entry.buffer, { type: "buffer" });
  assert.equal(
    wb.SheetNames.length,
    2,
    `expected 2 sheets, got ${wb.SheetNames.length}`,
  );
  assert.deepEqual(wb.SheetNames, ["Alpha", "Beta"]);
});

test("generate_csv from rows produces escaped CSV text", async () => {
  const result = await executeFileGenTool("generate_csv", {
    rows: [
      ["a", "b"],
      [1, 2],
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.mime_type, "text/csv");
  assert.equal(result.filename, "data.csv");
  const id = extractId(result.csv_url, "csv");
  const entry = getImage(id);
  assert.ok(entry);
  assert.equal(entry.buffer.toString("utf8"), "a,b\n1,2\n");
});

test("generate_csv from raw string passes through verbatim", async () => {
  const result = await executeFileGenTool("generate_csv", {
    csv: "one,two\n3,4\n",
    filename: "passthrough",
  });
  assert.equal(result.ok, true);
  assert.equal(result.filename, "passthrough.csv");
  const id = extractId(result.csv_url, "csv");
  const entry = getImage(id);
  assert.equal(entry.buffer.toString("utf8"), "one,two\n3,4\n");
});

test("generate_markdown round-trips UTF-8 content", async () => {
  const md = "# Heading\n\nBody with *emphasis* and `code`.";
  const result = await executeFileGenTool("generate_markdown", {
    content: md,
    filename: "notes",
  });
  assert.equal(result.ok, true);
  assert.equal(result.mime_type, "text/markdown");
  assert.equal(result.filename, "notes.md");
  const id = extractId(result.md_url, "md");
  const entry = getImage(id);
  assert.equal(entry.buffer.toString("utf8"), md);
  assert.equal(entry.mimeType, "text/markdown");
});

test("generate_text round-trips and uses text/plain mime", async () => {
  const text = "line one\nline two\n";
  const result = await executeFileGenTool("generate_text", {
    content: text,
  });
  assert.equal(result.ok, true);
  assert.equal(result.mime_type, "text/plain");
  assert.equal(result.filename, "document.txt");
  const id = extractId(result.txt_url, "txt");
  const entry = getImage(id);
  assert.equal(entry.buffer.toString("utf8"), text);
  assert.equal(entry.mimeType, "text/plain");
});

test("generate_json stringifies with 2-space indent", async () => {
  const data = { name: "Camber", dimensions: ["spiritual", "emotional"] };
  const result = await executeFileGenTool("generate_json", { data });
  assert.equal(result.ok, true);
  assert.equal(result.mime_type, "application/json");
  assert.equal(result.filename, "data.json");
  const id = extractId(result.json_url, "json");
  const entry = getImage(id);
  const expected = JSON.stringify(data, null, 2);
  assert.equal(entry.buffer.toString("utf8"), expected);
  // Sanity check: 2-space indent is present in the formatted output.
  assert.ok(expected.includes('\n  "name": "Camber"'));
});

test("generate_code_file with language=py produces .py and stores verbatim", async () => {
  const code = "def hello():\n    print('hi')\n";
  const result = await executeFileGenTool("generate_code_file", {
    content: code,
    language: "py",
    filename: "greet",
  });
  assert.equal(result.ok, true);
  assert.equal(result.language, "py");
  assert.equal(result.filename, "greet.py");
  assert.equal(result.mime_type, "text/plain");
  const id = extractId(result.file_url, "py");
  const entry = getImage(id);
  assert.equal(entry.buffer.toString("utf8"), code);
});
