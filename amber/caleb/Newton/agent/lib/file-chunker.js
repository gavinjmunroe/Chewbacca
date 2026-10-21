/**
 * file-chunker.js — split extracted file text into Pinecone-sized chunks.
 *
 * attachment-ingest.js extracts a single text blob per inbound file (via
 * file-extract.js for office/text formats, or the OCR pipeline for PDFs).
 * That blob is fine for inlining into the current turn's prompt, but for
 * durable semantic recall we want it broken into smaller, separately
 * retrievable pieces so a query like "what did the deck say about Clay"
 * matches the one slide that mentions Clay rather than the whole file.
 *
 * This module is pure: text in, chunk records out. No network, no tenant,
 * no embedding. That keeps the chunking contract unit-testable without
 * stubbing Pinecone or the agent loop.
 *
 * Chunking strategy by kind (mirrors the Tab 14 dispatch spec):
 *   - xlsx / xls : one chunk per sheet (file-extract delimits sheets with
 *                  "--- sheet: NAME ---"). Oversized sheets are windowed.
 *   - pptx       : one chunk per slide ("--- slide N ---" delimiters).
 *   - csv        : one chunk per 50-row group.
 *   - pdf        : one chunk per page when page delimiters survive OCR,
 *                  otherwise sliding char windows.
 *   - docx       : split on blank-line paragraph groups, packed up to the
 *                  target size, with sliding-window fallback.
 *   - txt/md/json/code/rtf : sliding char windows with overlap.
 *
 * Every chunk carries a `section` label (e.g. "sheet:Revenue", "slide:3",
 * "rows:1-50", "part:2") so the stored metadata says where in the file the
 * text came from.
 */

const TARGET_CHARS = 2000;
const OVERLAP_CHARS = 200;
const CSV_ROWS_PER_CHUNK = 50;
// Guard rail: a single inbound file should never explode into an unbounded
// number of vectors. file-extract already clips text to ~6000 chars, but
// be defensive against pathological inputs.
const MAX_CHUNKS_PER_FILE = 40;

function isNonEmpty(s) {
  return typeof s === "string" && s.trim().length > 0;
}

/**
 * Sliding-window split of a plain string into ~size chunks with `overlap`
 * characters shared between neighbors so a sentence cut across a boundary
 * still embeds intact in at least one chunk.
 */
export function windowChunks(
  text,
  size = TARGET_CHARS,
  overlap = OVERLAP_CHARS,
) {
  const clean = typeof text === "string" ? text : "";
  if (clean.length <= size) {
    return isNonEmpty(clean) ? [clean.trim()] : [];
  }
  const step = Math.max(1, size - overlap);
  const out = [];
  for (let start = 0; start < clean.length; start += step) {
    const piece = clean.slice(start, start + size).trim();
    if (isNonEmpty(piece)) out.push(piece);
    if (start + size >= clean.length) break;
  }
  return out;
}

/**
 * Split on explicit section delimiters that file-extract.js injects, e.g.
 * "--- sheet: Revenue ---" or "--- slide 3 ---". Returns an array of
 * { label, body }; the leading label token is normalized for the section
 * field. Text before the first delimiter (if any) is kept as a preamble.
 */
function splitOnDelimiters(text, delimiterRe, labelFn) {
  const matches = [...text.matchAll(delimiterRe)];
  if (matches.length === 0) return null;

  const sections = [];
  const preamble = text.slice(0, matches[0].index).trim();
  if (isNonEmpty(preamble)) {
    sections.push({ label: "preamble", body: preamble });
  }
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const body = text.slice(start, end).trim();
    if (isNonEmpty(body)) {
      sections.push({ label: labelFn(m), body });
    }
  }
  return sections;
}

