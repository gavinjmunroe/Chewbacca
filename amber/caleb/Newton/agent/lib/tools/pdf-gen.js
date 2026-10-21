/**
 * pdf-gen.js — Generate a PDF document from text/simple markdown and
 * return a public URL that the agent loop auto-attaches to the outbound
 * iMessage.
 *
 * Mirrors the image-gen.js shape: build the bytes in memory, stash via
 * lib/image-host.js (which already accepts arbitrary mime types after
 * PR #238), and hand back a short `${PUBLIC_BASE_URL}/image/<id>.pdf`
 * URL. The agent's tool-result scan picks up `pdf_url` alongside
 * `image_url` and pushes it into sendOpts.attachments.
 *
 * No external API key required — pdf-lib runs in-process and produces
 * the bytes itself. Same offline-safe shape as the audio host and
 * image host.
 *
 * Markdown handling is intentionally minimal for v1:
 *   - "# heading"  -> 16pt bold
 *   - "## heading" -> 14pt bold
 *   - "- bullet"   -> 12pt body, leading bullet glyph
 *   - blank line   -> paragraph break
 *   - everything else -> 12pt body, soft-wrapped at ~80 chars
 *
 * All handlers return { error: "…" } on failure, never throw.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { registerCapability } from "../capabilities.js";
import { storeImage } from "../image-host.js";

registerCapability("_tools_PdfGen", [
  "Generate PDF documents from text or simple markdown (generate_pdf)",
]);

// Letter size in PostScript points (72pt = 1 inch).
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54; // 0.75"
const LINE_HEIGHT_BODY = 16;
const LINE_HEIGHT_HEADING = 22;
const LINE_HEIGHT_SUBHEAD = 18;
const TITLE_SIZE = 24;
const HEADING_SIZE = 16;
const SUBHEAD_SIZE = 14;
const BODY_SIZE = 12;
const WRAP_CHARS = 80;

function resolvePublicBase() {
  // Same resolution order image-gen.js uses for the PNG host so PDFs
  // land on the same public origin Loop already fetches images from.
  return (
    process.env.MEDHA_PUBLIC_AUDIO_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : null)
  );
}

/**
 * Soft-wrap a line at WRAP_CHARS. Splits on spaces; words longer than
 * the wrap limit are passed through whole (pdf-lib will overflow but
 * it's better than dropping characters).
 */
function wrapLine(text, maxChars = WRAP_CHARS) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/**
 * pdf-lib's WinAnsi encoding (used by Helvetica) does not cover
 * em dashes, smart quotes, bullets, etc. Strip or remap so the model
 * can't crash the tool by emitting "—" in a heading.
 */
function sanitizeForWinAnsi(text) {
  if (text == null) return "";
  return (
    String(text)
      .replace(/\r\n/g, "\n")
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[“”„‟]/g, '"')
      .replace(/[–—―]/g, "-")
      .replace(/•/g, "-")
      .replace(/…/g, "...")
      .replace(/ /g, " ")
      // Drop anything outside printable ASCII + newline. pdf-lib will
      // throw on out-of-range glyphs and the tool would 500.
      .replace(/[^\x09\x0A\x20-\x7E]/g, "")
  );
}

/**
 * Pick a title when the caller didn't supply one: first non-empty line,
 * stripped of leading markdown markers, capped at 80 chars.
 */
