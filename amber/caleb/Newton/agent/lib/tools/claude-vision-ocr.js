/**
 * claude-vision-ocr.js: Anthropic Claude vision fallback for OCR.
 *
 * Why this exists: the primary OCR path (`ocr_extract_text` in ./ocr.js)
 * requires MISTRAL_API_KEY, which is NOT set on Railway and not in any
 * tenant's secret bag. Same story for CLOUDCONVERT_API_KEY. Without a
 * fallback, attachment-ingest sees PDFs + images arrive but can't read
 * them, so Medha gets a marker with no extracted text.
 *
 * Claude Sonnet 4.6 has native multimodal support for both images and
 * PDFs via the Anthropic Messages API:
 *   - Images: { type: "image", source: { type: "url", url } }
 *   - PDFs:   { type: "document", source: { type: "url", url } }
 *     (handles text + diagrams, up to 32MB / 100 pages per doc)
 *
 * ANTHROPIC_API_KEY is already set in production (it's the model the
 * agent uses), so this tool unblocks PDF + image processing with no
 * additional infra.
 *
 * All handlers return { error: "…" } on failure, never throw.
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";

registerCapability("_tools_CLAUDE_VISION_OCR", [
  "Extract text from images via Claude vision (claude_vision_extract)",
  "Extract text from PDFs via Claude vision (claude_vision_extract)",
]);

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 8192;

// Mirror the image extension set from attachments.js so auto-detection
// behaves identically to the classifier the ingest pipeline already uses.
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|svg)(\?|$)/i;
const PDF_EXT_RE = /\.pdf(\?|$)/i;

function detectType(url) {
  if (typeof url !== "string" || !url) return "image";
  if (PDF_EXT_RE.test(url) || url.includes("/pdf")) return "pdf";
  if (IMAGE_EXT_RE.test(url)) return "image";
  // Default to image; the Anthropic API will reject obvious mismatches
  // and the caller can retry with an explicit type.
  return "image";
}

function buildImagePrompt(focus) {
  const base =
    "Extract all text from this image. Preserve layout where meaningful " +
    "(tables, lists, hierarchies). Return raw text. ";
  return focus ? base + "Focus on: " + focus : base;
}

function buildPdfPrompt(focus) {
  const base =
    "Extract all text from this PDF. Preserve page boundaries with markers " +
    "like '--- page N ---'. Preserve tables and bullet hierarchy. ";
  return focus ? base + "Focus on: " + focus : base;
}

function buildContent(url, type, focus) {
  if (type === "pdf") {
    return [
      { type: "document", source: { type: "url", url } },
      { type: "text", text: buildPdfPrompt(focus) },
    ];
  }
  return [
    { type: "image", source: { type: "url", url } },
    { type: "text", text: buildImagePrompt(focus) },
  ];
}

async function callAnthropic(apiKey, content) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: DEFAULT_MAX_TOKENS,
        messages: [{ role: "user", content }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { error: `anthropic vision ${res.status}: ${body.slice(0, 300)}` };
    }
    const data = await res.json();
    // Concatenate text blocks (Claude can return multiple).
    const blocks = Array.isArray(data?.content) ? data.content : [];
    const text = blocks
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n\n")
      .trim();
    return { ok: true, text, raw: data };
  } catch (err) {
    clearTimeout(timer);
    return { error: `claude vision failed: ${String(err).slice(0, 200)}` };
  }
}

// ── Tool schema ─────────────────────────────────────────────────────────────

export const CLAUDE_VISION_OCR_TOOLS = [
  {
    name: "claude_vision_extract",
    description:
      "Extract text + structured description from an image or PDF URL using Claude Sonnet 4.6 vision. Handles both images (PNG/JPG/WEBP/HEIC/etc) and PDFs (up to 100 pages). Use when Mistral OCR is unavailable.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        type: {
          type: "string",
          enum: ["image", "pdf", "auto"],
          default: "auto",
        },
        focus: {
          type: "string",
          description:
            "Optional: what to focus on in extraction (e.g. 'just the text', 'tables only', 'numerical data')",
        },
      },
      required: ["url"],
    },
  },
];

export const CLAUDE_VISION_OCR_TOOL_NAMES = new Set(["claude_vision_extract"]);

export async function executeClaudeVisionOcrTool(name, input, ctx = {}) {
  if (name !== "claude_vision_extract") {
    return { error: `unknown claude-vision tool: ${name}` };
  }
  const url = input?.url;
  if (!url || typeof url !== "string") {
    return { error: "url is required" };
  }

  const tenant = ctx?.tenant || null;
  const apiKey = await getSecret(tenant, "ANTHROPIC_API_KEY", {
    fallbackEnv: "ANTHROPIC_API_KEY",
  });
  if (!apiKey) {
    return { error: "ANTHROPIC_API_KEY not configured for tenant" };
  }

  const requestedType = input?.type || "auto";
  const type = requestedType === "auto" ? detectType(url) : requestedType;
  const focus = typeof input?.focus === "string" ? input.focus : "";

  const content = buildContent(url, type, focus);
  const result = await callAnthropic(apiKey, content);
  if (result.error) return { error: result.error };

  return {
    ok: true,
    text: result.text,
    model: ANTHROPIC_MODEL,
    source_url: url,
    type,
  };
}
