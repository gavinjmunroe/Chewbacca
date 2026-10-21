/**
 * file-extract.js — library-based text extraction for inbound non-OCR
 * attachments (DOCX, XLSX, PPTX, CSV, TXT, MD, JSON, RTF, code files).
 *
 * Why this module exists: attachment-ingest.js routes images + PDFs to
 * Mistral OCR (with Claude vision fallback), but everything else used to
 * fall through with only a marker. This module closes that gap with
 * native parsers so the agent prompt sees actual file content:
 *   - DOCX  -> mammoth (raw text)
 *   - XLSX  -> SheetJS (sheet_to_csv per sheet)
 *   - PPTX  -> JSZip + regex over <a:t> nodes (slide text)
 *   - CSV / TXT / MD / JSON / RTF / code -> plain UTF-8 read
 *   - Legacy .doc / .ppt -> surfaced as a re-save error, no inlined text
 *
 * All HTTP fetches use a 30s AbortController timeout. No external API
 * keys are required; everything runs in-process.
 */

const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TEXT = 6000;

/**
 * Fetch the attachment URL into a Node Buffer with a hard timeout.
 * Returns { buffer } on success, { error } on any failure.
 */
async function fetchBuffer(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { error: `fetch ${res.status} ${res.statusText}` };
    }
    const ab = await res.arrayBuffer();
    return { buffer: Buffer.from(ab) };
  } catch (err) {
    const msg =
      err?.name === "AbortError"
        ? `fetch timed out after ${FETCH_TIMEOUT_MS}ms`
        : String(err?.message || err);
    return { error: msg };
  } finally {
    clearTimeout(timer);
  }
}

function clipText(text, max) {
  if (typeof text !== "string") return "";
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n\n[…truncated at ${max} chars]`;
}

// ─── DOCX (mammoth) ───────────────────────────────────────────────────────

async function extractDocx(buffer) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return { text: result?.value || "" };
}

// ─── XLSX / XLS (SheetJS) ─────────────────────────────────────────────────

async function extractXlsx(buffer) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheets = Array.isArray(wb?.SheetNames) ? wb.SheetNames : [];
  const blocks = [];
  for (const name of sheets) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    blocks.push(`--- sheet: ${name} ---\n${csv}`);
  }
  return { text: blocks.join("\n\n"), pageCount: sheets.length };
}

// ─── PPTX (JSZip + <a:t> regex) ───────────────────────────────────────────

const SLIDE_PATH_RE = /^ppt\/slides\/slide(\d+)\.xml$/i;
const A_T_RE = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function extractPptx(buffer) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const slideEntries = [];
  zip.forEach((relPath, file) => {
    const m = SLIDE_PATH_RE.exec(relPath);
    if (m && !file.dir) {
      slideEntries.push({ index: parseInt(m[1], 10), file });
    }
  });
  slideEntries.sort((a, b) => a.index - b.index);

  const blocks = [];
  for (const { index, file } of slideEntries) {
    const xml = await file.async("string");
    const texts = [];
    let match;
    while ((match = A_T_RE.exec(xml)) !== null) {
      const inner = decodeXmlEntities(match[1] || "").trim();
      if (inner) texts.push(inner);
    }
    blocks.push(`--- slide ${index} ---\n${texts.join("\n")}`);
  }
  return { text: blocks.join("\n\n"), pageCount: slideEntries.length };
}

// ─── Plain UTF-8 (CSV, TXT, MD, JSON, RTF, code) ──────────────────────────

function extractPlainText(buffer, max) {
  const text = buffer.toString("utf8");
  return { text: clipText(text, max) };
}

// ─── Dispatcher ────────────────────────────────────────────────────────────

/**
 * extractFileContent({ url, kind, mime, tenant, maxText? })
 *   -> { text?, pageCount?, error?, source }
 *
 * Routes by classified kind. Caller is responsible for marker rendering;
 * this module only returns extracted text and metadata.
 *
 * source values: "mammoth", "xlsx", "pptx_unzip", "plain_text",
 *                "legacy_office_unsupported", "unsupported"
 */
export async function extractFileContent({
  url,
  kind,
  mime: _mime,
  tenant: _tenant,
  maxText = DEFAULT_MAX_TEXT,
} = {}) {
  // Legacy binary office formats — surface as an actionable error.
  if (kind === "doc") {
    return {
      error: "Legacy .doc not supported; please re-save as .docx",
      source: "legacy_office_unsupported",
    };
  }
  if (kind === "ppt") {
    return {
      error: "Legacy .ppt not supported; please re-save as .pptx",
      source: "legacy_office_unsupported",
    };
  }
  if (kind === "xls") {
    // SheetJS does read legacy .xls, so we try it through the xlsx path,
    // but if anything fails we still surface a clean error.
  }

  if (!url || typeof url !== "string") {
    return { error: "missing url", source: "unsupported" };
  }

  const { buffer, error: fetchErr } = await fetchBuffer(url);
  if (fetchErr) {
    return { error: fetchErr, source: "unsupported" };
  }

  try {
    switch (kind) {
      case "docx": {
        const { text } = await extractDocx(buffer);
        return { text: clipText(text, maxText), source: "mammoth" };
      }
      case "xlsx":
      case "xls": {
        const { text, pageCount } = await extractXlsx(buffer);
        return { text: clipText(text, maxText), pageCount, source: "xlsx" };
      }
      case "pptx": {
        const { text, pageCount } = await extractPptx(buffer);
        return {
          text: clipText(text, maxText),
          pageCount,
          source: "pptx_unzip",
        };
      }
      case "csv":
      case "txt":
      case "md":
      case "json":
      case "rtf":
      case "code": {
        const { text } = extractPlainText(buffer, maxText);
        return { text, source: "plain_text" };
      }
      default:
        return {
          error: `unsupported kind: ${kind}`,
          source: "unsupported",
        };
    }
  } catch (err) {
    return {
      error: String(err?.message || err),
      source: "unsupported",
    };
  }
}

// Exported for tests so we can stub fetch without hitting the network.
export const __testing = { fetchBuffer, clipText };
