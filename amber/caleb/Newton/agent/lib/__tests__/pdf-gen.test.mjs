/**
 * pdf-gen.test.mjs — Smoke test for the generate_pdf tool.
 *
 * Validates that the executor:
 *   - builds a real PDF (starts with the %PDF magic bytes)
 *   - returns a non-trivial byteLength (> 100)
 *   - returns a pdf_url under the configured public base
 *   - round-trips through the image-host (getImage by id pulls back the
 *     same bytes with application/pdf mime type)
 *
 * Run: node --test lib/__tests__/pdf-gen.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Set the public base BEFORE importing the tool — resolvePublicBase
// reads process.env at call time, not module-load, so this just needs
// to be set before generatePdf runs.
process.env.PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://test.local";

const { executePdfGenTool } = await import("../tools/pdf-gen.js");
const { getImage } = await import("../image-host.js");

test("generate_pdf produces a real PDF and stores it under a pdf_url", async () => {
  const result = await executePdfGenTool("generate_pdf", {
    content: "Fortnite",
  });

  assert.equal(result.ok, true, "expected ok=true");
  assert.equal(typeof result.pdf_url, "string", "expected pdf_url string");
  assert.match(
    result.pdf_url,
    /^https:\/\/test\.local\/image\/[a-f0-9]+\.pdf$/,
    "pdf_url should be under the configured public base",
  );
  assert.ok(
    result.byteLength > 100,
    `byteLength too small: ${result.byteLength}`,
  );
  assert.equal(result.mime_type, "application/pdf");

  // Round-trip through the image-host: pull the id out of the URL and
  // confirm the buffer we stored is a valid PDF.
  const idMatch = result.pdf_url.match(/\/image\/([a-f0-9]+)\.pdf$/);
  assert.ok(idMatch, "pdf_url should contain an id");
  const entry = getImage(idMatch[1]);
  assert.ok(entry, "image-host should return an entry for the id");
  assert.equal(entry.mimeType, "application/pdf");

  const magic = entry.buffer.subarray(0, 4).toString("ascii");
  assert.equal(magic, "%PDF", `expected %PDF magic bytes, got ${magic}`);
});

test("generate_pdf rejects missing content", async () => {
  const result = await executePdfGenTool("generate_pdf", {});
  assert.ok(result.error, "expected error for missing content");
});

test("generate_pdf honors an explicit title", async () => {
  const result = await executePdfGenTool("generate_pdf", {
    content: "Body line one\n\nBody line two",
    title: "My Doc",
  });
  assert.equal(result.ok, true);
  assert.equal(result.title, "My Doc");
});

test("generate_pdf derives a title from the first line when none given", async () => {
  const result = await executePdfGenTool("generate_pdf", {
    content: "# Big Heading\n\nsome body",
  });
  assert.equal(result.ok, true);
  assert.equal(result.title, "Big Heading");
});

test("generate_pdf sanitizes em dashes and smart quotes without throwing", async () => {
  const result = await executePdfGenTool("generate_pdf", {
    content: "Quote: “hello” — world",
    title: "Smart “Quotes”",
  });
  assert.equal(result.ok, true);
  assert.ok(result.byteLength > 100);
});
