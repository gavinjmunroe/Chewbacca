/**
 * file-gen.js — Generate common office + text + code files from agent
 * tool calls and return public URLs that the outbound iMessage transport
 * auto-attaches.
 *
 * Mirrors pdf-gen.js (PR #239) and image-gen.js (Tab 2): build bytes in
 * memory, stash via lib/image-host.js (which accepts arbitrary mime
 * types after PR-G widened EXT_BY_MIME), hand back a short
 * `${PUBLIC_BASE_URL}/image/<id>.<ext>` URL. The agent's tool-result loop
 * scans for the matching `<kind>_url` and pushes it onto
 * sendOpts.attachments alongside pdf_url / image_url. Loop accepts up to
 * 3 attachments per bubble; the cap is shared across all *_url scanners
 * in agent.js, so files split across bubbles automatically when there
 * are more than 3.
 *
 * No external API key required. docx + xlsx run in-process; the text
 * formats (csv / md / txt / json / code) are plain UTF-8 buffers.
 *
 * Tool surface:
 *   - generate_docx           ({ content, title?, filename? })
 *   - generate_xlsx           ({ rows | sheets | csv, sheet_name?, filename? })
 *   - generate_csv            ({ rows | csv, filename? })
 *   - generate_markdown / _md ({ content, filename? })
 *   - generate_text / _txt    ({ content, filename? })
 *   - generate_json           ({ data, filename? })
 *   - generate_code_file      ({ content, language, filename? })
 *
 * All handlers return { error: "…" } on failure, never throw.
 */

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import * as XLSX from "xlsx";
import { registerCapability } from "../capabilities.js";
import { storeImage } from "../image-host.js";

registerCapability("_tools_FileGen", [
  "Generate office and text files: DOCX (generate_docx), XLSX (generate_xlsx), CSV (generate_csv), Markdown (generate_markdown), Text (generate_text), JSON (generate_json), Code (generate_code_file)",
]);

// ── MIME + extension table ───────────────────────────────────────────────────
//
// Kept in sync with image-host.js EXT_BY_MIME. Anything we add here must also
// be registered there (and in the server.js route regex) or Loop won't be
// able to fetch the served URL.
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Language → extension for generate_code_file. "other" falls back to .txt
// (with text/plain mime) so the model can request "language: other" without
// crashing the dispatcher when the user hands it something exotic.
const LANGUAGE_EXT = {
  py: "py",
  js: "js",
  ts: "ts",
  html: "html",
  css: "css",
  sh: "sh",
  yml: "yml",
  toml: "toml",
  sql: "sql",
  other: "txt",
};

// ── helpers ──────────────────────────────────────────────────────────────────

function resolvePublicBase() {
  // Same resolution order as pdf-gen.js so all outbound files land on the
  // same origin Loop already fetches images + PDFs from.
  return (
    process.env.MEDHA_PUBLIC_AUDIO_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : null)
  );
}

function safeFilename(raw, fallback = "document") {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  return (
    raw
      .trim()
      .replace(/\.[a-z0-9]{1,8}$/i, "") // strip any extension the caller pre-pended
      .replace(/[^a-z0-9._-]+/gi, "_")
      .slice(0, 80) || fallback
  );
}

/**
 * Mirror pdf-gen.js's WinAnsi sanitizer so headings + body lines that
 * include smart quotes, em dashes, or non-breaking spaces don't crash
 * docx's font embedding. Keeps the public-facing prompt rule ("no em
 * dashes") enforceable inside the tool, not just in the model.
 */
function sanitizeText(text) {
  if (text == null) return "";
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, "-")
    .replace(/•/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ");
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !Buffer.isBuffer(value)
  );
}

/**
 * Stash a buffer via the shared image-host and return a public URL or
 * an { error } response. Centralizes the public-base + storeImage check
 * so each generator stays focused on building bytes.
 */