function packParagraphs(text, size = TARGET_CHARS) {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(isNonEmpty);
  if (paras.length === 0) return [];
  const out = [];
  let buf = "";
  for (const p of paras) {
    if (buf && buf.length + p.length + 2 > size) {
      out.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (isNonEmpty(buf)) out.push(buf);
  return out;
}

function csvRowChunks(text, rowsPerChunk = CSV_ROWS_PER_CHUNK) {
  const rows = text.split(/\r?\n/);
  // Preserve the header row at the top of every chunk so column meaning
  // travels with the data when a chunk is retrieved in isolation.
  const header = rows.length > 1 ? rows[0] : null;
  const body = header ? rows.slice(1) : rows;
  const out = [];
  for (let i = 0; i < body.length; i += rowsPerChunk) {
    const slice = body.slice(i, i + rowsPerChunk).filter((r) => r.length > 0);
    if (slice.length === 0) continue;
    const piece = header ? [header, ...slice].join("\n") : slice.join("\n");
    out.push({
      body: piece,
      section: `rows:${i + 1}-${i + slice.length}`,
    });
  }
  return out;
}

function withSection(bodies, sectionFn) {
  return bodies
    .filter(isNonEmpty)
    .map((body, i) => ({ body: body.trim(), section: sectionFn(i) }));
}

/**
 * chunkFileText({ text, kind }) -> [{ text, section, index }]
 *
 * `kind` is the classified attachment kind from attachments.js
 * (docx/xlsx/xls/pptx/csv/pdf/txt/md/json/rtf/code). Unknown kinds fall
 * back to windowed chunking. Empty / whitespace-only input returns [].
 */
export function chunkFileText({ text, kind } = {}) {
  if (!isNonEmpty(text)) return [];
  const clean = text.trim();
  let raw = [];

  switch (kind) {
    case "xlsx":
    case "xls": {
      const sections = splitOnDelimiters(
        clean,
        /---\s*sheet:\s*(.+?)\s*---/gi,
        (m) => `sheet:${(m[1] || "").trim()}`,
      );
      if (sections) {
        raw = sections.flatMap((s) =>
          windowChunks(s.body).map((body, i, arr) => ({
            body,
            section: arr.length > 1 ? `${s.label}#${i + 1}` : s.label,
          })),
        );
      } else {
        raw = windowChunks(clean).map((body, i) => ({
          body,
          section: `part:${i + 1}`,
        }));
      }
      break;
    }
    case "pptx": {
      const sections = splitOnDelimiters(
        clean,
        /---\s*slide\s*(\d+)\s*---/gi,
        (m) => `slide:${(m[1] || "").trim()}`,
      );
      raw = sections
        ? sections.flatMap((s) =>
            windowChunks(s.body).map((body, i, arr) => ({
              body,
              section: arr.length > 1 ? `${s.label}#${i + 1}` : s.label,
            })),
          )
        : windowChunks(clean).map((body, i) => ({
            body,
            section: `part:${i + 1}`,
          }));
      break;
    }
    case "csv": {
      raw = csvRowChunks(clean);
      break;
    }
    case "pdf": {
      // Mistral / Claude vision usually return one markdown blob. Some
      // sources mark page breaks with a form feed or an explicit "--- page
      // N ---" line; honor those when present, else window the blob.
      const sections = splitOnDelimiters(
        clean,
        /(?:\f|---\s*page\s*(\d+)\s*---)/gi,
        (m) => `page:${(m[1] || "").trim() || "break"}`,
      );
      raw = sections
        ? sections.flatMap((s) =>
            windowChunks(s.body).map((body, i, arr) => ({
              body,
              section: arr.length > 1 ? `${s.label}#${i + 1}` : s.label,
            })),
          )
        : windowChunks(clean).map((body, i) => ({
            body,
            section: `part:${i + 1}`,
          }));
      break;
    }
    case "docx": {
      raw = withSection(packParagraphs(clean), (i) => `part:${i + 1}`);
      break;
    }
    default: {
      // txt / md / json / rtf / code / unknown.
      raw = withSection(windowChunks(clean), (i) => `part:${i + 1}`);
    }
  }

  const capped = raw
    .filter((r) => isNonEmpty(r.body))
    .slice(0, MAX_CHUNKS_PER_FILE);
  return capped.map((r, index) => ({
    text: r.body,
    section: r.section,
    index,
  }));
}

export const __constants = {
  TARGET_CHARS,
  OVERLAP_CHARS,
  CSV_ROWS_PER_CHUNK,
  MAX_CHUNKS_PER_FILE,
};