function deriveTitle(content) {
  for (const raw of String(content).split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const stripped = line.replace(/^#{1,6}\s+/, "").replace(/^-\s+/, "");
    return stripped.slice(0, 80);
  }
  return "Document";
}

/**
 * Build the PDF bytes from a (sanitized) title + content string.
 * Returns Buffer. Pure function — no I/O.
 */
async function renderPdf({ title, content }) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(title);
  pdfDoc.setProducer("medha-platform generate_pdf");
  pdfDoc.setCreator("medha-platform");

  const body = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const newPageIfNeeded = (lineHeight) => {
    if (y - lineHeight < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  const drawLine = (text, { font, size, lineHeight, indent = 0 }) => {
    newPageIfNeeded(lineHeight);
    page.drawText(text, {
      x: MARGIN + indent,
      y: y - size,
      size,
      font,
      color: rgb(0, 0, 0),
    });
    y -= lineHeight;
  };

  // Title block — bold, slightly larger, with a divider gap underneath.
  if (title) {
    const titleLines = wrapLine(title, 60);
    for (const line of titleLines) {
      drawLine(line, {
        font: bold,
        size: TITLE_SIZE,
        lineHeight: TITLE_SIZE + 6,
      });
    }
    y -= 10; // breathing room before body
  }

  const rawLines = String(content).split(/\n/);
  for (const raw of rawLines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      // blank line = paragraph break
      y -= LINE_HEIGHT_BODY * 0.6;
      continue;
    }

    // ## subhead
    if (/^##\s+/.test(line)) {
      const text = line.replace(/^##\s+/, "");
      for (const wrapped of wrapLine(text, 70)) {
        drawLine(wrapped, {
          font: bold,
          size: SUBHEAD_SIZE,
          lineHeight: LINE_HEIGHT_SUBHEAD,
        });
      }
      continue;
    }

    // # heading
    if (/^#\s+/.test(line)) {
      const text = line.replace(/^#\s+/, "");
      for (const wrapped of wrapLine(text, 65)) {
        drawLine(wrapped, {
          font: bold,
          size: HEADING_SIZE,
          lineHeight: LINE_HEIGHT_HEADING,
        });
      }
      continue;
    }

    // - bullet
    if (/^-\s+/.test(line)) {
      const text = line.replace(/^-\s+/, "");
      const wrapped = wrapLine(text, WRAP_CHARS - 4);
      wrapped.forEach((seg, idx) => {
        drawLine(idx === 0 ? `- ${seg}` : `  ${seg}`, {
          font: body,
          size: BODY_SIZE,
          lineHeight: LINE_HEIGHT_BODY,
          indent: 6,
        });
      });
      continue;
    }

    // body paragraph
    for (const wrapped of wrapLine(line, WRAP_CHARS)) {
      drawLine(wrapped, {
        font: body,
        size: BODY_SIZE,
        lineHeight: LINE_HEIGHT_BODY,
      });
    }
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

async function generatePdf(input) {
  const { content, title: rawTitle, filename: rawFilename } = input || {};
  if (!content || typeof content !== "string") {
    return { error: "content is required" };
  }
  if (content.length > 100_000) {
    return { error: "content too long (max 100000 chars)" };
  }

  const sanitizedContent = sanitizeForWinAnsi(content);
  const derivedTitle = deriveTitle(content);
  const title = sanitizeForWinAnsi(
    typeof rawTitle === "string" && rawTitle.trim()
      ? rawTitle.trim()
      : derivedTitle,
  );
  const filename =
    typeof rawFilename === "string" && rawFilename.trim()
      ? rawFilename
          .trim()
          .replace(/[^a-z0-9._-]+/gi, "_")
          .slice(0, 80)
      : "document";

  const publicBase = resolvePublicBase();
  if (!publicBase) {
    return {
      error:
        "no public base URL — set MEDHA_PUBLIC_AUDIO_BASE_URL or PUBLIC_BASE_URL or RAILWAY_PUBLIC_DOMAIN",
    };
  }

  let buffer;
  try {
    buffer = await renderPdf({ title, content: sanitizedContent });
  } catch (err) {
    return { error: `pdf render failed: ${String(err).slice(0, 200)}` };
  }

  const id = storeImage(buffer, "application/pdf");
  if (!id) return { error: "image-host store failed for pdf" };
  const pdfUrl = `${publicBase}/image/${id}.pdf`;
  return {
    ok: true,
    pdf_url: pdfUrl,
    title,
    filename: `${filename}.pdf`,
    byteLength: buffer.length,
    mime_type: "application/pdf",
  };
}

// ── Tool schema ──────────────────────────────────────────────────────────────

export const PDF_GEN_TOOLS = [
  {
    name: "generate_pdf",
    description:
      "Generate a PDF from text content (or simple markdown) and return a URL you can attach. Use when the user asks 'make me a PDF that says X', 'generate a PDF with these notes', 'turn this into a PDF and send it'. Title is optional; if absent, the first non-empty line is used. Returns { pdf_url } which the agent attaches automatically via sendOpts.attachments.",
    input_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description:
            "The text body (plain text or simple markdown: # headings, - bullets, blank lines for paragraphs)",
        },
        title: {
          type: "string",
          description: "Optional title shown at the top of the PDF",
        },
        filename: {
          type: "string",
          description: "Optional filename suggestion (no extension)",
          default: "document",
        },
      },
      required: ["content"],
    },
  },
];

export async function executePdfGenTool(toolName, input /* , ctx = {} */) {
  switch (toolName) {
    case "generate_pdf":
      return generatePdf(input);
    default:
      return { error: `unknown pdf-gen tool: ${toolName}` };
  }
}