function stashAndBuildUrl(buffer, mimeType, ext) {
  const publicBase = resolvePublicBase();
  if (!publicBase) {
    return {
      error:
        "no public base URL — set MEDHA_PUBLIC_AUDIO_BASE_URL or PUBLIC_BASE_URL or RAILWAY_PUBLIC_DOMAIN",
    };
  }
  const id = storeImage(buffer, mimeType);
  if (!id) return { error: `image-host store failed for ${ext}` };
  return { url: `${publicBase}/image/${id}.${ext}`, byteLength: buffer.length };
}

// ── DOCX ─────────────────────────────────────────────────────────────────────

/**
 * Build a DOCX from text content. Each blank line is a paragraph break;
 * each non-empty line becomes its own Paragraph (single TextRun). When
 * `title` is supplied, it leads the doc as a Heading1.
 */
async function buildDocxBuffer({ title, content }) {
  const children = [];
  if (title) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: title, bold: true })],
      }),
    );
  }
  const lines = String(content).split(/\n/);
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line) {
      // Empty paragraph for visual paragraph break.
      children.push(new Paragraph({ children: [new TextRun("")] }));
      continue;
    }
    children.push(new Paragraph({ children: [new TextRun({ text: line })] }));
  }
  if (children.length === 0) {
    // Packer refuses a section with no children.
    children.push(new Paragraph({ children: [new TextRun("")] }));
  }
  const doc = new Document({
    creator: "medha-platform",
    title: title || "Document",
    sections: [{ children }],
  });
  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

async function generateDocx(input) {
  const { content, title: rawTitle, filename: rawFilename } = input || {};
  if (typeof content !== "string" || !content.trim()) {
    return { error: "content is required" };
  }
  if (content.length > 200_000) {
    return { error: "content too long (max 200000 chars)" };
  }
  const sanitizedContent = sanitizeText(content);
  const title =
    typeof rawTitle === "string" && rawTitle.trim()
      ? sanitizeText(rawTitle.trim())
      : "";
  const filename = safeFilename(rawFilename);

  let buffer;
  try {
    buffer = await buildDocxBuffer({ title, content: sanitizedContent });
  } catch (err) {
    return { error: `docx render failed: ${String(err).slice(0, 200)}` };
  }
  const stash = stashAndBuildUrl(buffer, DOCX_MIME, "docx");
  if (stash.error) return stash;
  return {
    ok: true,
    docx_url: stash.url,
    title: title || filename,
    filename: `${filename}.docx`,
    byteLength: stash.byteLength,
    mime_type: DOCX_MIME,
  };
}

// ── XLSX ─────────────────────────────────────────────────────────────────────

/**
 * Parse a CSV-ish string into an array of rows for SheetJS. Simple but
 * handles quoted cells + escaped quotes — enough for the model to hand
 * the tool a CSV blob without us needing the full csv-parse dep.
 */
