/**
 * attachments.js — pure helpers for classifying and summarizing inbound
 * Loop attachments (PDFs, images, office docs, code, plain text).
 *
 * Why this module exists: Tab 8 of the 2026-05-28 dispatch wires Loop's
 * payload.attachments[] (non-audio) into the agent's OCR + file-extract
 * pipeline so PDF-only, image-only, and document-only messages stop
 * disappearing. Everything in here is deterministic and side-effect-free;
 * the I/O lives in attachment-ingest.js and file-extract.js.
 */

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
  "heif",
  "bmp",
  "tiff",
  "tif",
]);

const PDF_EXTS = new Set(["pdf"]);

// Office document extensions, mapped to specific kinds so the extractor
// can pick the right library (mammoth, xlsx, pptx-unzip, etc).
const OFFICE_KIND_BY_EXT = {
  docx: "docx",
  doc: "doc",
  xlsx: "xlsx",
  xls: "xls",
  pptx: "pptx",
  ppt: "ppt",
};

const PLAIN_TEXT_KIND_BY_EXT = {
  csv: "csv",
  txt: "txt",
  md: "md",
  markdown: "md",
  json: "json",
  rtf: "rtf",
};

const CODE_EXTS = new Set([
  "py",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "html",
  "htm",
  "css",
  "sh",
  "bash",
  "zsh",
  "yml",
  "yaml",
  "toml",
  "sql",
]);

const MIME_BY_EXT = {
  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  // PDF
  pdf: "application/pdf",
  // Office (legacy + modern)
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Plain text
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  rtf: "application/rtf",
  // Code
  py: "text/x-python",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  ts: "text/typescript",
  tsx: "text/typescript",
  jsx: "text/javascript",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  sh: "application/x-sh",
  bash: "application/x-sh",
  zsh: "application/x-sh",
  yml: "application/yaml",
  yaml: "application/yaml",
  toml: "application/toml",
  sql: "application/sql",
};

/**
 * Strip query / fragment, decode, return the last path segment lowercased.
 * Returns "" if the URL is unparseable.
 */
function pathSegment(url) {
  if (typeof url !== "string" || !url) return "";
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    return decodeURIComponent(segs[segs.length - 1] || "").toLowerCase();
  } catch {
    return "";
  }
}

function extOf(url) {
  const seg = pathSegment(url);
  const dot = seg.lastIndexOf(".");
  if (dot < 0) return "";
  return seg.slice(dot + 1);
}

/**
 * classifyAttachment(url) -> { kind, mime, ext, filename, url }
 *
 * kind is one of:
 *   "image", "pdf",
 *   "docx", "doc", "xlsx", "xls", "pptx", "ppt",
 *   "csv", "txt", "md", "json", "rtf",
 *   "code",
 *   "unknown"
 *
 * Pure URL inspection: no fetches. Caller decides what to do with each kind.
 */
export function classifyAttachment(url) {
  const filename = pathSegment(url);
  const ext = extOf(url);
  const mime = MIME_BY_EXT[ext] || "application/octet-stream";

  let kind = "unknown";
  if (IMAGE_EXTS.has(ext)) kind = "image";
  else if (PDF_EXTS.has(ext)) kind = "pdf";
  else if (OFFICE_KIND_BY_EXT[ext]) kind = OFFICE_KIND_BY_EXT[ext];
  else if (PLAIN_TEXT_KIND_BY_EXT[ext]) kind = PLAIN_TEXT_KIND_BY_EXT[ext];
  else if (CODE_EXTS.has(ext)) kind = "code";

  return { kind, mime, ext, filename, url };
}

// Kinds that are "documents" (anything non-image, non-pdf, non-unknown that
// we know how to extract text from).
const DOC_KIND_LABELS = {
  docx: "DOCX",
  doc: "DOC",
  xlsx: "XLSX",
  xls: "XLS",
  pptx: "PPTX",
  ppt: "PPT",
  csv: "CSV",
  txt: "text",
  md: "markdown",
  json: "JSON",
  rtf: "RTF",
  code: "code",
};

/**
 * summarizeAttachmentForPrompt({ filename, kind, pageCount? }) -> string
 *
 * Produces the synthetic marker line the agent loop prepends to a user
 * turn so the model sees attached files instead of a blank message.
 * Mirrors the [voice-in] prefix convention.
 */
export function summarizeAttachmentForPrompt(att) {
  if (!att) return "";
  const name = att.filename || att.url || "attachment";
  let kindLabel;
  if (att.kind === "image") kindLabel = "image";
  else if (att.kind === "pdf") kindLabel = "PDF";
  else if (DOC_KIND_LABELS[att.kind]) kindLabel = DOC_KIND_LABELS[att.kind];
  else kindLabel = "file";
  // Images are always one "page"; only PDFs / docs get a page count.
  const showPages =
    att.kind !== "image" &&
    att.kind !== "unknown" &&
    typeof att.pageCount === "number" &&
    att.pageCount > 0;
  const pages = showPages
    ? `, ${att.pageCount} page${att.pageCount === 1 ? "" : "s"}`
    : "";
  return `[attached: ${name} — ${kindLabel}${pages}]`;
}