function parseCsvToRows(csv) {
  const rows = [];
  let current = [];
  let cell = "";
  let inQuotes = false;
  const flushCell = () => {
    current.push(cell);
    cell = "";
  };
  const flushRow = () => {
    rows.push(current);
    current = [];
  };
  for (let i = 0; i < csv.length; i += 1) {
    const ch = csv[i];
    if (inQuotes) {
      if (ch === '"' && csv[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      flushCell();
    } else if (ch === "\n") {
      flushCell();
      flushRow();
    } else if (ch === "\r") {
      // ignore; \r\n handled by the \n branch
    } else {
      cell += ch;
    }
  }
  // Trailing cell + row
  if (cell.length > 0 || current.length > 0) {
    flushCell();
    flushRow();
  }
  return rows;
}

/**
 * Build an XLSX buffer from one of three input shapes:
 *   - { rows: [[...], [...]], sheet_name? }     → single sheet
 *   - { sheets: [{ name, rows: [...] }, ...] }  → multi-sheet
 *   - { csv: "a,b\n1,2" }                       → parsed to a single sheet
 */
function buildXlsxBuffer(input) {
  const { rows, sheets, csv, sheet_name: sheetName } = input || {};
  const wb = XLSX.utils.book_new();

  if (Array.isArray(sheets) && sheets.length) {
    for (const def of sheets) {
      if (!def || !Array.isArray(def.rows)) continue;
      const name = String(def.name || "Sheet").slice(0, 31) || "Sheet";
      const ws = XLSX.utils.aoa_to_sheet(def.rows);
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
  } else if (Array.isArray(rows)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const name = String(sheetName || "Sheet1").slice(0, 31) || "Sheet1";
    XLSX.utils.book_append_sheet(wb, ws, name);
  } else if (typeof csv === "string" && csv.trim()) {
    const parsed = parseCsvToRows(csv);
    const ws = XLSX.utils.aoa_to_sheet(parsed);
    const name = String(sheetName || "Sheet1").slice(0, 31) || "Sheet1";
    XLSX.utils.book_append_sheet(wb, ws, name);
  } else {
    throw new Error("rows, sheets, or csv is required");
  }

  if (wb.SheetNames.length === 0) {
    // SheetJS refuses to write an empty workbook.
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[""]]), "Sheet1");
  }
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

async function generateXlsx(input) {
  const filename = safeFilename(input?.filename, "spreadsheet");
  let buffer;
  try {
    buffer = buildXlsxBuffer(input || {});
  } catch (err) {
    return {
      error: `xlsx render failed: ${String(err.message || err).slice(0, 200)}`,
    };
  }
  const stash = stashAndBuildUrl(buffer, XLSX_MIME, "xlsx");
  if (stash.error) return stash;
  return {
    ok: true,
    xlsx_url: stash.url,
    filename: `${filename}.xlsx`,
    byteLength: stash.byteLength,
    mime_type: XLSX_MIME,
  };
}

// ── CSV ──────────────────────────────────────────────────────────────────────

function csvEscape(value) {
  const str = value == null ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsv(rows) {
  return rows
    .map((row) => (Array.isArray(row) ? row.map(csvEscape).join(",") : ""))
    .join("\n")
    .concat("\n");
}

async function generateCsv(input) {
  const { rows, csv, filename: rawFilename } = input || {};
  const filename = safeFilename(rawFilename, "data");
  let body;
  if (typeof csv === "string" && csv.length) {
    body = csv.endsWith("\n") ? csv : `${csv}\n`;
  } else if (Array.isArray(rows)) {
    body = rowsToCsv(rows);
  } else if (typeof rows === "string" && rows.length) {
    body = rows.endsWith("\n") ? rows : `${rows}\n`;
  } else {
    return { error: "rows or csv is required" };
  }
  const buffer = Buffer.from(body, "utf8");
  const stash = stashAndBuildUrl(buffer, "text/csv", "csv");
  if (stash.error) return stash;
  return {
    ok: true,
    csv_url: stash.url,
    filename: `${filename}.csv`,
    byteLength: stash.byteLength,
    mime_type: "text/csv",
  };
}

// ── Markdown ─────────────────────────────────────────────────────────────────

async function generateMarkdown(input) {
  const { content, filename: rawFilename } = input || {};
  if (typeof content !== "string" || !content.length) {
    return { error: "content is required" };
  }
  const filename = safeFilename(rawFilename, "document");
  const buffer = Buffer.from(content, "utf8");
  const stash = stashAndBuildUrl(buffer, "text/markdown", "md");
  if (stash.error) return stash;
  return {
    ok: true,
    md_url: stash.url,
    filename: `${filename}.md`,
    byteLength: stash.byteLength,
    mime_type: "text/markdown",
  };
}

// ── Plain text ───────────────────────────────────────────────────────────────

async function generateText(input) {
  const { content, filename: rawFilename } = input || {};
  if (typeof content !== "string" || !content.length) {
    return { error: "content is required" };
  }
  const filename = safeFilename(rawFilename, "document");
  const buffer = Buffer.from(content, "utf8");
  const stash = stashAndBuildUrl(buffer, "text/plain", "txt");
  if (stash.error) return stash;
  return {
    ok: true,
    txt_url: stash.url,
    filename: `${filename}.txt`,
    byteLength: stash.byteLength,
    mime_type: "text/plain",
  };
}

// ── JSON ─────────────────────────────────────────────────────────────────────

async function generateJson(input) {
  const { data, filename: rawFilename } = input || {};
  if (data === undefined) {
    return { error: "data is required" };
  }
  const filename = safeFilename(rawFilename, "data");
  let body;
  try {
    body = JSON.stringify(data, null, 2);
  } catch (err) {
    return {
      error: `json stringify failed: ${String(err.message || err).slice(0, 200)}`,
    };
  }
  if (typeof body !== "string") {
    return { error: "json stringify produced no output" };
  }
  const buffer = Buffer.from(body, "utf8");
  const stash = stashAndBuildUrl(buffer, "application/json", "json");
  if (stash.error) return stash;
  return {
    ok: true,
    json_url: stash.url,
    filename: `${filename}.json`,
    byteLength: stash.byteLength,
    mime_type: "application/json",
  };
}

// ── Code file ────────────────────────────────────────────────────────────────

async function generateCodeFile(input) {
  const { content, language, filename: rawFilename } = input || {};
  if (typeof content !== "string" || !content.length) {
    return { error: "content is required" };
  }
  const langKey =
    typeof language === "string" ? language.toLowerCase() : "other";
  const ext = LANGUAGE_EXT[langKey] || LANGUAGE_EXT.other;
  const filename = safeFilename(rawFilename, "snippet");
  const buffer = Buffer.from(content, "utf8");
  // Code files travel as text/plain; the extension carries the language hint.
  const stash = stashAndBuildUrl(buffer, "text/plain", ext);
  if (stash.error) return stash;
  return {
    ok: true,
    file_url: stash.url,
    language: langKey,
    filename: `${filename}.${ext}`,
    byteLength: stash.byteLength,
    mime_type: "text/plain",
  };
}

// ── Tool schemas ─────────────────────────────────────────────────────────────

export const FILE_GEN_TOOLS = [
  {
    name: "generate_docx",
    description:
      "Generate a Microsoft Word .docx from text content and return a URL the agent auto-attaches. Use when the user asks 'make me a docx', 'send a Word doc with X', 'export this as a Word document'. Returns { docx_url }.",
    input_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description:
            "Body text. Blank lines become paragraph breaks; each non-empty line becomes its own paragraph.",
        },
        title: {
          type: "string",
          description: "Optional Heading1 title rendered at the top.",
        },
        filename: {
          type: "string",
          description: "Optional filename suggestion without extension.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "generate_xlsx",
    description:
      "Generate a Microsoft Excel .xlsx spreadsheet and return a URL the agent auto-attaches. Use when the user asks 'make a spreadsheet', 'export these numbers as Excel', 'send a worksheet'. Accepts a single sheet via { rows: [[...]] }, a CSV blob via { csv }, or multi-sheet via { sheets: [{ name, rows }] }. Returns { xlsx_url }.",
    input_schema: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          description:
            "Array of row arrays for a single sheet. Each row is an array of cell values.",
          items: { type: "array" },
        },
        sheets: {
          type: "array",
          description:
            "Multi-sheet shape. Each entry: { name: string, rows: array-of-arrays }.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              rows: { type: "array", items: { type: "array" } },
            },
            required: ["name", "rows"],
          },
        },
        csv: {
          type: "string",
          description:
            "CSV blob to convert into a single sheet. Use when rows are already CSV-formatted.",
        },
        sheet_name: {
          type: "string",
          description:
            "Optional sheet name when using `rows` or `csv` (default Sheet1).",
        },
        filename: {
          type: "string",
          description: "Optional filename suggestion without extension.",
        },
      },
    },
  },
  {
    name: "generate_csv",
    description:
      "Generate a CSV file and return a URL the agent auto-attaches. Use when the user asks 'export this as CSV', 'send me a CSV of X'. Accepts { rows: [[...]] } (will be CSV-escaped) or { csv: '...' } (used verbatim). Returns { csv_url }.",
    input_schema: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          description:
            "Array of row arrays. Cell values are coerced to strings and CSV-escaped automatically.",
          items: { type: "array" },
        },
        csv: {
          type: "string",
          description: "Pre-formatted CSV string used verbatim.",
        },
        filename: {
          type: "string",
          description: "Optional filename suggestion without extension.",
        },
      },
    },
  },
  {
    name: "generate_markdown",
    description:
      "Generate a Markdown (.md) file from content and return a URL the agent auto-attaches. Use when the user asks 'send me a markdown file', 'export this as .md'. Returns { md_url }.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Markdown body." },
        filename: {
          type: "string",
          description: "Optional filename suggestion without extension.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "generate_md",
    description:
      "Alias of generate_markdown. Generates a Markdown (.md) file from content; returns { md_url }.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Markdown body." },
        filename: { type: "string" },
      },
      required: ["content"],
    },
  },
  {
    name: "generate_text",
    description:
      "Generate a plain text (.txt) file and return a URL the agent auto-attaches. Use when the user asks 'send me this as a text file', 'export as .txt'. Returns { txt_url }.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Body text." },
        filename: { type: "string" },
      },
      required: ["content"],
    },
  },
  {
    name: "generate_txt",
    description:
      "Alias of generate_text. Generates a plain text (.txt) file; returns { txt_url }.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Body text." },
        filename: { type: "string" },
      },
      required: ["content"],
    },
  },
  {
    name: "generate_json",
    description:
      "Generate a JSON file (pretty-printed, 2-space indent) and return a URL the agent auto-attaches. Use when the user asks 'send me a JSON config', 'export this object as JSON'. Returns { json_url }.",
    input_schema: {
      type: "object",
      properties: {
        data: {
          description: "Object or array to stringify as JSON.",
        },
        filename: { type: "string" },
      },
      required: ["data"],
    },
  },
  {
    name: "generate_code_file",
    description:
      "Generate a source-code file with a language-appropriate extension and return a URL the agent auto-attaches. Use when the user asks 'send me a Python script that does X', 'export this as a .ts file'. Returns { file_url, language, filename }.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Source code body." },
        language: {
          type: "string",
          enum: [
            "py",
            "js",
            "ts",
            "html",
            "css",
            "sh",
            "yml",
            "toml",
            "sql",
            "other",
          ],
          description:
            "Language hint that picks the extension. 'other' falls back to .txt.",
        },
        filename: {
          type: "string",
          description: "Optional filename suggestion without extension.",
        },
      },
      required: ["content", "language"],
    },
  },
];

// ── Dispatcher ───────────────────────────────────────────────────────────────

export async function executeFileGenTool(toolName, input /* , ctx = {} */) {
  switch (toolName) {
    case "generate_docx":
      return generateDocx(input);
    case "generate_xlsx":
      return generateXlsx(input);
    case "generate_csv":
      return generateCsv(input);
    case "generate_markdown":
    case "generate_md":
      return generateMarkdown(input);
    case "generate_text":
    case "generate_txt":
      return generateText(input);
    case "generate_json":
      return generateJson(input);
    case "generate_code_file":
      return generateCodeFile(input);
    default:
      return { error: `unknown file-gen tool: ${toolName}` };
  }
}

// Re-exported for tests so they can probe the helpers directly without
// constructing a public URL.
export const __internal = {
  buildDocxBuffer,
  buildXlsxBuffer,
  parseCsvToRows,
  rowsToCsv,
  csvEscape,
  sanitizeText,
  safeFilename,
  isPlainObject,
};
